import { afterAll, beforeEach, expect, test } from 'bun:test';
import type { Callback } from '@factory/shared';
import { applyCallback } from '../../src/lib/services/callbacks';
import { continueRun } from '../../src/lib/services/continue';
import { startRun } from '../../src/lib/services/run';
import { connect, type Scenario, seed } from '../fixtures';

/**
 * Continuing a stuck run from its first unfinished step.
 *
 * The orchestrator's execution can die with the run recorded as `running`
 * and nothing driving it. What the run had established is in the database,
 * and continuing hands the same snapshot back with a resume block built from
 * it — so the finished steps, their cost and the classification are kept
 * rather than paid for again.
 */

const { db, sql: raw } = connect();
let scenario: Scenario;
let runId: string;

beforeEach(async () => {
  scenario = await seed(db);
  const started = await startRun(db, {
    ticketId: scenario.ticketId,
    callbackBaseUrl: 'https://factory.example',
  });
  runId = started.run.id;
});
afterAll(async () => {
  await raw.end();
});

const envelope = (event: Callback['event'], stepIndex = 0) =>
  ({ run_id: runId, attempt: 1, step_index: stepIndex, event }) as Callback;

test('picks up at the first unfinished step with the cost and facts so far', async () => {
  await applyCallback(db, { ...envelope('started'), container_id: 'ws-1' } as Callback);
  await applyCallback(db, envelope('step_started', 0));
  await applyCallback(db, {
    ...envelope('step_finished', 0),
    status: 'done',
    duration_s: 141,
    cost_usd: '0.9976',
    artifacts: [{ kind: 'document', path: 'docs/spec.md', version: 1 }],
  } as Callback);
  await applyCallback(db, {
    ...envelope('ticket_classified', 0),
    has_ui: true,
    rationale: 'every admin screen changes',
  } as Callback);
  // The next step began, and then the execution driving it died.
  await applyCallback(db, envelope('step_started', 1));

  const { snapshot, index, stepName } = await continueRun(db, runId);
  expect(index).toBe(1);
  expect(snapshot.resume).toEqual({ index: 1, facts: { hasUi: true }, spent_usd: 0.9976 });
  // Everything else is the snapshot the run was started with.
  expect(snapshot.run_id).toBe(runId);
  expect(snapshot.pipeline.steps.length).toBeGreaterThan(1);
  expect(stepName.length).toBeGreaterThan(0);
});

test('a run that never got going continues from the start with nothing known', async () => {
  const { snapshot } = await continueRun(db, runId);
  expect(snapshot.resume).toEqual({ index: 0, facts: {}, spent_usd: 0 });
});

test('a finished step counts as settled, and so does a skipped one', async () => {
  await applyCallback(db, { ...envelope('started'), container_id: 'ws-1' } as Callback);
  await applyCallback(db, {
    ...envelope('step_finished', 0),
    status: 'done',
    duration_s: 1,
    cost_usd: '0.1000',
    artifacts: [],
  } as Callback);
  await applyCallback(db, {
    ...envelope('step_skipped', 1),
    condition_not_met: 'ticket has no UI change',
  } as Callback);
  expect((await continueRun(db, runId)).index).toBe(2);
});

test('a run waiting at a checkpoint is decided there, not continued', async () => {
  await applyCallback(db, { ...envelope('started'), container_id: 'ws-1' } as Callback);
  await applyCallback(db, {
    ...envelope('waiting_approval', 2),
    resume_url: 'https://n8n.example/resume/abc',
    approvers: [],
  } as Callback);
  await expect(continueRun(db, runId)).rejects.toMatchObject({ reason: 'conflict' });
});

test('the stale "not started yet" reason is cleared when a person continues', async () => {
  const { runs } = await import('@factory/db/schema');
  const { eq } = await import('drizzle-orm');
  await db
    .update(runs)
    .set({ failureReason: 'not started yet: the orchestrator could not be reached (timeout)' })
    .where(eq(runs.id, runId));
  await continueRun(db, runId);
  const [row] = await db
    .select({ reason: runs.failureReason })
    .from(runs)
    .where(eq(runs.id, runId));
  expect(row?.reason).toBeNull();
});
