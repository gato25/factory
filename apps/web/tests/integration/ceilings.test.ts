import { afterAll, beforeEach, expect, test } from 'bun:test';
import { runs, tickets } from '@factory/db/schema';
import type { Callback } from '@factory/shared';
import { eq, sql } from 'drizzle-orm';
import {
  breachOf,
  consumption,
  enforceCeilings,
  mayStartAnotherStep,
} from '../../src/lib/ledger/enforce';
import { applyCallback } from '../../src/lib/services/callbacks';
import { startRun } from '../../src/lib/services/run';
import { connect, type Scenario, seed } from '../fixtures';

/**
 * SC-006 — no run exceeds its cost ceiling by more than 5%. The guarantee is
 * structural rather than statistical: a step is only started while the run is
 * still under its ceiling, so the most a run can overshoot by is one step's
 * cost. These tests measure that overshoot rather than asserting a rule.
 */

const { db, sql: raw } = connect();
let scenario: Scenario;
let runId: string;

async function startWithCeiling(costUsd: string, minutes = 45) {
  scenario = await seed(db);
  const started = await startRun(db, {
    ticketId: scenario.ticketId,
    callbackBaseUrl: 'https://factory.example',
  });
  runId = started.run.id;
  await db
    .update(runs)
    .set({ costCeilingUsd: costUsd, timeCeilingMinutes: minutes, status: 'running' })
    .where(eq(runs.id, runId));
  return runId;
}

/** A step that finished having spent this much. */
async function spend(stepIndex: number, costUsd: string) {
  await applyCallback(db, {
    run_id: runId,
    attempt: 1,
    step_index: stepIndex,
    event: 'step_finished',
    status: 'done',
    duration_s: 5,
    cost_usd: costUsd,
    artifacts: [],
  } as Callback);
}

beforeEach(async () => {
  await startWithCeiling('1.0000');
});
afterAll(async () => {
  await raw.end();
});

test('a run under its ceiling may start another step', async () => {
  await spend(0, '0.3000');
  expect(await mayStartAnotherStep(db, runId)).toEqual({ ok: true });
  expect(await breachOf(db, runId)).toBeNull();
});

test('a run that has consumed exactly its ceiling may not start another step', async () => {
  await spend(0, '1.0000');
  const verdict = await mayStartAnotherStep(db, runId);
  expect(verdict.ok).toBe(false);
  if (verdict.ok) throw new Error('unreachable');
  expect(verdict.breach.kind).toBe('cost');
  expect(verdict.breach.reason).toBe(
    'the run reached its cost ceiling of $1.0000 after spending $1.0000',
  );
});

test('reaching the ceiling fails the run, naming the ceiling and what was spent', async () => {
  await spend(0, '0.9000');
  await spend(1, '0.4000');

  const result = await enforceCeilings(db, runId);
  expect(result.failed).toBe(true);

  const [run] = await db.select().from(runs).where(eq(runs.id, runId)).limit(1);
  expect(run?.status).toBe('failed');
  expect(run?.failureReason).toBe(
    'the run reached its cost ceiling of $1.0000 after spending $1.3000',
  );
  // What it actually consumed is on the record too, not only the ceiling.
  expect(run?.costUsd).toBe('1.3000');
});

test('the sandbox is released when a ceiling stops the run', async () => {
  await db.update(runs).set({ containerId: 'container-42' }).where(eq(runs.id, runId));
  await spend(0, '2.0000');

  const released: string[] = [];
  await enforceCeilings(db, runId, {
    releaseSandbox: async (id) => {
      released.push(id);
    },
  });
  expect(released).toEqual(['container-42']);
});

test('a sandbox that will not release still leaves the run failed', async () => {
  await db.update(runs).set({ containerId: 'container-43' }).where(eq(runs.id, runId));
  await spend(0, '2.0000');

  const result = await enforceCeilings(db, runId, {
    releaseSandbox: async () => {
      throw new Error('the host is not answering');
    },
  });
  expect(result.failed).toBe(true);
  const [run] = await db.select().from(runs).where(eq(runs.id, runId)).limit(1);
  expect(run?.status).toBe('failed');
});

test('enforcing twice does not change the reason the second time', async () => {
  await spend(0, '1.5000');
  const first = await enforceCeilings(db, runId);
  const [afterFirst] = await db.select().from(runs).where(eq(runs.id, runId)).limit(1);

  const second = await enforceCeilings(db, runId);
  const [afterSecond] = await db.select().from(runs).where(eq(runs.id, runId)).limit(1);

  expect(first.failed).toBe(true);
  expect(second.failed).toBe(false);
  expect(afterSecond?.failureReason).toBe(afterFirst?.failureReason ?? null);
  expect(afterSecond?.finishedAt?.getTime()).toBe(afterFirst?.finishedAt?.getTime());
});

test('a finished run is not retrospectively failed by its own cost', async () => {
  await spend(0, '1.5000');
  await db.update(runs).set({ status: 'done' }).where(eq(runs.id, runId));

  expect(await enforceCeilings(db, runId)).toEqual({ failed: false });
  const [run] = await db.select().from(runs).where(eq(runs.id, runId)).limit(1);
  expect(run?.status).toBe('done');
  expect(run?.failureReason).toBeNull();
});

test('the time ceiling is measured from the run own start, and fails the run', async () => {
  await startWithCeiling('100.0000', 30);
  await db
    .update(runs)
    .set({ startedAt: sql`now() - interval '31 minutes'` })
    .where(eq(runs.id, runId));

  const breach = await breachOf(db, runId);
  expect(breach?.kind).toBe('time');
  expect(breach?.reason).toBe(
    'the run reached its time ceiling of 30 minutes after running for 31',
  );

  const result = await enforceCeilings(db, runId);
  expect(result.failed).toBe(true);
  const [run] = await db.select().from(runs).where(eq(runs.id, runId)).limit(1);
  expect(run?.failureReason).toContain('time ceiling of 30 minutes');
});

test('a run inside its time ceiling is not stopped', async () => {
  await startWithCeiling('100.0000', 30);
  await db
    .update(runs)
    .set({ startedAt: sql`now() - interval '29 minutes'` })
    .where(eq(runs.id, runId));
  expect(await breachOf(db, runId)).toBeNull();
});

test('the failure points at whichever step was in flight', async () => {
  await spend(0, '0.9000');
  await applyCallback(db, {
    run_id: runId,
    attempt: 1,
    step_index: 1,
    event: 'step_started',
  } as Callback);
  await db.update(runs).set({ costUsd: '1.2000' }).where(eq(runs.id, runId));

  await enforceCeilings(db, runId);
  const [run] = await db.select().from(runs).where(eq(runs.id, runId)).limit(1);
  expect(run?.failureStepIndex).toBe(1);
});

/**
 * What the mechanism actually guarantees: because a step is only started
 * while the run is still under its ceiling, the most a run can overshoot by
 * is ONE step's cost. That is the bound, and it is the bound whatever the
 * steps cost.
 */
test('a run overshoots by at most the cost of the one step that took it over', async () => {
  const ceiling = 1;

  // Step costs chosen to land awkwardly against a $1.00 ceiling: none of them
  // divides it evenly, so every run overshoots by something.
  for (const stepCost of ['0.1700', '0.2300', '0.3100', '0.4900', '0.7300']) {
    await startWithCeiling(ceiling.toFixed(4));
    let index = 0;
    // Exactly the loop the orchestrator runs: ask, then spend.
    while ((await mayStartAnotherStep(db, runId)).ok && index < 40) {
      await spend(index, stepCost);
      index++;
    }
    const spent = Number((await consumption(db, runId)).costUsd);
    const overshoot = spent - ceiling;

    // It did overshoot — otherwise this measures nothing.
    expect(overshoot).toBeGreaterThan(0);
    // And by no more than the single step that crossed the line.
    expect(overshoot).toBeLessThanOrEqual(Number(stepCost));
  }
});

/**
 * SC-006's 5% therefore holds exactly when a single step costs no more than
 * 5% of the ceiling. Measured rather than asserted, because the number is a
 * consequence of the step-boundary check and not a rule enforced anywhere.
 */
test('SC-006 holds when a step costs no more than 5% of the ceiling', async () => {
  const ceiling = 5;
  const worst: number[] = [];

  for (const stepCost of ['0.0100', '0.0700', '0.1900', '0.2500']) {
    await startWithCeiling(ceiling.toFixed(4));
    let index = 0;
    while ((await mayStartAnotherStep(db, runId)).ok && index < 600) {
      await spend(index, stepCost);
      index++;
    }
    const spent = Number((await consumption(db, runId)).costUsd);
    worst.push((spent - ceiling) / ceiling);
  }

  // The largest of those steps is exactly 5% of $5.00, which is the boundary.
  expect(Math.max(...worst)).toBeLessThanOrEqual(0.05);
});
