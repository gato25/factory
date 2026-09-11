import { afterAll, beforeEach, expect, test } from 'bun:test';
import { approvals, runs, tickets } from '@factory/db/schema';
import type { Callback, ResumeRequest } from '@factory/shared';
import { eq } from 'drizzle-orm';
import { applyCallback } from '../../src/lib/services/callbacks';
import { applyTimeout, decide, expiredGates } from '../../src/lib/services/gate';
import { startRun } from '../../src/lib/services/run';
import { connect, type Scenario, seed, withCheckpoint } from '../fixtures';

/**
 * What a gate does when nobody decides in time: wait indefinitely, continue
 * anyway, or fail the run (FR-064b). Whichever happens is recorded as having
 * happened without a human (FR-063).
 */

const { db, sql: raw } = connect();
let scenario: Scenario;
let runId: string;
let sent: ResumeRequest[] = [];

const resume = async (_url: string, body: ResumeRequest) => {
  sent.push(body);
  return { ok: true };
};

async function pauseAtGate(hours: number | undefined, onTimeout: 'wait' | 'continue' | 'fail') {
  scenario = await seed(db, { steps: withCheckpoint('anyone', hours, onTimeout) });
  const started = await startRun(db, {
    ticketId: scenario.ticketId,
    callbackBaseUrl: 'https://factory.example',
  });
  runId = started.run.id;
  await applyCallback(db, {
    run_id: runId,
    attempt: 1,
    step_index: 0,
    event: 'step_finished',
    status: 'done',
    duration_s: 3,
    cost_usd: '0.1000',
    artifacts: [{ kind: 'document', path: 'docs/spec.md', version: 1 }],
  } as Callback);
  await applyCallback(db, {
    run_id: runId,
    attempt: 1,
    step_index: 1,
    event: 'waiting_approval',
    resume_url: 'https://n8n.example/resume/abc',
    approvers: [],
  } as Callback);
}

/** Reaches back in time, so a real wait is not needed to test the expiry. */
async function pausedSince(hoursAgo: number) {
  await db
    .update(runs)
    .set({ updatedAt: new Date(Date.now() - hoursAgo * 3_600_000) })
    .where(eq(runs.id, runId));
}

async function state() {
  const [run] = await db.select().from(runs).where(eq(runs.id, runId)).limit(1);
  const [ticket] = await db
    .select()
    .from(tickets)
    .where(eq(tickets.id, scenario.ticketId))
    .limit(1);
  const [approval] = await db.select().from(approvals).where(eq(approvals.runId, runId)).limit(1);
  return { run, ticket, approval };
}

beforeEach(() => {
  sent = [];
});
afterAll(async () => {
  await raw.end();
});

test('wait: the gate holds indefinitely and nothing is decided for anyone', async () => {
  await pauseAtGate(2, 'wait');
  await pausedSince(1000);

  expect(await applyTimeout(db, runId, 1, { resume })).toEqual({ action: 'wait' });

  const { run, ticket, approval } = await state();
  expect(run?.status).toBe('waiting_approval');
  expect(ticket?.status).toBe('waiting_approval');
  expect(approval).toBeUndefined();
  expect(sent).toEqual([]);
});

test('a gate with no expiry at all also waits', async () => {
  await pauseAtGate(undefined, 'wait');
  await pausedSince(1000);

  // Nothing is even due, so nothing drives it.
  expect(await expiredGates(db)).toEqual([]);
  expect(await applyTimeout(db, runId, 1, { resume })).toEqual({ action: 'wait' });
  expect((await state()).run?.status).toBe('waiting_approval');
});

test('continue: the run goes on and the decision is recorded without a human', async () => {
  await pauseAtGate(2, 'continue');
  await pausedSince(3);

  expect(await expiredGates(db)).toEqual([{ runId, stepIndex: 1 }]);
  expect(await applyTimeout(db, runId, 1, { resume })).toEqual({ action: 'continue' });

  const { run, ticket, approval } = await state();
  expect(run?.status).toBe('running');
  expect(ticket?.status).toBe('running');
  expect(approval?.decision).toBe('approved');
  expect(approval?.decidedBy).toBeNull();
  expect(approval?.timedOut).toBe(true);
  // The orchestrator is told to carry on, exactly as an approval would.
  expect(sent).toEqual([{ decision: 'approved' }]);
});

test('fail: the run fails at the gate and says why', async () => {
  await pauseAtGate(4, 'fail');
  await pausedSince(5);

  expect(await expiredGates(db)).toEqual([{ runId, stepIndex: 1 }]);
  expect(await applyTimeout(db, runId, 1, { resume })).toEqual({ action: 'fail' });

  const { run, ticket, approval } = await state();
  expect(run?.status).toBe('failed');
  expect(run?.failureReason).toBe('nobody decided the checkpoint within 4 hours');
  expect(run?.failureStepIndex).toBe(1);
  expect(ticket?.status).toBe('failed');
  expect(approval?.decision).toBe('cancelled');
  expect(approval?.decidedBy).toBeNull();
  expect(approval?.timedOut).toBe(true);
  // A failed run is not resumed.
  expect(sent).toEqual([]);
});

test('a gate is not due until its waiting time has actually passed', async () => {
  await pauseAtGate(6, 'fail');
  await pausedSince(5);

  expect(await expiredGates(db)).toEqual([]);
  expect((await state()).run?.status).toBe('waiting_approval');
});

test('a decision beats the expiry: the timeout leaves it alone', async () => {
  await pauseAtGate(2, 'fail');
  const approver = {
    id: scenario.userId,
    name: 'Bat',
    email: 'bat@netgroup.mn',
    role: 'member' as const,
  };
  await decide(db, { runId, stepIndex: 1, decision: 'approved' }, approver, { resume });
  await pausedSince(100);

  expect(await applyTimeout(db, runId, 1, { resume })).toEqual({ action: 'wait' });

  const { run, approval } = await state();
  // Still the human's approval, not a timeout cancellation.
  expect(run?.status).toBe('running');
  expect(approval?.decision).toBe('approved');
  expect(approval?.decidedBy).toBe(approver.id);
  expect(approval?.timedOut).toBe(false);
  expect(await db.select().from(approvals).where(eq(approvals.runId, runId))).toHaveLength(1);
});

test('expiring the same gate twice at once decides it once', async () => {
  await pauseAtGate(1, 'continue');
  await pausedSince(2);

  // Whatever drives the timeouts may see the same due gate twice. However the
  // two passes interleave, the gate ends up with one decision — an expiry is
  // never an error the caller has to handle.
  await Promise.all([
    applyTimeout(db, runId, 1, { resume }),
    applyTimeout(db, runId, 1, { resume }),
  ]);

  expect(await db.select().from(approvals).where(eq(approvals.runId, runId))).toHaveLength(1);
  expect((await state()).approval?.timedOut).toBe(true);
});

test('an already-expired gate is left alone on the next pass', async () => {
  await pauseAtGate(1, 'continue');
  await pausedSince(2);

  await applyTimeout(db, runId, 1, { resume });
  // It is no longer waiting, so it is no longer due.
  expect(await expiredGates(db)).toEqual([]);
  expect(await applyTimeout(db, runId, 1, { resume })).toEqual({ action: 'wait' });
  expect(await db.select().from(approvals).where(eq(approvals.runId, runId))).toHaveLength(1);
});
