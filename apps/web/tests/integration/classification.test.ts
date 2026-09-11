import { afterAll, beforeEach, expect, test } from 'bun:test';
import { runs, tickets } from '@factory/db/schema';
import type { Callback, Step } from '@factory/shared';
import { eq } from 'drizzle-orm';
import { parseClassification } from '../../../runner/src/outputs/classification';
import { applyCallback } from '../../src/lib/services/callbacks';
import { startRun } from '../../src/lib/services/run';
import { runView } from '../../src/lib/services/run-view';
import { classifyingStepIndex, ticketHasUi } from '../../src/lib/services/ticket';
import { connect, type Scenario, seed } from '../fixtures';

/**
 * FR-102 — no usable decision arrived. The ticket is treated as not changing
 * the interface, the run continues, and the absence is a field on the run
 * rather than a line in step output. `has_ui` stays null on purpose: "could
 * not tell" is a different claim from "decided no", and the warning is what
 * the difference is for.
 */

const { db, sql: raw } = connect();
let scenario: Scenario;
let runId: string;

const withDesign = (specId: string, implId: string): Step[] => [
  { type: 'agent', condition: 'always', agent_id: specId, output_files: ['docs/spec.md'] },
  { type: 'design', condition: 'ticket_has_ui', agent_id: specId },
  { type: 'agent', condition: 'always', agent_id: implId, output_files: [] },
];

const post = (body: Record<string, unknown>) =>
  applyCallback(db, { run_id: runId, attempt: 1, ...body } as Callback);

async function ticket() {
  const [row] = await db.select().from(tickets).where(eq(tickets.id, scenario.ticketId)).limit(1);
  return row;
}

/** The specification step finishing, with or without a decision. */
async function specFinishes(options: { classified?: { hasUi: boolean; why: string } } = {}) {
  if (options.classified) {
    await post({
      step_index: 0,
      event: 'ticket_classified',
      has_ui: options.classified.hasUi,
      rationale: options.classified.why,
    });
  }
  await post({
    step_index: 0,
    event: 'step_finished',
    status: 'done',
    duration_s: 7,
    cost_usd: '0.2000',
    artifacts: [{ kind: 'document', path: 'docs/spec.md', version: 1 }],
  });
}

beforeEach(async () => {
  scenario = await seed(db, { steps: withDesign });
  const started = await startRun(db, {
    ticketId: scenario.ticketId,
    callbackBaseUrl: 'https://factory.example',
  });
  runId = started.run.id;
});
afterAll(async () => {
  await raw.end();
});

test('no decision: the run continues and the absence becomes a field', async () => {
  await specFinishes();

  const row = await ticket();
  expect(row?.classificationMissing).toBe(true);
  // Null, not false: nobody decided.
  expect(row?.hasUi).toBeNull();
  expect(row?.uiRationale).toBeNull();

  // The run is not failed.
  const [run] = await db.select().from(runs).where(eq(runs.id, runId)).limit(1);
  expect(run?.status).not.toBe('failed');
  expect(run?.failureReason).toBeNull();
});

test('the warning is readable from the run view, not only from step output', async () => {
  await specFinishes();
  const view = await runView(db, runId);
  expect(view.ticket.classificationMissing).toBe(true);
  expect(view.ticket.hasUi).toBeNull();
  expect(view.ticket.uiRationale).toBeNull();
});

test('an absent decision reads as no interface change, so the design step skips', async () => {
  await specFinishes();
  const row = await ticket();
  if (!row) throw new Error('no ticket');
  expect(ticketHasUi(row)).toBe(false);

  // Which is what the workflow does with it: skip, with a reason.
  await post({
    step_index: 1,
    event: 'step_skipped',
    condition_not_met: 'ticket has no UI change',
  });
  const view = await runView(db, runId);
  expect(view.steps[1]?.state).toBe('skipped');
  // And the run reaches the implementing step regardless.
  await post({ step_index: 2, event: 'step_started' });
  expect((await runView(db, runId)).steps[2]?.state).toBe('running');
});

test('a decision that arrives clears the warning', async () => {
  await specFinishes({ classified: { hasUi: true, why: 'The sign-in screen gains a button.' } });

  const row = await ticket();
  expect(row?.classificationMissing).toBe(false);
  expect(row?.hasUi).toBe(true);
  expect(row?.uiRationale).toBe('The sign-in screen gains a button.');
});

test('a decision of false is not the same state as no decision', async () => {
  await specFinishes({ classified: { hasUi: false, why: 'A nightly job nobody sees.' } });

  const row = await ticket();
  // Decided, with a reason. The design step skips either way — but a reader
  // can tell which happened.
  expect(row?.hasUi).toBe(false);
  expect(row?.classificationMissing).toBe(false);
  expect(row?.uiRationale).toBe('A nightly job nobody sees.');
});

test('only the step expected to classify is judged', async () => {
  // A later document-producing step finding no classification says nothing
  // new, and must not raise the warning a second time or on its own.
  await specFinishes({ classified: { hasUi: true, why: 'Visible.' } });
  await post({
    step_index: 2,
    event: 'step_finished',
    status: 'done',
    duration_s: 4,
    cost_usd: '0.1000',
    artifacts: [{ kind: 'document', path: 'docs/plan.md', version: 1 }],
  });

  expect((await ticket())?.classificationMissing).toBe(false);
});

test('a specification step that FAILED is not accused of a missing decision', async () => {
  await post({
    step_index: 0,
    event: 'step_finished',
    status: 'failed',
    duration_s: 2,
    cost_usd: '0.0100',
    artifacts: [],
  });
  // It failed; that is the reason to show, not a missing classification.
  expect((await ticket())?.classificationMissing).toBe(false);
});

test('the classifying step is the first that writes a document', async () => {
  const [run] = await db.select().from(runs).where(eq(runs.id, runId)).limit(1);
  expect(classifyingStepIndex(run?.snapshot.pipeline.steps ?? [])).toBe(0);

  // A pipeline whose first step is a shell command classifies at the agent.
  expect(
    classifyingStepIndex([
      { type: 'shell', condition: 'always', command: 'bun install' },
      { type: 'agent', condition: 'always', agent_id: 'a', output_files: ['docs/spec.md'] },
    ]),
  ).toBe(1);
  // And a pipeline with no document-producing step classifies nowhere.
  expect(
    classifyingStepIndex([{ type: 'shell', condition: 'always', command: 'bun test' }]),
  ).toBeNull();
});

/** The parser the Runner uses, since an unparseable block is the usual cause. */
test('an unparseable decision block yields no classification at all', () => {
  expect(parseClassification('# Spec\n\nNo block.')).toBeNull();
  expect(parseClassification('```factory\nhas_ui: maybe\nrationale: unsure\n```')).toBeNull();
  // A decision with no reason is not usable: FR-099 requires the reason.
  expect(parseClassification('```factory\nhas_ui: true\n```')).toBeNull();
});

test('a well-formed block is read, and the last one wins', () => {
  expect(
    parseClassification('```factory\nhas_ui: true\nrationale: A button appears.\n```'),
  ).toEqual({ has_ui: true, rationale: 'A button appears.' });
  // A document that quotes the format while explaining it, then uses it.
  expect(
    parseClassification(
      'Use this:\n```factory\nhas_ui: true\nrationale: Example.\n```\n' +
        'Mine:\n```factory\nhas_ui: false\nrationale: Nothing visible changes.\n```',
    ),
  ).toEqual({ has_ui: false, rationale: 'Nothing visible changes.' });
});
