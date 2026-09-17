import { afterAll, beforeEach, expect, test } from 'bun:test';
import { logChunks, runs, stepResults, tickets } from '@factory/db/schema';
import { type Callback, FactoryError } from '@factory/shared';
import { eq } from 'drizzle-orm';
import { applyCallback, authenticateCallback } from '../../src/lib/services/callbacks';
import { startRun } from '../../src/lib/services/run';
import { connect, type Scenario, seed } from '../fixtures';

const { db, sql: raw } = connect();
let scenario: Scenario;
let runId: string;
let secret: string;

beforeEach(async () => {
  scenario = await seed(db);
  const started = await startRun(db, {
    ticketId: scenario.ticketId,
    callbackBaseUrl: 'https://factory.example',
  });
  runId = started.run.id;
  secret = started.resumeSecret;
});
afterAll(async () => {
  await raw.end();
});

const envelope = (event: Callback['event'], stepIndex = 0) =>
  ({ run_id: runId, attempt: 1, step_index: stepIndex, event }) as Callback;

const costOf = async () =>
  (await db.select({ c: runs.costUsd }).from(runs).where(eq(runs.id, runId)).limit(1))[0]?.c;

const stepRows = async () => db.select().from(stepResults).where(eq(stepResults.runId, runId));

// --- the core guarantee (FR-095) ---

test('a repeated step_finished creates no second row and does not charge twice', async () => {
  const finished = {
    ...envelope('step_finished'),
    status: 'done',
    duration_s: 12,
    cost_usd: '0.4200',
    artifacts: [{ kind: 'document', path: 'docs/spec.md', version: 1 }],
  } as Callback;

  const first = await applyCallback(db, finished);
  expect(first.applied).toBe(true);
  expect(await costOf()).toBe('0.4200');

  const second = await applyCallback(db, finished);
  expect(second.applied).toBe(false);
  expect(await costOf()).toBe('0.4200'); // not 0.8400
  expect(await stepRows()).toHaveLength(1);
});

test('a step may be started then finished, but not started twice', async () => {
  expect((await applyCallback(db, envelope('step_started'))).applied).toBe(true);
  expect((await applyCallback(db, envelope('step_started'))).applied).toBe(false);

  const finish = {
    ...envelope('step_finished'),
    status: 'done',
    duration_s: 3,
    cost_usd: '0.1000',
    artifacts: [],
  } as Callback;
  expect((await applyCallback(db, finish)).applied).toBe(true);
  expect((await applyCallback(db, finish)).applied).toBe(false);

  const rows = await stepRows();
  expect(rows).toHaveLength(1);
  expect(rows[0]?.status).toBe('done');
  expect(await costOf()).toBe('0.1000');
});

test('a duplicate log chunk does not appear twice', async () => {
  const chunk = {
    ...envelope('log_chunk'),
    seq: 7,
    stream: 'stdout',
    text: 'cloning…',
  } as Callback;
  await applyCallback(db, chunk);
  await applyCallback(db, chunk);
  const rows = await db.select().from(logChunks).where(eq(logChunks.runId, runId));
  expect(rows).toHaveLength(1);
});

test('the run secret is never echoed into a stored log chunk (SC-011)', async () => {
  await applyCallback(db, {
    ...envelope('log_chunk'),
    seq: 1,
    stream: 'stderr',
    text: `callback secret is ${secret}`,
  } as Callback);
  const rows = await db.select().from(logChunks).where(eq(logChunks.runId, runId));
  expect(rows[0]?.text).not.toContain(secret);
  expect(rows[0]?.text).toContain('[redacted]');
});

test('a repeated done does not re-finish the run', async () => {
  const done = {
    ...envelope('done'),
    merge_request_url: 'https://gitlab.com/mr/91',
    cost_usd: '1.0000',
  } as Callback;
  expect((await applyCallback(db, done)).applied).toBe(true);
  expect((await applyCallback(db, done)).applied).toBe(false);
  const [ticket] = await db
    .select()
    .from(tickets)
    .where(eq(tickets.id, scenario.ticketId))
    .limit(1);
  expect(ticket?.status).toBe('done');
  expect(ticket?.mergeRequestUrl).toBe('https://gitlab.com/mr/91');
});

// --- skipped is terminal for the step, never a run failure (FR-110, FR-111) ---

test('a skipped step records its reason and leaves the run alive', async () => {
  await applyCallback(db, {
    ...envelope('step_skipped'),
    condition_not_met: 'ticket has no UI change',
  } as Callback);
  const rows = await stepRows();
  expect(rows[0]?.status).toBe('skipped');
  expect(rows[0]?.conditionNotMet).toBe('ticket has no UI change');

  const [run] = await db.select().from(runs).where(eq(runs.id, runId)).limit(1);
  expect(run?.status).not.toBe('failed');
});

// --- classification and gates ---

test('ticket_classified records the decision and its reason (FR-099, FR-100)', async () => {
  await applyCallback(db, {
    ...envelope('ticket_classified'),
    has_ui: true,
    rationale: 'It adds a sign-in button visible to end users.',
  } as Callback);
  const [ticket] = await db
    .select()
    .from(tickets)
    .where(eq(tickets.id, scenario.ticketId))
    .limit(1);
  expect(ticket?.hasUi).toBe(true);
  expect(ticket?.uiRationale).toContain('sign-in button');
  expect(ticket?.classificationMissing).toBe(false);
});

test('waiting_approval stores the resume address so a lost execution is recoverable', async () => {
  await applyCallback(db, {
    ...envelope('waiting_approval', 1),
    resume_url: 'https://n8n.example/resume/abc',
    approvers: [],
  } as Callback);
  const [run] = await db.select().from(runs).where(eq(runs.id, runId)).limit(1);
  expect(run?.resumeUrl).toBe('https://n8n.example/resume/abc');
  expect(run?.status).toBe('waiting_approval');
  const [ticket] = await db
    .select()
    .from(tickets)
    .where(eq(tickets.id, scenario.ticketId))
    .limit(1);
  expect(ticket?.status).toBe('waiting_approval');
});

// --- authentication does not disclose whether a run exists ---

test('the right secret authenticates', async () => {
  await expect(authenticateCallback(db, runId, secret)).resolves.toBeDefined();
});

test('a wrong secret and an unknown run fail identically', async () => {
  const wrong = await authenticateCallback(db, runId, 'not-the-secret').catch((e) => e.message);
  const unknown = await authenticateCallback(db, crypto.randomUUID(), secret).catch(
    (e) => e.message,
  );
  expect(wrong).toBe('unauthorised');
  expect(unknown).toBe('unauthorised');
});

test('an empty secret never authenticates', async () => {
  await expect(authenticateCallback(db, runId, '')).rejects.toThrow('unauthorised');
});

// --- run creation invariants surfaced as readable messages ---

test('a second run on a live ticket is refused in words a person can act on (FR-020)', async () => {
  await expect(
    startRun(db, { ticketId: scenario.ticketId, callbackBaseUrl: 'https://factory.example' }),
  ).rejects.toThrow(/already has a run in progress/);
});

test('a retry after failure is attempt 2 and keeps attempt 1 readable (FR-088, FR-090)', async () => {
  await db.update(runs).set({ status: 'failed' }).where(eq(runs.id, runId));
  const retry = await startRun(db, {
    ticketId: scenario.ticketId,
    callbackBaseUrl: 'https://factory.example',
  });
  expect(retry.run.attempt).toBe(2);
  const all = await db.select().from(runs).where(eq(runs.ticketId, scenario.ticketId));
  expect(all).toHaveLength(2);
});

// --- the shape of a finished step, checked at the door ---

test('a step_finished with no outcome is refused by name, not with an internal error', async () => {
  // What the workflow posted before it carried the runner's answer: the
  // envelope alone. The insert failed on a null status and the orchestrator
  // saw `internal error`, which named neither side nor field.
  let thrown: unknown;
  try {
    await applyCallback(db, envelope('step_finished'));
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(FactoryError);
  expect((thrown as FactoryError).reason).toBe('invalid_input');
  expect((thrown as FactoryError).message).toContain('status');
  expect((thrown as FactoryError).message).toContain('cost_usd');
  expect((thrown as FactoryError).message).toContain('artifacts');
  expect(await stepRows()).toHaveLength(0);
});
