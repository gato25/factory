import type { Database } from '@factory/db';
import { runs, stepResults } from '@factory/db/schema';
import { createLogger } from '@factory/shared';
import { eq, sql } from 'drizzle-orm';
import type { ReleaseSandbox } from '$lib/services/sandbox';

/**
 * The ceilings a run may not exceed (FR-079), and what happens when it does
 * (FR-081). The orchestrator carries a copy of the cost check so it can stop
 * between steps without a round trip, but this is the system of record: it is
 * what the run's own numbers are judged against.
 *
 * Money is compared in the database on a numeric column. Doing it in
 * JavaScript would introduce the floating-point error SC-006 measures.
 */

const log = createLogger('web');

export type BreachKind = 'cost' | 'time';

export interface Breach {
  kind: BreachKind;
  /** What the run was allowed. */
  ceiling: string;
  /** What it actually consumed. */
  consumed: string;
  /** The reason a person reads, naming the ceiling (FR-081). */
  reason: string;
}

export interface Consumption {
  costUsd: string;
  ceilingUsd: string;
  minutesElapsed: number;
  ceilingMinutes: number;
  /** Fraction of the cost ceiling consumed, for the run view. */
  costFraction: number;
}

export async function consumption(database: Database, runId: string): Promise<Consumption> {
  const [row] = await database
    .select({
      costUsd: runs.costUsd,
      ceilingUsd: runs.costCeilingUsd,
      ceilingMinutes: runs.timeCeilingMinutes,
      // Elapsed is measured from the run's own start, in the database, so a
      // clock difference between processes cannot change the answer.
      minutes: sql<string>`
        extract(epoch from (now() - coalesce(${runs.startedAt}, ${runs.createdAt}))) / 60`,
    })
    .from(runs)
    .where(eq(runs.id, runId))
    .limit(1);
  if (!row) throw new Error(`no such run: ${runId}`);

  return {
    costUsd: row.costUsd,
    ceilingUsd: row.ceilingUsd,
    minutesElapsed: Math.floor(Number(row.minutes)),
    ceilingMinutes: row.ceilingMinutes,
    costFraction: Number(row.ceilingUsd) === 0 ? 1 : Number(row.costUsd) / Number(row.ceilingUsd),
  };
}

/**
 * Whether a run has passed either ceiling. Cost is compared in the database;
 * the comparison is `>=` because a run that has consumed exactly its ceiling
 * has nothing left to spend on another step.
 */
export async function breachOf(database: Database, runId: string): Promise<Breach | null> {
  const [row] = await database
    .select({
      costUsd: runs.costUsd,
      ceilingUsd: runs.costCeilingUsd,
      overCost: sql<boolean>`${runs.costUsd} >= ${runs.costCeilingUsd}`,
      ceilingMinutes: runs.timeCeilingMinutes,
      minutes: sql<string>`
        extract(epoch from (now() - coalesce(${runs.startedAt}, ${runs.createdAt}))) / 60`,
      overTime: sql<boolean>`
        extract(epoch from (now() - coalesce(${runs.startedAt}, ${runs.createdAt})))
          >= ${runs.timeCeilingMinutes} * 60`,
    })
    .from(runs)
    .where(eq(runs.id, runId))
    .limit(1);
  if (!row) return null;

  if (row.overCost) {
    return {
      kind: 'cost',
      ceiling: row.ceilingUsd,
      consumed: row.costUsd,
      reason:
        `the run reached its cost ceiling of $${row.ceilingUsd} ` +
        `after spending $${row.costUsd}`,
    };
  }
  if (row.overTime) {
    const minutes = Math.floor(Number(row.minutes));
    return {
      kind: 'time',
      ceiling: `${row.ceilingMinutes}`,
      consumed: `${minutes}`,
      reason:
        `the run reached its time ceiling of ${row.ceilingMinutes} minutes ` +
        `after running for ${minutes}`,
    };
  }
  return null;
}

/**
 * Whether there is room for another step. A step is only started when the run
 * is still under both ceilings, which is what keeps the overshoot to a single
 * step's cost rather than unbounded (SC-006).
 */
export async function mayStartAnotherStep(
  database: Database,
  runId: string,
): Promise<{ ok: true } | { ok: false; breach: Breach }> {
  const breach = await breachOf(database, runId);
  return breach ? { ok: false, breach } : { ok: true };
}

export interface EnforceDeps {
  /** Releasing the sandbox is the "stop the work" half of FR-081. */
  releaseSandbox?: ReleaseSandbox;
}

/**
 * Stops the work and fails the run, naming the ceiling and what was consumed
 * (FR-081). Idempotent: a run already in a terminal state is left alone, so
 * two enforcement passes cannot fight over the reason.
 */
export async function enforceCeilings(
  database: Database,
  runId: string,
  deps: EnforceDeps = {},
): Promise<{ failed: false } | { failed: true; breach: Breach }> {
  const breach = await breachOf(database, runId);
  if (!breach) return { failed: false };

  const [run] = await database.select().from(runs).where(eq(runs.id, runId)).limit(1);
  if (!run) return { failed: false };
  if (run.status === 'done' || run.status === 'failed' || run.status === 'cancelled') {
    return { failed: false };
  }

  // Whichever step was in flight is what failed, so the run view points at it.
  const [inFlight] = await database
    .select({ stepIndex: stepResults.stepIndex })
    .from(stepResults)
    .where(sql`${stepResults.runId} = ${runId}::uuid and ${stepResults.status} = 'running'`)
    .limit(1);

  const updated = await database
    .update(runs)
    .set({
      status: 'failed',
      failureReason: breach.reason,
      failureStepIndex: inFlight?.stepIndex ?? run.currentStepIndex,
      finishedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(sql`${runs.id} = ${runId}::uuid
      and ${runs.status} in ('queued', 'running', 'waiting_approval', 'opening_mr')`)
    .returning({ id: runs.id });
  if (updated.length === 0) return { failed: false };

  if (run.containerId && deps.releaseSandbox) {
    try {
      await deps.releaseSandbox({
        runId,
        containerId: run.containerId,
        // A run stopped at a ceiling has failed, so the Runner's retention
        // rule applies to it (FR-086).
        outcome: 'failed',
      });
      // Recording the release is what makes a leak visible (SC-012).
      await database
        .update(runs)
        .set({ containerId: null, updatedAt: new Date() })
        .where(eq(runs.id, runId));
    } catch (error) {
      // The run is failed either way; a leaked sandbox is a smaller problem
      // than a run that looks alive but cannot progress. The container id
      // stays on the row: it is the only handle anything has for reclaiming
      // it, and this log line is what says it needs reclaiming.
      log.error('could not release the sandbox of a run stopped at its ceiling', {
        run_id: runId,
        container_id: run.containerId,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  log.warn('run stopped at a ceiling', {
    run_id: runId,
    kind: breach.kind,
    ceiling: breach.ceiling,
    consumed: breach.consumed,
  });
  return { failed: true, breach };
}
