import { randomBytes } from 'node:crypto';
import type { Database } from '@factory/db';
import { runs, tickets } from '@factory/db/schema';
import { conflict, FactoryError, notFound } from '@factory/shared';
import { desc, eq, sql } from 'drizzle-orm';
import { resolveSnapshot } from '$lib/snapshot/resolve';

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
