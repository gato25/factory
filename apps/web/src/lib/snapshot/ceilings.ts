/**
 * A member may set their own agent's limits (FR-006), so a limit set from
 * below must never raise what a run may consume: the effective ceiling is the
 * LEAST of the agent's, the pipeline's and the workspace's (FR-079a). Resolved
 * once at snapshot time and stored on the run, so the arithmetic cannot drift
 * mid-run.
 */

export interface CeilingInputs {
  workspace: { costUsd: string; minutes: number };
  pipeline?: { costUsd?: string | null; minutes?: number | null };
  agents?: { costUsd?: string | null; minutes?: number | null }[];
}

export interface Ceilings {
  costUsd: string;
  minutes: number;
  /** Which level supplied the binding value, so the interface can say so. */
  costFrom: 'workspace' | 'pipeline' | 'agent';
  minutesFrom: 'workspace' | 'pipeline' | 'agent';
}

/** Money is compared as scaled integers; never as floats (data-model.md). */
function toTenthsOfCent(value: string): number {
  const [whole, fraction = ''] = value.split('.');
  return Number(`${whole}${fraction.padEnd(4, '0').slice(0, 4)}`);
}

function fromTenthsOfCent(value: number): string {
  const s = String(value).padStart(5, '0');
  return `${s.slice(0, -4)}.${s.slice(-4)}`;
}

export function resolveCeilings(inputs: CeilingInputs): Ceilings {
  let costUsd = toTenthsOfCent(inputs.workspace.costUsd);
  let costFrom: Ceilings['costFrom'] = 'workspace';
  let minutes = inputs.workspace.minutes;
  let minutesFrom: Ceilings['minutesFrom'] = 'workspace';

  const consider = (
    cost: string | null | undefined,
    mins: number | null | undefined,
    source: 'pipeline' | 'agent',
  ) => {
    if (cost != null) {
      const candidate = toTenthsOfCent(cost);
      if (candidate < costUsd) {
        costUsd = candidate;
        costFrom = source;
      }
    }
    if (mins != null && mins < minutes) {
      minutes = mins;
      minutesFrom = source;
    }
  };

  consider(inputs.pipeline?.costUsd, inputs.pipeline?.minutes, 'pipeline');
  for (const agent of inputs.agents ?? []) {
    consider(agent.costUsd, agent.minutes, 'agent');
  }

  return { costUsd: fromTenthsOfCent(costUsd), minutes, costFrom, minutesFrom };
}

/**
 * The message FR-079a requires when a member's limit is not the one that
 * applies, so they are told which limit actually binds.
 */
export function explainCeilings(ceilings: Ceilings): string {
  const cost = `$${ceilings.costUsd} per run (from the ${ceilings.costFrom})`;
  const time = `${ceilings.minutes} minutes (from the ${ceilings.minutesFrom})`;
  return `This run may spend up to ${cost} and take up to ${time}.`;
}
