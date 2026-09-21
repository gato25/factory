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

test('a skipped step counts as settled, and a run with nothing left cannot be continued', async () => {
  // The seeded pipeline has two steps. Finish one, skip the other: every step
  // is settled, and continuing has nothing to do — which is said, not done.
  await applyCallback(db, { ...envelope('started'), container_id: 'ws-1' } as Callback);
  await applyCallback(db, {
    ...envelope('step_finished', 0),
    status: 'done',
    duration_s: 1,
    cost_usd: '0.1000',
    artifacts: [],
  } as Callback);
  expect((await continueRun(db, runId)).index).toBe(1);
  await applyCallback(db, {
    ...envelope('step_skipped', 1),
    condition_not_met: 'ticket has no UI change',
  } as Callback);
  let thrown: unknown;
  try {
    await continueRun(db, runId);
  } catch (error) {
    thrown = error;
  }
  expect((thrown as Error)?.message).toContain('nothing left to continue');
});

test('a run waiting at a checkpoint is decided there, not continued', async () => {
  await applyCallback(db, { ...envelope('started'), container_id: 'ws-1' } as Callback);
  await applyCallback(db, {
    ...envelope('waiting_approval', 2),
    resume_url: 'https://n8n.example/resume/abc',
    approvers: [],
  } as Callback);
  // A try/catch rather than `.rejects`: Bun's matcher never settles when the
  // promise is made right after database work in the same tick, and the
  // whole file then times out with a session left mid-query.
  let thrown: unknown;
  try {
    await continueRun(db, runId);
  } catch (error) {
    thrown = error;
  }
  expect((thrown as { reason?: string })?.reason).toBe('conflict');
  expect((thrown as Error).message).toContain('checkpoint');
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

test('a failed run stops being failed, or it cannot get its credentials', async () => {
  const { runs } = await import('@factory/db/schema');
  const { eq } = await import('drizzle-orm');
  await applyCallback(db, { ...envelope('started'), container_id: 'ws-1' } as Callback);
  await applyCallback(db, {
    ...envelope('step_finished', 0),
    status: 'done',
    duration_s: 12,
    cost_usd: '0.2000',
    artifacts: [],
  } as Callback);
  await db
    .update(runs)
    .set({
      status: 'failed',
      failureReason: 'time_exceeded',
      failureStepIndex: 1,
      finishedAt: new Date(),
    })
    .where(eq(runs.id, runId));

  const { index } = await continueRun(db, runId);
  expect(index).toBe(1);

  // Everything the execution service does begins by asking for credentials,
  // and that route refuses a run whose status is terminal. Left `failed`,
  // continuing was accepted and then killed with "that run has ended".
  const [after] = await db.select().from(runs).where(eq(runs.id, runId)).limit(1);
  expect(after?.status).toBe('queued');
  expect(after?.failureReason).toBeNull();
  expect(after?.failureStepIndex).toBeNull();
  expect(after?.finishedAt).toBeNull();
});

test('a cancelled run is not revived — somebody stopped that one on purpose', async () => {
  const { runs } = await import('@factory/db/schema');
  const { eq } = await import('drizzle-orm');
  await db.update(runs).set({ status: 'cancelled' }).where(eq(runs.id, runId));
  let thrown: unknown;
  try {
    await continueRun(db, runId);
  } catch (error) {
    thrown = error;
  }
  expect((thrown as Error)?.message).toContain('cancelled');
});
