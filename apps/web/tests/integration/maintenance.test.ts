import { afterAll, beforeEach, expect, test } from 'bun:test';
import { runs, workspaces } from '@factory/db/schema';
import { eq, sql } from 'drizzle-orm';
import { sweep } from '../../src/lib/services/maintenance';
import { startRun } from '../../src/lib/services/run';
import type { Sandbox } from '../../src/lib/services/sandbox';
import { connect, type Scenario, seed, withCheckpoint } from '../fixtures';

/**
 * FR-064b, FR-081 and FR-086 — the three things that must happen when nobody
 * is there. Each has a service that decides it; until this pass existed
 * nothing called any of them, so a retained sandbox was retained forever and
 * SC-012 could not pass however correct the decision was.
 */

const { db, sql: raw } = connect();
let scenario: Scenario;
const base = { callbackBaseUrl: 'https://factory.example' };

/** Records every release request instead of calling a container host. */
function recorder() {
  const released: Sandbox[] = [];
  return {
    released,
    releaseSandbox: async (sandbox: Sandbox) => {
      released.push(sandbox);
    },
  };
}

beforeEach(async () => {
  scenario = await seed(db);
});
afterAll(async () => {
  await raw.end();
});

test('an empty workspace sweeps cleanly rather than erroring', async () => {
  const result = await sweep(db);
  expect(result).toEqual({
    gatesContinued: 0,
    gatesFailed: 0,
    runsStopped: 0,
    sandboxesReleased: 0,
    problems: [],
  });
});

test('a run past its cost ceiling is stopped and its sandbox released (FR-081)', async () => {
  const { run } = await startRun(db, { ticketId: scenario.ticketId, ...base });
  await db
    .update(runs)
    .set({
      status: 'running',
      containerId: 'container-7',
      costUsd: '9.0000',
      costCeilingUsd: '2.0000',
    })
    .where(eq(runs.id, run.id));

  const host = recorder();
  const result = await sweep(db, host);
  expect(result.runsStopped).toBe(1);

  const [after] = await db.select().from(runs).where(eq(runs.id, run.id)).limit(1);
  expect(after?.status).toBe('failed');
  expect(after?.failureReason).toMatch(/2\.0000/);
  // A run stopped at a ceiling has failed, so the Runner's retention rule
  // is the one that applies to it.
  expect(host.released).toEqual([{ runId: run.id, containerId: 'container-7', outcome: 'failed' }]);
  // And the release is recorded, so a leak stays visible (SC-012).
  expect(after?.containerId).toBeNull();
});

test('a finished run still naming a container has its sandbox released (FR-086)', async () => {
  const { run } = await startRun(db, { ticketId: scenario.ticketId, ...base });
  // Retention is zero, so a finished run's sandbox is due immediately.
  await db.update(workspaces).set({ retainFailedSandboxesHours: 0 });
  await db
    .update(runs)
    .set({ status: 'done', containerId: 'container-8', finishedAt: new Date() })
    .where(eq(runs.id, run.id));

  const host = recorder();
  const result = await sweep(db, host);
  expect(result.sandboxesReleased).toBe(1);
  // Always `done`: reaching the list IS the decision that retention is
  // over, so asking for it as a failure would start retention again.
  expect(host.released).toEqual([{ runId: run.id, containerId: 'container-8', outcome: 'done' }]);

  const [after] = await db.select().from(runs).where(eq(runs.id, run.id)).limit(1);
  expect(after?.containerId).toBeNull();
});

test('a failure inside its retention window is left alone, and released after', async () => {
  const { run } = await startRun(db, { ticketId: scenario.ticketId, ...base });
  await db.update(workspaces).set({ retainFailedSandboxesHours: 6 });
  await db
    .update(runs)
    .set({ status: 'failed', containerId: 'container-9', finishedAt: new Date() })
    .where(eq(runs.id, run.id));

  const early = recorder();
  expect((await sweep(db, early)).sandboxesReleased).toBe(0);
  expect(early.released).toEqual([]);
  // Still there for somebody to look inside, which is what retention is for.
  const [held] = await db.select().from(runs).where(eq(runs.id, run.id)).limit(1);
  expect(held?.containerId).toBe('container-9');

  // Seven hours later, the period has passed.
  await db
    .update(runs)
    .set({ finishedAt: sql`now() - interval '7 hours'` })
    .where(eq(runs.id, run.id));
  const late = recorder();
  expect((await sweep(db, late)).sandboxesReleased).toBe(1);
  expect(late.released.map((s) => s.containerId)).toEqual(['container-9']);
});

test('a sandbox that will not release stays on the record for the next pass', async () => {
  const { run } = await startRun(db, { ticketId: scenario.ticketId, ...base });
  await db.update(workspaces).set({ retainFailedSandboxesHours: 0 });
  await db
    .update(runs)
    .set({ status: 'cancelled', containerId: 'container-10', finishedAt: new Date() })
    .where(eq(runs.id, run.id));

  const result = await sweep(db, {
    releaseSandbox: async () => {
      throw new Error('the host is not answering');
    },
  });
  expect(result.sandboxesReleased).toBe(0);
  expect(result.problems).toEqual([
    `sandbox container-10 (run ${run.id}): the host is not answering`,
  ]);

  // The id is the only handle anything has for reclaiming the container.
  const [after] = await db.select().from(runs).where(eq(runs.id, run.id)).limit(1);
  expect(after?.containerId).toBe('container-10');
});

test('with no way to release, the sweep says so rather than reporting success', async () => {
  const { run } = await startRun(db, { ticketId: scenario.ticketId, ...base });
  await db.update(workspaces).set({ retainFailedSandboxesHours: 0 });
  await db
    .update(runs)
    .set({ status: 'done', containerId: 'container-11', finishedAt: new Date() })
    .where(eq(runs.id, run.id));

  const result = await sweep(db);
  expect(result.sandboxesReleased).toBe(0);
  expect(result.problems[0]).toMatch(/container-11 is due for release .* the runner address/);
});

test('a gate whose waiting time expired continues the run (FR-064b)', async () => {
  scenario = await seed(db, { steps: withCheckpoint('anyone', 1, 'continue') });
  const { run } = await startRun(db, { ticketId: scenario.ticketId, ...base });
  await db
    .update(runs)
    .set({
      status: 'waiting_approval',
      currentStepIndex: 1,
      resumeUrl: null,
      updatedAt: sql`now() - interval '2 hours'`,
    })
    .where(eq(runs.id, run.id));

  const result = await sweep(db);
  expect(result.gatesContinued).toBe(1);
  const [after] = await db.select().from(runs).where(eq(runs.id, run.id)).limit(1);
  expect(after?.status).toBe('running');
});

test('a gate set to fail on expiry fails the run, naming the wait', async () => {
  scenario = await seed(db, { steps: withCheckpoint('anyone', 1, 'fail') });
  const { run } = await startRun(db, { ticketId: scenario.ticketId, ...base });
  await db
    .update(runs)
    .set({
      status: 'waiting_approval',
      currentStepIndex: 1,
      updatedAt: sql`now() - interval '2 hours'`,
    })
    .where(eq(runs.id, run.id));

  const result = await sweep(db);
  expect(result.gatesFailed).toBe(1);
  const [after] = await db.select().from(runs).where(eq(runs.id, run.id)).limit(1);
  expect(after?.status).toBe('failed');
  expect(after?.failureReason).toMatch(/nobody decided the checkpoint within 1 hours/);
});

test('a gate still inside its waiting time is left waiting', async () => {
  scenario = await seed(db, { steps: withCheckpoint('anyone', 6, 'continue') });
  const { run } = await startRun(db, { ticketId: scenario.ticketId, ...base });
  await db
    .update(runs)
    .set({ status: 'waiting_approval', currentStepIndex: 1 })
    .where(eq(runs.id, run.id));

  const result = await sweep(db);
  expect(result.gatesContinued).toBe(0);
  const [after] = await db.select().from(runs).where(eq(runs.id, run.id)).limit(1);
  expect(after?.status).toBe('waiting_approval');
});

test('sweeping twice changes nothing the second time', async () => {
  const { run } = await startRun(db, { ticketId: scenario.ticketId, ...base });
  await db.update(workspaces).set({ retainFailedSandboxesHours: 0 });
  await db
    .update(runs)
    .set({ status: 'done', containerId: 'container-12', finishedAt: new Date() })
    .where(eq(runs.id, run.id));

  const first = recorder();
  expect((await sweep(db, first)).sandboxesReleased).toBe(1);
  const second = recorder();
  const result = await sweep(db, second);
  // Idempotent, so a scheduler that overlaps two passes cannot double-release
  // or double-report.
  expect(result.sandboxesReleased).toBe(0);
  expect(second.released).toEqual([]);
  expect(result.problems).toEqual([]);
});
