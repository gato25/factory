import { afterAll, beforeEach, expect, test } from 'bun:test';
import { runs, tickets, workspaces } from '@factory/db/schema';
import { eq, sql } from 'drizzle-orm';
import { mayStart, positionOf, queueState, readyToStart } from '../../src/lib/services/queue';
import { startRun } from '../../src/lib/services/run';
import { connect, type Scenario, seed } from '../fixtures';

/**
 * FR-082 — a workspace limit on how many runs execute at once, with further
 * runs held in a queue showing each author their position. A position is
 * only useful if it is stable and first-come-first-served, so that is what
 * is asserted rather than merely that a number appears.
 */

const { db, sql: raw } = connect();
let scenario: Scenario;
const base = { callbackBaseUrl: 'https://factory.example' };

async function setCap(cap: number) {
  await db.update(workspaces).set({ maxConcurrentRuns: cap });
}

/**
 * Several tickets, each with one run. The one-active-run-per-ticket index
 * means a queue needs several tickets, not several runs on one.
 *
 * `running` says how many of them have actually been dispatched and hold a
 * sandbox; the rest are `queued`, which is what the queue is.
 */
async function queueUp(howMany: number, running = 0): Promise<string[]> {
  const runIds: string[] = [];
  for (let i = 0; i < howMany; i++) {
    const [ticket] = await db
      .insert(tickets)
      .values({
        repositoryId: scenario.repositoryId,
        createdBy: scenario.userId,
        reference: `#${200 + i}`,
        title: `Ticket ${i}`,
        acceptanceCriteria: ['It works'],
        pipelineId: scenario.pipelineId,
        pipelineVersion: 1,
        status: 'queued',
        branchName: `factory/${200 + i}`,
      })
      .returning();
    if (!ticket) throw new Error('no ticket');
    const started = await startRun(db, { ticketId: ticket.id, ...base });
    // Created in order, a millisecond apart, so the ordering is not a tie.
    await db
      .update(runs)
      .set({ createdAt: sql`now() + (${i} || ' seconds')::interval` })
      .where(eq(runs.id, started.run.id));
    runIds.push(started.run.id);
  }
  for (const id of runIds.slice(0, running)) {
    await db.update(runs).set({ status: 'running' }).where(eq(runs.id, id));
  }
  return runIds;
}

beforeEach(async () => {
  scenario = await seed(db);
});
afterAll(async () => {
  await raw.end();
});

test('runs inside the cap all execute, and none has a position', async () => {
  await setCap(3);
  const ids = await queueUp(3, 3);

  const state = await queueState(db);
  expect(state.cap).toBe(3);
  expect(state.executing).toBe(3);
  expect(state.waiting).toBe(0);
  for (const id of ids) {
    expect(await positionOf(db, id)).toBeNull();
    expect(await mayStart(db, id)).toEqual({ ok: true });
  }
});

test('queued runs within the free slots may start now, and have no position', async () => {
  await setCap(2);
  // Nothing has been dispatched yet: the first two may go.
  const ids = await queueUp(4);

  expect(await positionOf(db, ids[0] as string)).toBeNull();
  expect(await positionOf(db, ids[1] as string)).toBeNull();
  expect(await positionOf(db, ids[2] as string)).toBe(1);
  expect(await readyToStart(db)).toEqual([ids[0], ids[1]]);
});

test('runs beyond the cap wait, and are told where in the queue', async () => {
  await setCap(2);
  const ids = await queueUp(5, 2);

  const state = await queueState(db);
  expect(state.executing).toBe(2);
  expect(state.waiting).toBe(3);

  // First come, first served: positions follow creation order.
  expect(await positionOf(db, ids[0] as string)).toBeNull();
  expect(await positionOf(db, ids[1] as string)).toBeNull();
  expect(await positionOf(db, ids[2] as string)).toBe(1);
  expect(await positionOf(db, ids[3] as string)).toBe(2);
  expect(await positionOf(db, ids[4] as string)).toBe(3);

  const verdict = await mayStart(db, ids[4] as string);
  expect(verdict).toEqual({ ok: false, position: 3 });
});

test('a queued run reports its own author, so the position reaches them', async () => {
  await setCap(1);
  await queueUp(2, 1);
  const state = await queueState(db);
  expect(state.entries).toHaveLength(2);
  expect(state.entries.every((entry) => entry.authorName === 'Bat')).toBe(true);
  expect(state.entries.map((entry) => entry.reference)).toEqual(['#200', '#201']);
});

test('a run paused at a gate still holds its slot, and the queue says so', async () => {
  await setCap(1);
  const ids = await queueUp(2, 1);
  await db
    .update(runs)
    .set({ status: 'waiting_approval' })
    .where(eq(runs.id, ids[0] as string));

  // Its sandbox is still there, so it still counts. A queue that excluded it
  // would never move for a reason nobody could see.
  expect(await positionOf(db, ids[0] as string)).toBeNull();
  expect(await positionOf(db, ids[1] as string)).toBe(1);
});

test('a finished run frees its slot, and the next one is ready', async () => {
  await setCap(1);
  const ids = await queueUp(3, 1);
  // The cap is full, so nothing may start.
  expect(await readyToStart(db)).toEqual([]);

  await db
    .update(runs)
    .set({ status: 'done', finishedAt: new Date() })
    .where(eq(runs.id, ids[0] as string));

  // Exactly one slot freed, so exactly one run is ready.
  expect(await readyToStart(db)).toEqual([ids[1]]);
  expect(await positionOf(db, ids[1] as string)).toBeNull();
  expect(await positionOf(db, ids[2] as string)).toBe(1);
});

test('several freed slots are filled in one pass, not one per tick', async () => {
  await setCap(3);
  const ids = await queueUp(6, 3);
  for (const id of ids.slice(0, 2)) {
    await db.update(runs).set({ status: 'done', finishedAt: new Date() }).where(eq(runs.id, id));
  }
  // Two slots freed: the next two are ready together.
  expect(await readyToStart(db)).toEqual([ids[3], ids[4]]);
});

test('a cancelled run frees its slot too', async () => {
  await setCap(1);
  const ids = await queueUp(2, 1);
  await db
    .update(runs)
    .set({ status: 'cancelled', finishedAt: new Date() })
    .where(eq(runs.id, ids[0] as string));
  expect(await positionOf(db, ids[1] as string)).toBeNull();
});

test('raising the cap admits waiting runs immediately', async () => {
  await setCap(1);
  const ids = await queueUp(4, 1);
  expect(await positionOf(db, ids[3] as string)).toBe(3);

  await setCap(4);
  for (const id of ids) expect(await positionOf(db, id)).toBeNull();
  expect((await queueState(db)).waiting).toBe(0);
});

test('lowering the cap does not stop a run already going', async () => {
  await setCap(3);
  const ids = await queueUp(3);
  await setCap(1);

  // The queue reports the truth — two are now over the cap — but nothing
  // here kills them: a run holding a sandbox is finished, not evicted.
  const state = await queueState(db);
  expect(state.waiting).toBe(2);
  const stillRunning = await db
    .select()
    .from(runs)
    .where(eq(runs.id, ids[2] as string));
  expect(stillRunning[0]?.status).toBe('queued');
});

test('an empty workspace has an empty queue rather than an error', async () => {
  await setCap(2);
  const state = await queueState(db);
  expect(state).toEqual({ cap: 2, executing: 0, waiting: 0, entries: [] });
  expect(await readyToStart(db)).toEqual([]);
});
