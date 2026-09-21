import type { Database } from '@factory/db';
import { runs, stepResults, tickets } from '@factory/db/schema';
import { conflict, type PipelineSnapshot, type RunFacts } from '@factory/shared';
import { and, eq, inArray } from 'drizzle-orm';
import { getRun } from './run';

/**
 * Continuing a run from its first unfinished step.
 *
 * The execution service writes each run's position to disk and resumes it
 * after a restart, so a stuck run is rare now. It is still possible — the
 * state directory wiped, a service moved to another machine — and then the
 * run is `running` with nothing driving it, and the only way out used to be
 * cancel and retry, which threw away every finished step and paid for it
 * again.
 *
 * What the run has established is all in this database: which steps are
 * done or skipped, what has been spent, and whether the ticket changes the
 * interface. So the same snapshot is handed to the execution service once
 * more, with a `resume` block saying where to pick up and what is already
 * known, and its loop starts there instead of at zero. Its start is
 * idempotent, so a workspace that still exists is kept; a step that was
 * `running` is run again, and the ledger accepts its second finish as the
 * first (FR-095).
 *
 * A person decides when a run is stuck, so this is a control on the ticket,
 * not a timer. Continuing a run that is in fact still being driven is refused
 * by the service, which knows.
 *
 * **A failed run continues too.** This was queued-or-running only, on the
 * reasoning that a failure is a decision already taken. But the commonest
 * failure is one step hitting its own deadline five steps into a pipeline,
 * and the only remedy on offer was Retry, which starts again from the
 * ticket and pays for every finished step a second time. The warning that
 * belongs to a stuck run — that a step still running would run twice —
 * does not apply here, because a failed run has nothing running. So the
 * cost of allowing it is that a step which failed for its own reasons is
 * attempted again, which is what a person pressing Continue is asking for.
 * A cancelled run is still refused: somebody stopped that one deliberately.
 */

export interface ResumePoint {
  /** The step to run next — the first that is neither done nor skipped. */
  index: number;
  facts: RunFacts;
  spent_usd: number;
}

/** What the trigger body carries in addition to the snapshot when continuing. */
export type ContinuingSnapshot = PipelineSnapshot & { resume: ResumePoint };

const CONTINUABLE = ['queued', 'running', 'failed'] as const;

/**
 * Where to pick up: the first unsettled step AT OR AFTER the furthest one
 * the run has already settled. `-1` when there is nothing left.
 *
 * "First unsettled" alone was wrong, because a checkpoint writes no step
 * result. A run that had passed its approval gate and failed four steps
 * later resumed at the gate — asking again for an approval already given,
 * and re-running every step in between. Nothing records that a gate was
 * passed; what records it is that a later step ran at all.
 */
export function resumeIndex(stepCount: number, settled: ReadonlySet<number>): number {
  const furthest = settled.size === 0 ? 0 : Math.max(...settled);
  for (let at = furthest; at < stepCount; at += 1) {
    if (!settled.has(at)) return at;
  }
  return -1;
}

export async function continueRun(
  database: Database,
  runId: string,
): Promise<{ snapshot: ContinuingSnapshot; index: number; stepName: string }> {
  const run = await getRun(database, runId);
  if (!(CONTINUABLE as readonly string[]).includes(run.status)) {
    throw conflict(
      run.status === 'waiting_approval'
        ? 'this run is waiting at a checkpoint — decide it there rather than continuing it'
        : `this run is ${run.status}; a queued, running or failed run can be continued`,
    );
  }
  const snapshot = run.snapshot as PipelineSnapshot;

  const recorded = await database
    .select({ index: stepResults.stepIndex, status: stepResults.status })
    .from(stepResults)
    .where(eq(stepResults.runId, runId));
  const settled = new Set(
    recorded
      .filter((row) => row.status === 'done' || row.status === 'skipped')
      .map((row) => row.index),
  );
  const index = resumeIndex(snapshot.pipeline.steps.length, settled);
  if (index === -1) {
    throw conflict('every step of this run has finished; there is nothing left to continue');
  }

  // The one fact a run establishes, when the specification step has said.
  const [ticket] = await database
    .select({ hasUi: tickets.hasUi })
    .from(tickets)
    .where(eq(tickets.id, run.ticketId))
    .limit(1);
  const facts: RunFacts =
    ticket?.hasUi === null || ticket?.hasUi === undefined ? {} : { hasUi: ticket.hasUi };

  const reviving = run.status === 'failed';

  /**
   * At most one run per ticket may be active (FR-020), enforced by a partial
   * unique index over exactly the statuses below. Reviving a failed run
   * while a retry of the same ticket is already going would breach it, and
   * the breach would surface as a database error rather than as an answer.
   * So it is checked here and said in words.
   */
  if (reviving) {
    const active = await database
      .select({ id: runs.id })
      .from(runs)
      .where(
        and(
          eq(runs.ticketId, run.ticketId),
          inArray(runs.status, ['queued', 'running', 'waiting_approval', 'opening_mr']),
        ),
      )
      .limit(1);
    if (active.length > 0) {
      throw conflict(
        'this ticket already has a run going; wait for it to finish before continuing an earlier one',
      );
    }
  }
  /**
   * The stale reason goes now: a person has acted on it. And a failed run
   * stops being failed, because otherwise it is not continuing at all.
   *
   * Everything the execution service does for a run begins by asking the
   * application for its credentials, and that route refuses a run whose
   * status is terminal — rightly, since a finished run has no sandbox to
   * prepare. Handing one over still marked `failed` therefore got it
   * accepted and then killed a moment later with `credential_missing: that
   * run has ended`, which names neither the cause nor the remedy.
   *
   * `queued` rather than `running`: it has been handed over and has not
   * begun. The `started` callback moves it on, exactly as for a first run.
   */
  await database
    .update(runs)
    .set({
      failureReason: null,
      ...(reviving ? { status: 'queued' as const, failureStepIndex: null, finishedAt: null } : {}),
      updatedAt: new Date(),
    })
    .where(eq(runs.id, runId));

  return {
    snapshot: { ...snapshot, resume: { index, facts, spent_usd: Number(run.costUsd) } },
    index,
    stepName: nameOf(snapshot, index),
  };
}

/** A step's name as a person would say it: the agent's, or the kind of step. */
export function nameOf(snapshot: PipelineSnapshot, index: number): string {
  const step = snapshot.pipeline.steps[index];
  if (!step) return `step ${index + 1}`;
  if (step.agent_id) {
    const agent = snapshot.agents.find((candidate) => candidate.id === step.agent_id);
    if (agent) return agent.name;
  }
  return step.type === 'checkpoint' ? 'the checkpoint' : `the ${step.type} step`;
}
