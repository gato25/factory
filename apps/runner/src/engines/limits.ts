import type { SnapshotAgent, StepOutcome } from '@factory/shared';

/**
 * An agent's own cost, time and turn limits, enforced within its step
 * (FR-080). Two of the three can be handed to the tool before it starts —
 * turns as a flag, time as a deadline on the process. Cost cannot: the engine
 * only reports what it spent once it is done, so a cost limit is checked
 * against the outcome and turns a finished step into a failed one.
 *
 * Nothing here may raise what the run is allowed to consume. A limit a member
 * set on an agent is capped at the run's own ceiling (FR-079a), so a
 * generous agent inside a mean pipeline gets the mean number.
 */

/** The signal the host uses for a process it killed at its deadline. */
export const TIMEOUT_EXIT_CODE = 124;

export interface RunCeilings {
  cost_ceiling_usd: string;
  time_ceiling_minutes: number;
}

export interface EffectiveLimits {
  maxCostUsd: string | null;
  maxMinutes: number | null;
  maxTurns: number | null;
}

export function effectiveLimits(
  agent: SnapshotAgent,
  run: RunCeilings,
  spentSoFarUsd = '0.0000',
): EffectiveLimits {
  const ceiling = Number(run.cost_ceiling_usd);
  const spent = Number(spentSoFarUsd);
  // What is actually left, so the last step of an expensive run cannot spend
  // the whole ceiling over again.
  const remaining = Math.max(0, ceiling - spent);
  const agentCost = agent.limits.max_cost_usd ? Number(agent.limits.max_cost_usd) : null;

  const cost = agentCost === null ? remaining : Math.min(agentCost, remaining);
  const minutes =
    agent.limits.max_minutes === undefined
      ? run.time_ceiling_minutes
      : Math.min(agent.limits.max_minutes, run.time_ceiling_minutes);

  return {
    maxCostUsd: cost.toFixed(4),
    maxMinutes: minutes,
    maxTurns: agent.limits.max_turns ?? null,
  };
}

export function timeoutMsFor(limits: EffectiveLimits): number | undefined {
  return limits.maxMinutes ? limits.maxMinutes * 60_000 : undefined;
}

export interface CostBreach {
  limit: string;
  spent: string;
}

export function costBreach(limits: EffectiveLimits, spentUsd: string): CostBreach | null {
  if (limits.maxCostUsd === null) return null;
  // Compared as fixed-point tenths of a cent, matching the numeric(10,4)
  // column, so the comparison cannot disagree with what is stored.
  const limit = Math.round(Number(limits.maxCostUsd) * 10_000);
  const spent = Math.round(Number(spentUsd) * 10_000);
  return spent > limit
    ? { limit: (limit / 10_000).toFixed(4), spent: (spent / 10_000).toFixed(4) }
    : null;
}

/**
 * The outcome as the limits leave it. A step killed at its deadline and a
 * step that overspent both become failures naming the limit they hit, so a
 * person reading the run sees the limit rather than a bare non-zero exit
 * (FR-081, FR-087).
 */
export function applyLimits(
  outcome: StepOutcome,
  limits: EffectiveLimits,
  context: { agentName: string; exitCode?: number },
): StepOutcome {
  if (context.exitCode === TIMEOUT_EXIT_CODE) {
    return {
      ...outcome,
      status: 'failed',
      error: {
        reason: 'time_exceeded',
        detail:
          `${context.agentName} was stopped after ${limits.maxMinutes} minutes, ` +
          'which is the longest this step may take.',
      },
    };
  }

  const breach = costBreach(limits, outcome.costUsd);
  if (breach) {
    return {
      ...outcome,
      status: 'failed',
      error: {
        reason: 'budget_exceeded',
        detail:
          `${context.agentName} spent $${breach.spent}, over the $${breach.limit} ` +
          'this step may spend.',
      },
    };
  }
  return outcome;
}
