import { afterAll, beforeEach, expect, test } from 'bun:test';
import { runs, stepResults, tickets } from '@factory/db/schema';
import type { Callback, Step } from '@factory/shared';
import { eq } from 'drizzle-orm';
import { applyCallback } from '../../src/lib/services/callbacks';
import { startRun } from '../../src/lib/services/run';
import { runView } from '../../src/lib/services/run-view';
import { connect, type Scenario, seed } from '../fixtures';

/**
 * FR-110, FR-111, FR-112 — a skipped step is recorded with the condition it
 * did not meet, never fails its run, and is one of five distinguishable
 * outcomes rather than a flag on `done`. The distinction matters because
 * "we chose not to" and "it worked" lead a reader to different conclusions.
 */

const { db, sql: raw } = connect();
let scenario: Scenario;
let runId: string;

/** Five steps, so every outcome can exist on one run at once. */
const fiveSteps = (specId: string, implId: string): Step[] => [
  { type: 'agent', condition: 'always', agent_id: specId, output_files: ['docs/spec.md'] },
  { type: 'design', condition: 'ticket_has_ui', agent_id: specId },
  { type: 'agent', condition: 'always', agent_id: implId, output_files: [] },
  { type: 'shell', condition: 'always', command: 'bun test' },
  { type: 'agent', condition: 'always', agent_id: implId, output_files: [] },
];

beforeEach(async () => {
  scenario = await seed(db, { steps: fiveSteps });
  const started = await startRun(db, {
    ticketId: scenario.ticketId,
    callbackBaseUrl: 'https://factory.example',
  });
  runId = started.run.id;
});
afterAll(async () => {
  await raw.end();
});

const post = (body: Record<string, unknown>) =>
  applyCallback(db, { run_id: runId, attempt: 1, ...body } as Callback);

test('a skipped step is recorded with the condition it did not meet (FR-110)', async () => {
  const { applied } = await post({
    step_index: 1,
    event: 'step_skipped',
    condition_not_met: 'ticket has no UI change',
  });
  expect(applied).toBe(true);

  const [row] = await db.select().from(stepResults).where(eq(stepResults.runId, runId)).limit(1);
  expect(row?.status).toBe('skipped');
  expect(row?.conditionNotMet).toBe('ticket has no UI change');
  // Not omitted, and not silently a success.
  expect(row?.finishedAt).not.toBeNull();
});

test('a skipped step does not fail the run: it continues at the next one (FR-111)', async () => {
  await post({
    step_index: 1,
    event: 'step_skipped',
    condition_not_met: 'ticket has no UI change',
  });

  const [run] = await db.select().from(runs).where(eq(runs.id, runId)).limit(1);
  expect(run?.status).not.toBe('failed');
  expect(run?.failureReason).toBeNull();
  const [ticket] = await db
    .select()
    .from(tickets)
    .where(eq(tickets.id, scenario.ticketId))
    .limit(1);
  expect(ticket?.status).not.toBe('failed');

  // And the next step runs.
  await post({ step_index: 2, event: 'step_started' });
  await post({
    step_index: 2,
    event: 'step_finished',
    status: 'done',
    duration_s: 8,
    cost_usd: '0.3000',
    artifacts: [],
  });
  const view = await runView(db, runId);
  expect(view.steps[2]?.state).toBe('done');
});

test('all five outcomes are distinguishable on one run (FR-112)', async () => {
  await post({
    step_index: 0,
    event: 'step_finished',
    status: 'done',
    duration_s: 5,
    cost_usd: '0.2000',
    artifacts: [],
  });
  await post({
    step_index: 1,
    event: 'step_skipped',
    condition_not_met: 'ticket has no UI change',
  });
  await post({ step_index: 2, event: 'step_started' });
  await post({
    step_index: 3,
    event: 'step_finished',
    status: 'failed',
    duration_s: 3,
    cost_usd: '0.0000',
    artifacts: [],
  });
  // Step 4 was never reached.

  const view = await runView(db, runId);
  expect(view.steps.map((step) => step.state)).toEqual([
    'done',
    'skipped',
    'running',
    'failed',
    'pending',
  ]);
  // Five distinct values, not four with a flag.
  expect(new Set(view.steps.map((s) => s.state)).size).toBe(5);
});

test('a skipped step is terminal for itself: it cannot later become done', async () => {
  await post({
    step_index: 1,
    event: 'step_skipped',
    condition_not_met: 'ticket has no UI change',
  });

  // A late finish for the same step is the duplicate FR-095 drops, not a
  // promotion: only a `running` step may finish.
  const { applied } = await post({
    step_index: 1,
    event: 'step_finished',
    status: 'done',
    duration_s: 9,
    cost_usd: '0.5000',
    artifacts: [],
  });
  expect(applied).toBe(false);

  const [row] = await db.select().from(stepResults).where(eq(stepResults.runId, runId)).limit(1);
  expect(row?.status).toBe('skipped');
  expect(row?.costUsd).toBe('0.0000');
  // And nothing was charged for a step that never ran.
  const [run] = await db.select().from(runs).where(eq(runs.id, runId)).limit(1);
  expect(run?.costUsd).toBe('0.0000');
});

test('a repeated skip is a no-op, not a second record', async () => {
  await post({
    step_index: 1,
    event: 'step_skipped',
    condition_not_met: 'ticket has no UI change',
  });
  const second = await post({
    step_index: 1,
    event: 'step_skipped',
    condition_not_met: 'ticket has no UI change',
  });
  expect(second.applied).toBe(false);
  expect(await db.select().from(stepResults).where(eq(stepResults.runId, runId))).toHaveLength(1);
});

test('a run whose only skipped step is the design step still reaches done', async () => {
  await post({
    step_index: 1,
    event: 'step_skipped',
    condition_not_met: 'ticket has no UI change',
  });
  for (const index of [0, 2, 3, 4]) {
    await post({
      step_index: index,
      event: 'step_finished',
      status: 'done',
      duration_s: 4,
      cost_usd: '0.1000',
      artifacts: [],
    });
  }
  await post({
    step_index: 4,
    event: 'done',
    merge_request_url: 'https://gitlab.com/netgroup/shop/-/merge_requests/9',
    cost_usd: '0.4000',
  });

  const [run] = await db.select().from(runs).where(eq(runs.id, runId)).limit(1);
  expect(run?.status).toBe('done');
  const [ticket] = await db
    .select()
    .from(tickets)
    .where(eq(tickets.id, scenario.ticketId))
    .limit(1);
  expect(ticket?.status).toBe('done');
  expect(ticket?.mergeRequestUrl).toBe('https://gitlab.com/netgroup/shop/-/merge_requests/9');
  // The skipped step is still in the record, marked, with its reason (FR-075a).
  const view = await runView(db, runId);
  expect(view.steps[1]?.state).toBe('skipped');
  expect(view.steps[1]?.conditionNotMet).toBe('ticket has no UI change');
});
