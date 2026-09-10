import { randomBytes } from 'node:crypto';
import type { Database } from '@factory/db';
import { runs, tickets } from '@factory/db/schema';
import { conflict, FactoryError, notFound } from '@factory/shared';
import { desc, eq, sql } from 'drizzle-orm';
import { resolveSnapshot } from '$lib/snapshot/resolve';
import type { ReleaseSandbox } from './sandbox';

/**
 * One run per attempt, numbered in sequence on its ticket (FR-045), and at
 * most one active run per ticket (FR-020). Both are database invariants; this
 * translates the constraint violation into something a person can read.
 */

export interface StartRunInput {
  ticketId: string;
  callbackBaseUrl: string;
}

export async function startRun(database: Database, input: StartRunInput) {
  const [ticket] = await database
    .select()
    .from(tickets)
    .where(eq(tickets.id, input.ticketId))
    .limit(1);
  if (!ticket) throw notFound('no such ticket');

  const [previous] = await database
    .select({ attempt: runs.attempt })
    .from(runs)
    .where(eq(runs.ticketId, ticket.id))
    .orderBy(desc(runs.attempt))
    .limit(1);
  const attempt = (previous?.attempt ?? 0) + 1;

  const runId = crypto.randomUUID();
  const resumeSecret = randomBytes(32).toString('base64url');
  const { snapshot, ceilings } = await resolveSnapshot(database, {
    ticketId: ticket.id,
    attempt,
    runId,
    callbackUrl: `${input.callbackBaseUrl}/api/hooks/n8n`,
    resumeSecret,
  });

  try {
    const inserted = await database
      .insert(runs)
      .values({
        id: runId,
        ticketId: ticket.id,
        attempt,
        snapshot,
        status: 'queued',
        costCeilingUsd: ceilings.costUsd,
        timeCeilingMinutes: ceilings.minutes,
      })
      .returning();
    const run = inserted[0];
    if (!run) throw conflict('could not create the run');

    await database
      .update(tickets)
      .set({ status: 'queued', currentRunId: run.id, updatedAt: new Date() })
      .where(eq(tickets.id, ticket.id));

    return { run, snapshot, resumeSecret };
  } catch (error) {
    const message = flatten(error);
    if (message.includes('runs_one_active_per_ticket')) {
      throw conflict(
        `${ticket.reference} already has a run in progress. Wait for it to finish, or cancel it.`,
      );
    }
    if (message.includes('runs_ticket_attempt_key')) {
      throw conflict(`attempt ${attempt} of ${ticket.reference} already exists`);
    }
    throw error;
  }
}

export async function getRun(database: Database, runId: string) {
  const [run] = await database.select().from(runs).where(eq(runs.id, runId)).limit(1);
  if (!run) throw notFound('no such run');
  return run;
}

export async function setRunStatus(
  database: Database,
  runId: string,
  status:
    | 'queued'
    | 'running'
    | 'waiting_approval'
    | 'opening_mr'
    | 'done'
    | 'failed'
    | 'cancelled',
  extra: { currentStepIndex?: number; failureReason?: string; failureStepIndex?: number } = {},
) {
  await database
    .update(runs)
    .set({
      status,
      ...extra,
      startedAt: status === 'running' ? sql`coalesce(${runs.startedAt}, now())` : undefined,
      finishedAt:
        status === 'done' || status === 'failed' || status === 'cancelled' ? new Date() : undefined,
      updatedAt: new Date(),
    })
    .where(eq(runs.id, runId));
}

function flatten(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  while (current instanceof Error) {
    parts.push(current.message);
    const constraint = (current as { constraint_name?: string }).constraint_name;
    if (constraint) parts.push(constraint);
    current = current.cause;
  }
  return parts.join(' | ');
}

/**
 * A further attempt on the same ticket, with the same pipeline version and a
 * fresh sandbox (FR-088). Nothing from the previous attempt is deleted: its
 * step records, output and documents hang off its own run row and stay
 * readable (FR-090). This is why a retry is a new run rather than a reset of
 * the old one.
 */
export async function retryRun(
  database: Database,
  input: { ticketId: string; callbackBaseUrl: string },
) {
  const [ticket] = await database
    .select()
    .from(tickets)
    .where(eq(tickets.id, input.ticketId))
    .limit(1);
  if (!ticket) throw notFound('no such ticket');

  const [latest] = await database
    .select({ id: runs.id, attempt: runs.attempt, status: runs.status })
    .from(runs)
    .where(eq(runs.ticketId, ticket.id))
    .orderBy(desc(runs.attempt))
    .limit(1);
  if (!latest) {
    throw conflict(`${ticket.reference} has not run yet — start it rather than retrying it.`);
  }
  if (!isRetryable(latest.status)) {
    throw conflict(
      `attempt ${latest.attempt} of ${ticket.reference} is ${describeStatus(latest.status)}. ` +
        'Only a failed or cancelled attempt can be retried.',
    );
  }

  // The same pipeline version as the attempt being retried, so a retry
  // reproduces the pipeline the ticket was queued against rather than
  // silently adopting a newer one (FR-088, FR-044).
  return startRun(database, { ticketId: ticket.id, callbackBaseUrl: input.callbackBaseUrl });
}

/**
 * Editing the ticket and retrying it, as one action (FR-089). The edit lands
 * first, so the new attempt's snapshot is resolved against what the person
 * just wrote — a retry that read the old ticket would be pointless.
 */
export async function editAndRetry(
  database: Database,
  input: {
    ticketId: string;
    callbackBaseUrl: string;
    title?: string;
    description?: string;
    acceptanceCriteria?: string[];
  },
) {
  const changes: Record<string, unknown> = { updatedAt: new Date() };
  if (input.title !== undefined) changes.title = input.title.trim();
  if (input.description !== undefined) changes.description = input.description;
  if (input.acceptanceCriteria !== undefined) {
    changes.acceptanceCriteria = input.acceptanceCriteria
      .map((line) => line.trim())
      .filter(Boolean);
  }
  if (Object.keys(changes).length > 1) {
    await database.update(tickets).set(changes).where(eq(tickets.id, input.ticketId));
  }
  return retryRun(database, input);
}

const RETRYABLE = ['failed', 'cancelled'] as const;
type RunStatus = (typeof runs.$inferSelect)['status'];

function isRetryable(status: RunStatus): boolean {
  return (RETRYABLE as readonly string[]).includes(status);
}

function describeStatus(status: RunStatus): string {
  switch (status) {
    case 'done':
      return 'already finished';
    case 'waiting_approval':
      return 'waiting for someone to decide a checkpoint';
    case 'opening_mr':
      return 'opening its merge request';
    default:
      return `still ${status}`;
  }
}

/**
 * A pause lets the current step conclude and stops the next one beginning
 * (FR-096). It is deliberately not a status: the run keeps whatever status it
 * had, so the step in flight is reported exactly as it was, and the
 * orchestrator reads the request before starting anything further.
 */
export async function pauseRun(database: Database, runId: string, userId: string) {
  const run = await getRun(database, runId);
  if (!isActive(run.status)) {
    throw conflict(`this attempt is ${describeStatus(run.status)} — there is nothing to pause.`);
  }
  if (run.pauseRequestedAt) return { pausedAt: run.pauseRequestedAt, alreadyRequested: true };

  const now = new Date();
  await database
    .update(runs)
    .set({ pauseRequestedAt: now, pauseRequestedBy: userId, updatedAt: now })
    .where(eq(runs.id, runId));
  return { pausedAt: now, alreadyRequested: false };
}

export interface ResumeDeps {
  /** Injected so continuing is testable without an orchestrator. */
  resume?: (url: string) => Promise<{ ok: boolean; detail?: string }>;
}

/**
 * Withdrawing a pause, so the run continues from where it stopped. The
 * request is cleared first: whether the orchestrator can be reached or not,
 * the run is no longer paused, and a run that reports in later reads the
 * cleared state rather than holding a second time.
 */
export async function resumeRun(database: Database, runId: string, deps: ResumeDeps = {}) {
  const run = await getRun(database, runId);
  if (!run.pauseRequestedAt) return { resumed: false, delivered: false };

  await database
    .update(runs)
    .set({ pauseRequestedAt: null, pauseRequestedBy: null, updatedAt: new Date() })
    .where(eq(runs.id, runId));

  // A run held at the pause is waiting on its resume address; one that had
  // not reached the hold yet simply carries on at its next step.
  if (!run.resumeUrl) return { resumed: true, delivered: false };
  const send = deps.resume ?? defaultResume;
  const result = await send(run.resumeUrl);
  return { resumed: true, delivered: result.ok, detail: result.detail };
}

async function defaultResume(url: string) {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ paused: false }),
    });
    return { ok: response.ok, detail: response.ok ? undefined : `answered ${response.status}` };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

/** What the orchestrator asks before starting a step (FR-096). */
export async function isPaused(database: Database, runId: string): Promise<boolean> {
  const [row] = await database
    .select({ pauseRequestedAt: runs.pauseRequestedAt })
    .from(runs)
    .where(eq(runs.id, runId))
    .limit(1);
  return Boolean(row?.pauseRequestedAt);
}

export interface CancelDeps {
  /** Releasing the sandbox; the branch is deliberately left alone (FR-097). */
  releaseSandbox?: ReleaseSandbox;
}

/**
 * Cancel at any point: the sandbox is released and the branch produced so
 * far is left intact (FR-097). Nothing touches the branch — a cancelled run
 * is often cancelled precisely because someone wants what it pushed.
 */
export async function cancelRunNow(
  database: Database,
  runId: string,
  deps: CancelDeps = {},
): Promise<{ cancelled: boolean }> {
  const run = await getRun(database, runId);
  if (!isActive(run.status)) return { cancelled: false };

  const updated = await database
    .update(runs)
    .set({
      status: 'cancelled',
      pauseRequestedAt: null,
      pauseRequestedBy: null,
      finishedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(sql`${runs.id} = ${runId}::uuid
      and ${runs.status} in ('queued', 'running', 'waiting_approval', 'opening_mr')`)
    .returning({ id: runs.id });
  if (updated.length === 0) return { cancelled: false };

  await database
    .update(tickets)
    .set({ status: 'cancelled', updatedAt: new Date() })
    .where(eq(tickets.id, run.ticketId));

  if (run.containerId && deps.releaseSandbox) {
    try {
      await deps.releaseSandbox({
        runId,
        containerId: run.containerId,
        outcome: 'cancelled',
      });
      // Recording the release is what makes a leak visible. Left set, the
      // row claims the run still holds a container, and nothing — no
      // operator, no audit, no reconciler — can tell a released sandbox
      // from one nobody reclaimed (SC-012).
      await database
        .update(runs)
        .set({ containerId: null, updatedAt: new Date() })
        .where(eq(runs.id, runId));
    } catch {
      // The run is cancelled either way, and the container id stays on the
      // row on purpose: it is the only handle anything has for reclaiming
      // it. The sandbox's own lifetime limit is the backstop (FR-085).
    }
  }
  return { cancelled: true };
}

function isActive(status: RunStatus): boolean {
  return ['queued', 'running', 'waiting_approval', 'opening_mr'].includes(status);
}
