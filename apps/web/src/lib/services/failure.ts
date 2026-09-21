import type { Database } from '@factory/db';
import { artifacts, runs, stepResults, tickets } from '@factory/db/schema';
import { type FailureReason, notFound, type PipelineSnapshot } from '@factory/shared';
import { desc, eq, sql } from 'drizzle-orm';
import { m } from '$lib/i18n';

/**
 * What a person is shown when a run fails: which step, why, and what to do
 * about it — in language that does not require reading raw output
 * (FR-087, SC-008). The raw output stays one click away; it is never the
 * first thing a person has to read.
 */

export interface Failure {
  stepIndex: number | null;
  /** The step's own name, not its index. */
  stepLabel: string | null;
  /** One sentence saying what went wrong. */
  what: string;
  /** One sentence saying what to do about it. */
  next: string;
  /** True when retrying alone is unlikely to help. */
  needsAChange: boolean;
  /** The engine's own words, for whoever wants them. */
  detail: string | null;
  /** What the run consumed before it stopped. */
  spentUsd: string;
  ceilingUsd: string;
  /** The documents the failed attempt did produce, which a retry can build on. */
  produced: { path: string; version: number }[];
  attempt: number;
  /** False for a run that failed at a step, true for one stopped by us. */
  stoppedByACeiling: boolean;
}

/**
 * A reason maps to a sentence and a next step. This is the whole vocabulary:
 * anything not in it falls back to the step's own error, which is why the
 * fallback says what it can rather than pretending to diagnose.
 */
const EXPLANATIONS: Record<FailureReason, { what: string; next: string; needsAChange: boolean }> = {
  missing_output: {
    what: m.failure.missingOutputWhat,
    next: m.failure.missingOutputNext,
    needsAChange: true,
  },
  budget_exceeded: {
    what: m.failure.budgetWhat,
    next: m.failure.budgetNext,
    needsAChange: true,
  },
  // The ceiling is a deadline on each STEP, not a budget for the run. Saying
  // "the run" sent a reader looking at a run that had taken ninety-five
  // minutes under a forty-five minute ceiling and finding nothing wrong with
  // it, because nothing was: one step had exceeded the limit on its own.
  time_exceeded: {
    what: m.failure.timeWhat,
    next: m.failure.timeNext,
    needsAChange: true,
  },
  engine_unavailable: {
    what: m.failure.engineWhat,
    next: m.failure.retryOnly,
    needsAChange: false,
  },
  credential_invalid: {
    what: m.failure.credentialInvalidWhat,
    next: m.failure.credentialInvalidNext,
    needsAChange: true,
  },
  credential_missing: {
    what: m.failure.credentialMissingWhat,
    next: m.failure.credentialMissingNext,
    needsAChange: true,
  },
  sandbox_lost: {
    what: m.failure.sandboxLostWhat,
    next: m.failure.retryOnly,
    needsAChange: false,
  },
  app_unreachable: {
    what: m.failure.appUnreachableWhat,
    next: m.failure.appUnreachableNext,
    needsAChange: false,
  },
  runner_unreachable: {
    what: m.failure.runnerUnreachableWhat,
    next: m.failure.runnerUnreachableNext,
    needsAChange: false,
  },
  command_failed: {
    what: m.failure.commandFailedWhat,
    next: m.failure.commandFailedNext,
    needsAChange: true,
  },
  not_authorised: {
    what: m.failure.notAuthorisedWhat,
    next: m.failure.notAuthorisedNext,
    needsAChange: true,
  },
  conflict: {
    what: m.failure.conflictWhat,
    next: m.failure.conflictNext,
    needsAChange: false,
  },
  not_found: {
    what: m.failure.notFoundWhat,
    next: m.failure.notFoundNext,
    needsAChange: true,
  },
  invalid_input: {
    what: m.failure.invalidInputWhat,
    next: m.failure.invalidInputNext,
    needsAChange: true,
  },
};

/** Recognises a stored reason string, whether a code or a sentence we wrote. */
export function explain(reason: string | null): {
  what: string;
  next: string;
  needsAChange: boolean;
} {
  if (!reason) {
    return {
      what: m.failure.unknownWhat,
      next: m.failure.unknownNext,
      needsAChange: false,
    };
  }
  const known = EXPLANATIONS[reason as FailureReason];
  if (known) return known;

  // A ceiling reached is reported as a sentence rather than a code by both
  // the orchestrator and the ledger; recognise it either way.
  if (/cost ceiling|ceiling of \$|budget/i.test(reason)) {
    return EXPLANATIONS.budget_exceeded;
  }
  if (/time ceiling|minutes/i.test(reason)) return EXPLANATIONS.time_exceeded;
  if (/checkpoint within/i.test(reason)) {
    return {
      what: m.failure.gateExpiredWhat,
      next: m.failure.gateExpiredNext,
      needsAChange: false,
    };
  }

  // Our own sentence, already written for a person. Say it as it stands
  // rather than wrapping it in a worse one.
  return {
    what: reason.charAt(0).toUpperCase() + reason.slice(1),
    next: m.failure.ownSentenceNext,
    needsAChange: false,
  };
}

export async function failureOf(database: Database, runId: string): Promise<Failure | null> {
  const [run] = await database.select().from(runs).where(eq(runs.id, runId)).limit(1);
  if (!run) throw notFound(m.error.noSuchRun);
  if (run.status !== 'failed' && run.status !== 'cancelled') return null;

  const snapshot = run.snapshot as PipelineSnapshot;
  const stepIndex = run.failureStepIndex ?? run.currentStepIndex ?? null;
  const definition = stepIndex === null ? undefined : snapshot.pipeline.steps[stepIndex];
  const stepLabel = definition
    ? (snapshot.agents.find((a) => a.id === definition.agent_id)?.name ?? definition.type)
    : null;

  const [failedStep] =
    stepIndex === null
      ? []
      : await database
          .select({ errorDetail: stepResults.errorDetail })
          .from(stepResults)
          .where(
            sql`${stepResults.runId} = ${runId}::uuid and ${stepResults.stepIndex} = ${stepIndex}`,
          )
          .limit(1);

  const explanation = explain(run.failureReason);
  const produced = await database
    .select({ path: artifacts.path, version: artifacts.version })
    .from(artifacts)
    .where(eq(artifacts.runId, runId))
    .orderBy(artifacts.path, desc(artifacts.version));
  const latest = new Map<string, number>();
  for (const row of produced) if (!latest.has(row.path)) latest.set(row.path, row.version);

  return {
    stepIndex,
    stepLabel,
    what:
      run.status === 'cancelled'
        ? m.failure.cancelledWhat
        : explanation.what,
    next: run.status === 'cancelled' ? m.failure.cancelledNext : explanation.next,
    needsAChange: run.status === 'cancelled' ? false : explanation.needsAChange,
    detail: failedStep?.errorDetail ?? null,
    spentUsd: run.costUsd,
    ceilingUsd: run.costCeilingUsd,
    produced: [...latest.entries()].map(([path, version]) => ({ path, version })),
    attempt: run.attempt,
    stoppedByACeiling:
      explanation === EXPLANATIONS.budget_exceeded || explanation === EXPLANATIONS.time_exceeded,
  };
}

/** Every attempt on a ticket, so a previous one stays readable (FR-090). */
export async function attemptsOf(database: Database, ticketId: string) {
  const [ticket] = await database
    .select({ id: tickets.id })
    .from(tickets)
    .where(eq(tickets.id, ticketId))
    .limit(1);
  if (!ticket) throw notFound(m.error.noSuchTicket);

  const rows = await database
    .select({
      id: runs.id,
      attempt: runs.attempt,
      status: runs.status,
      costUsd: runs.costUsd,
      failureReason: runs.failureReason,
      failureStepIndex: runs.failureStepIndex,
      startedAt: runs.startedAt,
      finishedAt: runs.finishedAt,
    })
    .from(runs)
    .where(eq(runs.ticketId, ticketId))
    .orderBy(desc(runs.attempt));

  return rows.map((row) => ({
    ...row,
    // A previous attempt is summarised in the same language as a current one.
    what: row.failureReason ? explain(row.failureReason).what : null,
  }));
}
