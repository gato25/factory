import { afterAll, beforeEach, expect, test } from 'bun:test';
import { approvals, artifacts, logChunks, runs, stepResults, tickets } from '@factory/db/schema';
import type { Callback } from '@factory/shared';
import { eq } from 'drizzle-orm';
import { applyCallback } from '../../src/lib/services/callbacks';
import { attemptsOf, failureOf } from '../../src/lib/services/failure';
import { cancelRunNow, editAndRetry, retryRun, startRun } from '../../src/lib/services/run';
import { connect, type Scenario, seed } from '../fixtures';

/**
 * A new attempt keeps the previous attempt's records, output and documents
 * (FR-090). It has to: a retry is only an informed decision if the thing you
 * are retrying is still readable.
 */

const { db, sql: raw } = connect();
let scenario: Scenario;
let firstRunId: string;

const base = { callbackBaseUrl: 'https://factory.example' };

/** A first attempt that ran a step, produced a document, then failed. */
async function firstAttemptFails() {
  scenario = await seed(db);
  const started = await startRun(db, { ticketId: scenario.ticketId, ...base });
  firstRunId = started.run.id;

  await applyCallback(db, {
    run_id: firstRunId,
    attempt: 1,
    step_index: 0,
    event: 'step_finished',
    status: 'done',
    duration_s: 12,
    cost_usd: '0.4200',
    artifacts: [{ kind: 'document', path: 'docs/spec.md', version: 1 }],
  } as Callback);
  await db
    .update(artifacts)
    .set({ content: '# Spec\n\nThe first attempt wrote this.' })
    .where(eq(artifacts.runId, firstRunId));
  await db.insert(logChunks).values({
    runId: firstRunId,
    stepIndex: 0,
    seq: 1,
    stream: 'stdout',
    text: 'the first attempt said this\n',
  });
  await applyCallback(db, {
    run_id: firstRunId,
    attempt: 1,
    step_index: 1,
    event: 'failed',
    reason: 'missing_output',
    detail: 'docs/plan.md was never written',
  } as Callback);
}

beforeEach(firstAttemptFails);
afterAll(async () => {
  await raw.end();
});

test('a retry is a second attempt, and the first is still all there', async () => {
  const { run: second } = await retryRun(db, { ticketId: scenario.ticketId, ...base });

  expect(second.attempt).toBe(2);
  expect(second.id).not.toBe(firstRunId);
  expect(second.status).toBe('queued');
  // A fresh sandbox: nothing carried over from the attempt that failed.
  expect(second.containerId).toBeNull();
  expect(second.costUsd).toBe('0.0000');

  // Everything the first attempt recorded is untouched.
  const [first] = await db.select().from(runs).where(eq(runs.id, firstRunId)).limit(1);
  expect(first?.status).toBe('failed');
  expect(first?.costUsd).toBe('0.4200');
  expect(first?.failureReason).toBe('missing_output');

  const steps = await db.select().from(stepResults).where(eq(stepResults.runId, firstRunId));
  expect(steps).toHaveLength(2);
  const docs = await db.select().from(artifacts).where(eq(artifacts.runId, firstRunId));
  expect(docs).toHaveLength(1);
  expect(docs[0]?.content).toBe('# Spec\n\nThe first attempt wrote this.');
  const logs = await db.select().from(logChunks).where(eq(logChunks.runId, firstRunId));
  expect(logs).toHaveLength(1);
});

test('the second attempt uses the same pipeline version as the first', async () => {
  const { run: second } = await retryRun(db, { ticketId: scenario.ticketId, ...base });
  const [first] = await db.select().from(runs).where(eq(runs.id, firstRunId)).limit(1);

  expect(second.snapshot.pipeline.version).toBe(first?.snapshot.pipeline.version);
  expect(second.snapshot.pipeline.id).toBe(first?.snapshot.pipeline.id);
  // The steps themselves, not merely the version number.
  expect(second.snapshot.pipeline.steps).toEqual(first?.snapshot.pipeline.steps ?? []);
});

test('both attempts are listed, newest first, each with its own reason', async () => {
  await retryRun(db, { ticketId: scenario.ticketId, ...base });
  const history = await attemptsOf(db, scenario.ticketId);

  expect(history.map((a) => a.attempt)).toEqual([2, 1]);
  expect(history[0]?.status).toBe('queued');
  expect(history[1]?.status).toBe('failed');
  expect(history[1]?.what).toBe(
    'The step finished without producing the document it was supposed to write.',
  );
  expect(history[1]?.costUsd).toBe('0.4200');
});

test('a failed attempt stays readable through the failure view after a retry', async () => {
  await retryRun(db, { ticketId: scenario.ticketId, ...base });

  const failure = await failureOf(db, firstRunId);
  expect(failure?.attempt).toBe(1);
  expect(failure?.stepIndex).toBe(1);
  expect(failure?.detail).toBe('docs/plan.md was never written');
  // And the document the failed attempt did produce, which a retry builds on.
  expect(failure?.produced).toEqual([{ path: 'docs/spec.md', version: 1 }]);
});

test('editing and retrying is one action: the edit lands before the attempt', async () => {
  const { run: second } = await editAndRetry(db, {
    ticketId: scenario.ticketId,
    ...base,
    title: 'Add Google and Apple sign-in',
    acceptanceCriteria: ['A Google button appears', 'An Apple button appears', '  '],
  });

  const [ticket] = await db
    .select()
    .from(tickets)
    .where(eq(tickets.id, scenario.ticketId))
    .limit(1);
  expect(ticket?.title).toBe('Add Google and Apple sign-in');
  // Blank lines from the textarea are dropped, not stored as empty criteria.
  expect(ticket?.acceptanceCriteria).toEqual([
    'A Google button appears',
    'An Apple button appears',
  ]);

  // The new attempt's snapshot reads the edited ticket, not the old one.
  expect(second.snapshot.ticket.title).toBe('Add Google and Apple sign-in');
  expect(second.snapshot.ticket.acceptance_criteria).toEqual([
    'A Google button appears',
    'An Apple button appears',
  ]);
  // And the first attempt still says what it was asked to do at the time.
  const [first] = await db.select().from(runs).where(eq(runs.id, firstRunId)).limit(1);
  expect(first?.snapshot.ticket.title).toBe('Add Google OAuth sign-in');
});

test('editing nothing and retrying leaves the ticket alone', async () => {
  const before = await db.select().from(tickets).where(eq(tickets.id, scenario.ticketId)).limit(1);
  await editAndRetry(db, { ticketId: scenario.ticketId, ...base });
  const after = await db.select().from(tickets).where(eq(tickets.id, scenario.ticketId)).limit(1);

  expect(after[0]?.title).toBe(before[0]?.title ?? '');
  expect(after[0]?.acceptanceCriteria).toEqual(before[0]?.acceptanceCriteria ?? []);
});

test('a cancelled attempt can be retried too', async () => {
  scenario = await seed(db);
  const started = await startRun(db, { ticketId: scenario.ticketId, ...base });
  await cancelRunNow(db, started.run.id);

  const { run: second } = await retryRun(db, { ticketId: scenario.ticketId, ...base });
  expect(second.attempt).toBe(2);
  const [first] = await db.select().from(runs).where(eq(runs.id, started.run.id)).limit(1);
  expect(first?.status).toBe('cancelled');
});

test('a run still in flight cannot be retried, and is told why', async () => {
  scenario = await seed(db);
  const started = await startRun(db, { ticketId: scenario.ticketId, ...base });
  await db.update(runs).set({ status: 'running' }).where(eq(runs.id, started.run.id));

  let refused: Error | null = null;
  try {
    await retryRun(db, { ticketId: scenario.ticketId, ...base });
  } catch (error) {
    refused = error as Error;
  }
  expect(refused?.message).toBe(
    'attempt 1 of #142 is still running. Only a failed or cancelled attempt can be retried.',
  );
  // Nothing was created.
  expect(await db.select().from(runs).where(eq(runs.ticketId, scenario.ticketId))).toHaveLength(1);
});

test('a finished run cannot be retried', async () => {
  scenario = await seed(db);
  const started = await startRun(db, { ticketId: scenario.ticketId, ...base });
  await db.update(runs).set({ status: 'done' }).where(eq(runs.id, started.run.id));

  let refused: Error | null = null;
  try {
    await retryRun(db, { ticketId: scenario.ticketId, ...base });
  } catch (error) {
    refused = error as Error;
  }
  expect(refused?.message).toContain('already finished');
});

test('a ticket that never ran is told to start rather than retry', async () => {
  scenario = await seed(db);
  let refused: Error | null = null;
  try {
    await retryRun(db, { ticketId: scenario.ticketId, ...base });
  } catch (error) {
    refused = error as Error;
  }
  expect(refused?.message).toBe('#142 has not run yet — start it rather than retrying it.');
});

test('a third attempt keeps both earlier ones', async () => {
  await retryRun(db, { ticketId: scenario.ticketId, ...base });
  const attempt2 = await db
    .select()
    .from(runs)
    .where(eq(runs.ticketId, scenario.ticketId))
    .then((rows) => rows.find((r) => r.attempt === 2));
  if (!attempt2) throw new Error('no second attempt');
  await db
    .update(runs)
    .set({ status: 'failed', failureReason: 'engine_unavailable' })
    .where(eq(runs.id, attempt2.id));

  const { run: third } = await retryRun(db, { ticketId: scenario.ticketId, ...base });
  expect(third.attempt).toBe(3);

  const history = await attemptsOf(db, scenario.ticketId);
  expect(history.map((a) => a.attempt)).toEqual([3, 2, 1]);
  expect(history[1]?.what).toBe('The model could not be reached.');
  expect(history[2]?.what).toBe(
    'The step finished without producing the document it was supposed to write.',
  );
});

test('a decision recorded on an earlier attempt is not carried into a new one', async () => {
  await db.insert(approvals).values({
    runId: firstRunId,
    stepIndex: 1,
    decidedBy: scenario.userId,
    decision: 'changes_requested',
    feedback: 'the plan is thin',
  });

  const { run: second } = await retryRun(db, { ticketId: scenario.ticketId, ...base });
  expect(await db.select().from(approvals).where(eq(approvals.runId, second.id))).toHaveLength(0);
  // But it is still on the attempt where it happened.
  expect(await db.select().from(approvals).where(eq(approvals.runId, firstRunId))).toHaveLength(1);
});
