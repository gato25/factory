import type { Database } from '@factory/db';
import { runs, stepResults, tickets } from '@factory/db/schema';
import { conflict, type PipelineSnapshot, type RunFacts } from '@factory/shared';
import { eq } from 'drizzle-orm';
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
 */

export interface ResumePoint {
  /** The step to run next — the first that is neither done nor skipped. */
  index: number;
  facts: RunFacts;
  spent_usd: number;
}

/** What the trigger body carries in addition to the snapshot when continuing. */
export type ContinuingSnapshot = PipelineSnapshot & { resume: ResumePoint };

const CONTINUABLE = ['queued', 'running'] as const;

export async function continueRun(
  database: Database,
  runId: string,
): Promise<{ snapshot: ContinuingSnapshot; index: number; stepName: string }> {
  const run = await getRun(database, runId);
  if (!(CONTINUABLE as readonly string[]).includes(run.status)) {
    throw conflict(
      run.status === 'waiting_approval'
        ? 'this run is waiting at a checkpoint — decide it there rather than continuing it'
        : `this run is ${run.status}; only a queued or running run can be continued`,
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
  const index = snapshot.pipeline.steps.findIndex((_step, at) => !settled.has(at));
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

  // The stale reason goes now: a person has acted on it.
  await database
    .update(runs)
    .set({ failureReason: null, updatedAt: new Date() })
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
