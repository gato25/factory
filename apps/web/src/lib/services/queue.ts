import type { Database } from '@factory/db';
import { runs, tickets, users, workspaces } from '@factory/db/schema';
import { eq, inArray } from 'drizzle-orm';

/**
 * FR-082 — a workspace limit on how many runs execute at once, with further
 * runs held in a queue that shows each author their position.
 *
 * A run HOLDS A SANDBOX once it is running — including while paused at a
 * gate, because the sandbox is still there. Those are what count against the
 * cap. A `queued` run holds nothing yet: it is the queue. Conflating the two
 * would produce positions that never move, because every waiting run would
 * appear to be consuming the slot it is waiting for.
 */

/** Holding a sandbox, so counting against the cap. */
const HOLDING = ['running', 'waiting_approval', 'opening_mr'] as const;

export interface QueueState {
  cap: number;
  executing: number;
  waiting: number;
  entries: {
    runId: string;
    ticketId: string;
    reference: string;
    title: string;
    authorName: string | null;
    status: string;
    /** Null when it holds a sandbox or could start now; 1-based while it waits. */
    position: number | null;
    createdAt: Date;
  }[];
}

export async function queueState(database: Database): Promise<QueueState> {
  // The same row every reader picks, so a cap change is not invisible.
  const [workspace] = await database
    .select()
    .from(workspaces)
    .orderBy(workspaces.createdAt)
    .limit(1);
  const cap = workspace?.maxConcurrentRuns ?? 6;

  const rows = await database
    .select({
      runId: runs.id,
      ticketId: tickets.id,
      reference: tickets.reference,
      title: tickets.title,
      authorName: users.name,
      createdAt: runs.createdAt,
      status: runs.status,
    })
    .from(runs)
    .innerJoin(tickets, eq(tickets.id, runs.ticketId))
    .leftJoin(users, eq(users.id, tickets.createdBy))
    .where(inArray(runs.status, ['queued', ...HOLDING]))
    // First come, first served, so a position is stable rather than a lottery.
    .orderBy(runs.createdAt);

  const holding = rows.filter((row) => (HOLDING as readonly string[]).includes(row.status));
  const free = Math.max(0, cap - holding.length);

  // A queued run within the free slots can start now, so it has no position
  // to report; the rest are numbered from one.
  let queuedSoFar = 0;
  const entries = rows.map((row) => {
    if ((HOLDING as readonly string[]).includes(row.status)) {
      return { ...row, position: null };
    }
    queuedSoFar += 1;
    return { ...row, position: queuedSoFar <= free ? null : queuedSoFar - free };
  });

  return {
    cap,
    executing: holding.length,
    waiting: entries.filter((entry) => entry.position !== null).length,
    entries,
  };
}

/** One run's position, for its own ticket page. Null when it is executing. */
export async function positionOf(database: Database, runId: string): Promise<number | null> {
  const state = await queueState(database);
  return state.entries.find((entry) => entry.runId === runId)?.position ?? null;
}

/**
 * Whether another run may begin. This is what the concurrency cap actually
 * is: not a throttle applied later, but a question asked before a sandbox is
 * created.
 */
export async function mayStart(
  database: Database,
  runId: string,
): Promise<{ ok: true } | { ok: false; position: number }> {
  const position = await positionOf(database, runId);
  return position === null ? { ok: true } : { ok: false, position };
}

/**
 * The next run that should begin, once a slot frees. Returning the whole
 * ordered list rather than one keeps whatever drives it honest: it can fill
 * every free slot in one pass instead of one per tick.
 */
export async function readyToStart(database: Database): Promise<string[]> {
  const state = await queueState(database);
  return state.entries
    .filter((entry) => entry.status === 'queued' && entry.position === null)
    .map((entry) => entry.runId);
}
