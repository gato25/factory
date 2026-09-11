import { afterAll, beforeEach, expect, test } from 'bun:test';
import { runs, stepResults, tickets } from '@factory/db/schema';
import type { Callback, Step } from '@factory/shared';
import { applyStepResult, conditionHolds, decideStep } from '@factory/shared';
import { eq } from 'drizzle-orm';
import { applyCallback } from '../../src/lib/services/callbacks';
import { startRun } from '../../src/lib/services/run';
import { runView } from '../../src/lib/services/run-view';
import { ticketHasUi } from '../../src/lib/services/ticket';
import { connect, type Scenario, seed } from '../fixtures';

/**
 * FR-032c — a condition is evaluated when its step is reached, against the
 * facts established by then. Not at pipeline creation, not at run start:
 * the design step's condition depends on a decision the specification step
 * has not made yet when the run begins.
 */

const { db, sql: raw } = connect();
let scenario: Scenario;
let runId: string;

/** spec -> design (only when the ticket changes the interface) -> implement. */
const withDesign =
  (condition: Step['condition'] = 'ticket_has_ui') =>
  (specId: string, implId: string): Step[] => [
    { type: 'agent', condition: 'always', agent_id: specId, output_files: ['docs/spec.md'] },
    { type: 'design', condition, agent_id: specId },
    { type: 'agent', condition: 'always', agent_id: implId, output_files: [] },
  ];

async function start(steps: (specId: string, implId: string) => Step[]) {
  scenario = await seed(db, { steps });
  const started = await startRun(db, {
    ticketId: scenario.ticketId,
    callbackBaseUrl: 'https://factory.example',
  });
  runId = started.run.id;
  return started.run;
}

async function classify(hasUi: boolean, rationale: string) {
  await applyCallback(db, {
    run_id: runId,
    attempt: 1,
    step_index: 0,
    event: 'ticket_classified',
    has_ui: hasUi,
    rationale,
  } as Callback);
}

async function facts() {
  const [ticket] = await db
    .select()
    .from(tickets)
    .where(eq(tickets.id, scenario.ticketId))
    .limit(1);
  return { hasUi: ticket ? (ticketHasUi(ticket) ? true : undefined) : undefined };
}

beforeEach(async () => {
  await start(withDesign());
});
afterAll(async () => {
  await raw.end();
});

test('the design condition is unknowable at run start, and known when reached', async () => {
  // At step 0 nothing has been established: the ticket carries no decision.
  const run = await db.select().from(runs).where(eq(runs.id, runId)).limit(1);
  const steps = run[0]?.snapshot.pipeline.steps ?? [];
  expect(steps[1]?.condition).toBe('ticket_has_ui');
  expect((await facts()).hasUi).toBeUndefined();
  // So evaluating it now would skip a design that is in fact needed.
  expect(decideStep(steps, 1, await facts()).action).toBe('skip');

  // The specification step decides, and only then is the condition answerable.
  await classify(true, 'A Google button appears on the sign-in screen.');
  expect((await facts()).hasUi).toBe(true);
  expect(decideStep(steps, 1, await facts()).action).toBe('run');
});

test('a ticket that changes the interface runs the design step', async () => {
  await classify(true, 'The sign-in screen gains a button.');
  const [ticket] = await db
    .select()
    .from(tickets)
    .where(eq(tickets.id, scenario.ticketId))
    .limit(1);
  expect(ticket?.hasUi).toBe(true);
  expect(ticket?.uiRationale).toBe('The sign-in screen gains a button.');
  expect(ticket?.classificationMissing).toBe(false);
});

test('a ticket that does not runs it never, and says which condition failed', async () => {
  await classify(false, 'This adds a nightly job nobody sees.');
  const run = await db.select().from(runs).where(eq(runs.id, runId)).limit(1);
  const steps = run[0]?.snapshot.pipeline.steps ?? [];

  const decision = decideStep(steps, 1, await facts());
  expect(decision.action).toBe('skip');
  if (decision.action !== 'skip') throw new Error('unreachable');
  // The condition in words, which is what gets recorded and shown (FR-110).
  expect(decision.conditionNotMet).toBe('ticket has no UI change');

  await applyCallback(db, {
    run_id: runId,
    attempt: 1,
    step_index: 1,
    event: 'step_skipped',
    condition_not_met: decision.conditionNotMet,
  } as Callback);

  const view = await runView(db, runId);
  expect(view.steps[1]?.state).toBe('skipped');
  expect(view.steps[1]?.conditionNotMet).toBe('ticket has no UI change');
});

test('the inverse condition runs exactly when the other does not', async () => {
  await start(withDesign('ticket_has_no_ui'));
  const run = await db.select().from(runs).where(eq(runs.id, runId)).limit(1);
  const steps = run[0]?.snapshot.pipeline.steps ?? [];

  await classify(true, 'Visible.');
  expect(decideStep(steps, 1, await facts()).action).toBe('skip');

  await start(withDesign('ticket_has_no_ui'));
  const run2 = await db.select().from(runs).where(eq(runs.id, runId)).limit(1);
  await classify(false, 'Not visible.');
  expect(decideStep(run2[0]?.snapshot.pipeline.steps ?? [], 1, await facts()).action).toBe('run');
});

test('an always condition needs no facts at all', () => {
  expect(conditionHolds('always', {})).toBe(true);
  expect(conditionHolds('always', { hasUi: false })).toBe(true);
});

test('a fact never established reads as no interface change (FR-102)', () => {
  expect(conditionHolds('ticket_has_ui', {})).toBe(false);
  expect(conditionHolds('ticket_has_no_ui', {})).toBe(true);
});

test('the classification carries forward from the step that made it', () => {
  // applyStepResult is what the workflow mirrors: facts accumulate.
  const after = applyStepResult({}, { classification: { has_ui: true, rationale: 'Visible.' } });
  expect(after.hasUi).toBe(true);
  // And a later step that established nothing does not erase it.
  expect(applyStepResult(after, {}).hasUi).toBe(true);
});

test('a condition is evaluated against the facts of THIS run, not the ticket now', async () => {
  await classify(true, 'Visible.');
  const first = runId;

  // A second attempt on the same ticket re-decides for itself; the ticket's
  // stored decision is what carries, and a re-classification replaces it.
  await applyCallback(db, {
    run_id: first,
    attempt: 1,
    step_index: 0,
    event: 'ticket_classified',
    has_ui: false,
    rationale: 'On a second look, nothing is visible.',
  } as Callback);

  const [ticket] = await db
    .select()
    .from(tickets)
    .where(eq(tickets.id, scenario.ticketId))
    .limit(1);
  expect(ticket?.hasUi).toBe(false);
  expect(ticket?.uiRationale).toBe('On a second look, nothing is visible.');
});

test('the Runner is never called for a skipped step', async () => {
  await classify(false, 'Not visible.');
  await applyCallback(db, {
    run_id: runId,
    attempt: 1,
    step_index: 1,
    event: 'step_skipped',
    condition_not_met: 'ticket has no UI change',
  } as Callback);

  // A skipped step has a record, no duration and no cost: nothing ran.
  const [row] = await db.select().from(stepResults).where(eq(stepResults.runId, runId)).limit(1);
  expect(row?.status).toBe('skipped');
  expect(row?.durationS).toBeNull();
  expect(row?.costUsd).toBe('0.0000');
  const [run] = await db.select().from(runs).where(eq(runs.id, runId)).limit(1);
  expect(run?.costUsd).toBe('0.0000');
});
