import type { Database } from '@factory/db';
import { artifacts, runs, stepResults, tickets } from '@factory/db/schema';
import { type FailureReason, notFound, type PipelineSnapshot } from '@factory/shared';
import { desc, eq, sql } from 'drizzle-orm';

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
    what: 'The step finished without producing the document it was supposed to write.',
    next: 'Usually the ticket did not give the agent enough to work from. Add detail to the description or the acceptance criteria, then retry.',
    needsAChange: true,
  },
  budget_exceeded: {
    what: 'The run reached the most it was allowed to spend.',
    next: 'Either the ticket is larger than the ceiling allows, or it needs narrowing. Split it, or raise the ceiling on the pipeline.',
    needsAChange: true,
  },
  time_exceeded: {
    what: 'The run reached the longest it was allowed to take.',
    next: 'Narrow the ticket, or raise the time ceiling on the pipeline.',
    needsAChange: true,
  },
  engine_unavailable: {
    what: 'The model could not be reached.',
    next: 'Nothing is wrong with the ticket. Retry.',
    needsAChange: false,
  },
  credential_invalid: {
    what: 'A stored credential was rejected.',
    next: 'An administrator needs to replace it in Settings before a retry can get further.',
    needsAChange: true,
  },
  credential_missing: {
    what: 'A credential this pipeline needs is not configured.',
    next: 'An administrator needs to add it in Settings before a retry can get further.',
    needsAChange: true,
  },
  sandbox_lost: {
    what: 'The sandbox the step was running in disappeared, and the second attempt did not get further.',
    next: 'Nothing is wrong with the ticket. Retry.',
    needsAChange: false,
  },
  app_unreachable: {
    what: 'The execution service could not reach this application to collect something the run needs.',
    next: 'Nothing is wrong with the ticket. Check that the execution service can reach the address in PUBLIC_BASE_URL, then retry.',
    needsAChange: false,
  },
  command_failed: {
    what: 'A command the pipeline runs exited with an error.',
    next: 'Read the step output to see which command and why. If it is the repository, fix that first.',
    needsAChange: true,
  },
  not_authorised: {
    what: 'The run was refused access to something it needed.',
    next: 'Check the credential has the permissions the repository requires.',
    needsAChange: true,
  },
  conflict: {
    what: 'Something changed underneath the run.',
    next: 'Retry — the run will take a fresh look.',
    needsAChange: false,
  },
  not_found: {
    what: 'Something the run expected to exist did not.',
    next: 'Check the repository and branch still exist, then retry.',
    needsAChange: true,
  },
  invalid_input: {
    what: 'The run was given something it could not use.',
    next: 'Read the detail below, correct the ticket, then retry.',
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
      what: 'The run stopped without recording why.',
      next: 'Retry. If it stops again the same way, the step output is the only place left to look.',
      needsAChange: false,
    };
  }
  // Two very different `sandbox_lost` causes reach a person as the same code,
  // because the execution-host contract makes them the same reason
  // deliberately: from the run's point of view no sandbox exists either way,
  // and recovery's single rebuild is the right response to both. But the ADVICE
  // differs, and that is what a person is reading this for (002 FR-024a).
  // Checked before the code table, because these arrive as the SENTENCE the
  // execution service wrote rather than as a code — and one of them must not
  // be answered with "retry".
  if (/max_instances|instance limit is reached|will not clear on its own/i.test(reason)) {
    return {
      what: 'The execution host refused a sandbox because the deployment has reached the number of sandboxes it is configured to run at once.',
      next: 'Retrying will not help until that limit is raised, which is a change where the execution service is deployed rather than anything in this workspace.',
      needsAChange: true,
    };
  }
  if (/no capacity|no container instance|try again later/i.test(reason)) {
    return {
      what: 'The execution host had no room for a sandbox, and still had none after waiting.',
      next: 'Nothing is wrong with the ticket, and nothing needs changing. Retry — this usually clears within a minute.',
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
      what: 'Nobody decided the checkpoint before it expired, and the gate was set to fail.',
      next: 'Retry, and decide the checkpoint this time — or change the gate to wait indefinitely.',
      needsAChange: false,
    };
  }

  // Our own sentence, already written for a person. Say it as it stands
  // rather than wrapping it in a worse one.
  return {
    what: reason.charAt(0).toUpperCase() + reason.slice(1),
    next: 'Retry, or edit the ticket first if the reason points at the ticket.',
    needsAChange: false,
  };
}

export async function failureOf(database: Database, runId: string): Promise<Failure | null> {
  const [run] = await database.select().from(runs).where(eq(runs.id, runId)).limit(1);
  if (!run) throw notFound('no such run');
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
        ? 'The run was cancelled. The branch it had pushed is still there.'
        : explanation.what,
    next: run.status === 'cancelled' ? 'Retry when you want it to carry on.' : explanation.next,
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
  if (!ticket) throw notFound('no such ticket');

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
