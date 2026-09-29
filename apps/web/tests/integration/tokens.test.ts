import { afterAll, beforeEach, expect, test } from 'bun:test';
import { runs, stepResults } from '@factory/db/schema';
import type { Callback } from '@factory/shared';
import { eq, sql } from 'drizzle-orm';
import { applyCallback } from '../../src/lib/services/callbacks';
import { previewRun } from '../../src/lib/services/estimate';
import { startRun } from '../../src/lib/services/run';
import { runView } from '../../src/lib/services/run-view';
import { connect, type Scenario, seed } from '../fixtures';

/**
 * Tokens: what a step reports having processed is stored beside its other
 * results, added up for the run, and used for the estimate a person sees
 * before starting a ticket. Wherever the screens used to show what a run cost
 * in dollars they show this instead; the dollar figure is still recorded,
 * because the ceilings are enforced on it (ceilings.test.ts).
 */

const { db, sql: raw } = connect();
let scenario: Scenario;
let runId: string;

beforeEach(async () => {
  scenario = await seed(db);
  runId = (
    await startRun(db, { ticketId: scenario.ticketId, callbackBaseUrl: 'https://factory.example' })
  ).run.id;
});
afterAll(async () => {
  await raw.end();
});

const envelope = (event: Callback['event'], stepIndex = 0) =>
  ({ run_id: runId, attempt: 1, step_index: stepIndex, event }) as Callback;

/** A `step_finished` that carries whatever `extra` adds — tokens, or something wrong with them. */
const finished = (stepIndex: number, extra: Record<string, unknown> = {}) =>
  ({
    ...envelope('step_finished', stepIndex),
    status: 'done',
    duration_s: 30,
    cost_usd: '0.2000',
    artifacts: [],
    ...extra,
  }) as Callback;

const rowOf = async (stepIndex: number, id = runId) => {
  const [row] = await db
    .select()
    .from(stepResults)
    .where(sql`${stepResults.runId} = ${id}::uuid and ${stepResults.stepIndex} = ${stepIndex}`);
  return row;
};

const counts = (row: Awaited<ReturnType<typeof rowOf>>) => ({
  input: row?.inputTokens,
  output: row?.outputTokens,
  cache_read: row?.cacheReadTokens,
  cache_creation: row?.cacheCreationTokens,
});

// --- a step's tokens ---

test('the four counts a step reports are stored with its result', async () => {
  const applied = await applyCallback(
    db,
    finished(0, {
      tokens: { input: 42, output: 9_158, cache_read: 1_150_000, cache_creation: 40_800 },
    }),
  );
  expect(applied.applied).toBe(true);
  expect(counts(await rowOf(0))).toEqual({
    input: 42,
    output: 9_158,
    cache_read: 1_150_000,
    cache_creation: 40_800,
  });
});

test('a step that reported nothing records zero, and still finishes', async () => {
  // The engine was killed before its final report, or is a design engine that
  // reports no usage. The step is done; it simply did not say what it used.
  await applyCallback(db, finished(0));
  const row = await rowOf(0);
  expect(row?.status).toBe('done');
  expect(counts(row)).toEqual({ input: 0, output: 0, cache_read: 0, cache_creation: 0 });
});

test('counts that are not counts are zero, and never a reason to refuse the outcome', async () => {
  // Tokens are for showing. A malformed one must not be the reason a finished
  // step is lost and its run left waiting for a report that will not come.
  const applied = await applyCallback(
    db,
    finished(0, {
      tokens: { input: -5, output: 'many', cache_read: Number.NaN, cache_creation: 12.4, extra: 9 },
    }),
  );
  expect(applied.applied).toBe(true);
  const row = await rowOf(0);
  expect(row?.status).toBe('done');
  expect(counts(row)).toEqual({ input: 0, output: 0, cache_read: 0, cache_creation: 12 });

  await applyCallback(db, finished(1, { tokens: 'lots' }));
  expect(counts(await rowOf(1))).toEqual({
    input: 0,
    output: 0,
    cache_read: 0,
    cache_creation: 0,
  });
});

test('a count past what the column holds is clamped, and the step is still recorded', async () => {
  // No real step processes five billion tokens — the dollar ceiling stops it
  // long before — but a count that overflowed the column would fail the
  // insert, and the step's outcome with it.
  const applied = await applyCallback(
    db,
    finished(0, { tokens: { input: 1, output: 2, cache_read: 5_000_000_000, cache_creation: 4 } }),
  );
  expect(applied.applied).toBe(true);
  const row = await rowOf(0);
  expect(row?.status).toBe('done');
  expect(counts(row)).toEqual({
    input: 1,
    output: 2,
    cache_read: 2_147_483_647,
    cache_creation: 4,
  });
});

test('a step that was started first is updated in place, with one row', async () => {
  await applyCallback(db, envelope('step_started'));
  expect(counts(await rowOf(0))).toEqual({ input: 0, output: 0, cache_read: 0, cache_creation: 0 });

  await applyCallback(
    db,
    finished(0, { tokens: { input: 7, output: 8, cache_read: 9, cache_creation: 10 } }),
  );
  const rows = await db.select().from(stepResults).where(eq(stepResults.runId, runId));
  expect(rows).toHaveLength(1);
  expect(counts(rows[0])).toEqual({ input: 7, output: 8, cache_read: 9, cache_creation: 10 });
});

test('a step that failed keeps the tokens it used before it did', async () => {
  // The dollars it cost were spent either way, and so were the tokens.
  await applyCallback(
    db,
    finished(0, {
      status: 'failed',
      failure_reason: 'The tests failed.',
      tokens: { input: 3, output: 4, cache_read: 5, cache_creation: 6 },
    }),
  );
  const row = await rowOf(0);
  expect(row?.status).toBe('failed');
  expect(counts(row)).toEqual({ input: 3, output: 4, cache_read: 5, cache_creation: 6 });
});

test('a step run again has used both passes: its tokens add up, as the run’s cost does', async () => {
  // A change request sent the run back to the step; the first pass's tokens
  // were spent whether or not its work was kept.
  await applyCallback(db, envelope('step_started'));
  await applyCallback(
    db,
    finished(0, { tokens: { input: 10, output: 20, cache_read: 30, cache_creation: 40 } }),
  );
  await applyCallback(db, envelope('step_started'));
  await applyCallback(
    db,
    finished(0, { tokens: { input: 1, output: 2, cache_read: 3, cache_creation: 4 } }),
  );

  const rows = await db.select().from(stepResults).where(eq(stepResults.runId, runId));
  expect(rows).toHaveLength(1);
  expect(counts(rows[0])).toEqual({ input: 11, output: 22, cache_read: 33, cache_creation: 44 });
  expect((await runView(db, runId)).run.tokens.total).toBe(110);
});

test('the second pass’s report repeated is still dropped, not added again', async () => {
  await applyCallback(db, envelope('step_started'));
  await applyCallback(
    db,
    finished(0, { tokens: { input: 10, output: 20, cache_read: 30, cache_creation: 40 } }),
  );
  await applyCallback(db, envelope('step_started'));
  const second = finished(0, { tokens: { input: 1, output: 2, cache_read: 3, cache_creation: 4 } });
  expect((await applyCallback(db, second)).applied).toBe(true);
  expect((await applyCallback(db, second)).applied).toBe(false);
  expect(counts(await rowOf(0))).toEqual({
    input: 11,
    output: 22,
    cache_read: 33,
    cache_creation: 44,
  });
});

test('adding passes together never passes what the column holds', async () => {
  await applyCallback(db, envelope('step_started'));
  await applyCallback(
    db,
    finished(0, { tokens: { input: 0, output: 0, cache_read: 2_000_000_000, cache_creation: 0 } }),
  );
  await applyCallback(db, envelope('step_started'));
  const applied = await applyCallback(
    db,
    finished(0, { tokens: { input: 0, output: 0, cache_read: 2_000_000_000, cache_creation: 0 } }),
  );
  expect(applied.applied).toBe(true);
  expect((await rowOf(0))?.cacheReadTokens).toBe(2_147_483_647);
});

test('a repeated report does not count the step twice', async () => {
  // At-least-once delivery: the execution service resends a report it did not
  // hear acknowledged (FR-095), and the second one must change nothing.
  const report = finished(0, { tokens: { input: 1, output: 2, cache_read: 3, cache_creation: 4 } });
  expect((await applyCallback(db, report)).applied).toBe(true);
  expect((await applyCallback(db, report)).applied).toBe(false);
  // Not even a repeat with different numbers, which would be a different report.
  await applyCallback(
    db,
    finished(0, { tokens: { input: 100, output: 100, cache_read: 100, cache_creation: 100 } }),
  );
  expect(counts(await rowOf(0))).toEqual({ input: 1, output: 2, cache_read: 3, cache_creation: 4 });
});

// --- a run's tokens ---

test('a run’s tokens are its steps’ added up, and each step shows its own', async () => {
  await applyCallback(
    db,
    finished(0, {
      tokens: { input: 40, output: 4_000, cache_read: 600_000, cache_creation: 40_800 },
    }),
  );
  await applyCallback(
    db,
    finished(1, { tokens: { input: 2, output: 5_158, cache_read: 550_000, cache_creation: 0 } }),
  );

  const view = await runView(db, runId);
  expect(view.run.tokens).toEqual({
    input: 42,
    output: 9_158,
    cacheRead: 1_150_000,
    cacheCreation: 40_800,
    total: 1_200_000,
  });
  const byStep = new Map(view.steps.map((step) => [step.index, step.tokens]));
  expect(byStep.get(0)).toBe(40 + 4_000 + 600_000 + 40_800);
  expect(byStep.get(1)).toBe(2 + 5_158 + 550_000);
});

test('a step that has not run has no tokens to show, which is not zero', async () => {
  await applyCallback(
    db,
    finished(0, { tokens: { input: 1, output: 1, cache_read: 1, cache_creation: 1 } }),
  );
  const view = await runView(db, runId);
  const later = view.steps.find((step) => step.index > 0);
  expect(later?.tokens).toBeUndefined();
  expect(view.steps.find((step) => step.index === 0)?.tokens).toBe(4);
});

test('a run with nothing recorded totals zero, so a screen can leave the figure out', async () => {
  const view = await runView(db, runId);
  expect(view.run.tokens.total).toBe(0);
});

test('the run’s dollar figure is still recorded, for the ceilings', async () => {
  await applyCallback(
    db,
    finished(0, { tokens: { input: 1, output: 1, cache_read: 1, cache_creation: 1 } }),
  );
  const [run] = await db.select().from(runs).where(eq(runs.id, runId));
  expect(run?.costUsd).toBe('0.2000');
});

// --- the estimate ---

/** Finishes the current run and starts the next attempt, so a ticket can have history. */
async function finishRun(id: string, minutes: number, tokens: number | null) {
  if (tokens !== null) {
    await db.insert(stepResults).values({
      runId: id,
      stepIndex: 0,
      status: 'done',
      cacheReadTokens: tokens,
    });
  }
  await db
    .update(runs)
    .set({
      status: 'done',
      startedAt: sql`now() - ${minutes + 5} * interval '1 minute'`,
      finishedAt: sql`now() - interval '5 minutes'`,
    })
    .where(eq(runs.id, id));
}

const estimateOf = async () =>
  (await previewRun(db, scenario.pipelineId, scenario.pipelineVersion)).estimate;

test('with no finished runs it says so, and names the time limit rather than inventing a figure', async () => {
  expect(await estimateOf()).toEqual({ kind: 'unknown', ceilingMinutes: 45 });
});

test('the estimate is the average of what comparable finished runs processed', async () => {
  await finishRun(runId, 10, 200_000);
  const second = (
    await startRun(db, { ticketId: scenario.ticketId, callbackBaseUrl: 'https://factory.example' })
  ).run.id;
  await finishRun(second, 20, 400_000);

  expect(await estimateOf()).toEqual({
    kind: 'measured',
    tokens: 300_000,
    minutes: 15,
    samples: 2,
  });
});

test('a run from before tokens were recorded is not a sample: it would say the next one is free', async () => {
  await finishRun(runId, 10, null);
  expect(await estimateOf()).toEqual({ kind: 'unknown', ceilingMinutes: 45 });

  const second = (
    await startRun(db, { ticketId: scenario.ticketId, callbackBaseUrl: 'https://factory.example' })
  ).run.id;
  await finishRun(second, 12, 90_000);
  expect(await estimateOf()).toEqual({ kind: 'measured', tokens: 90_000, minutes: 12, samples: 1 });
});
