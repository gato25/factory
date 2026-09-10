/**
 * What a single RUN may consume: taken from the pipeline or, failing that,
 * the workspace (FR-079), and never above the workspace's own (FR-079a).
 *
 * An agent's limits are deliberately NOT folded in here. Those are per-STEP
 * limits (FR-080): an agent allowed $0.75 a step inside a five-step pipeline
 * must not cap the whole run at $0.75, which is what including it would do —
 * the run would fail after its first step. The per-step cap lives in the
 * runner, against what the run has left.
 *
 * Resolved once at snapshot time and stored on the run, so the arithmetic
 * cannot drift mid-run.
 */

export interface CeilingInputs {
  workspace: { costUsd: string; minutes: number };
  pipeline?: { costUsd?: string | null; minutes?: number | null };
}

export interface Ceilings {
  costUsd: string;
  minutes: number;
  /** Which level supplied the binding value, so the interface can say so. */
  costFrom: 'workspace' | 'pipeline';
  minutesFrom: 'workspace' | 'pipeline';
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

  // A pipeline may lower the ceiling; it can never raise it (FR-079a).
  if (inputs.pipeline?.costUsd != null) {
    const candidate = toTenthsOfCent(inputs.pipeline.costUsd);
    if (candidate < costUsd) {
      costUsd = candidate;
      costFrom = 'pipeline';
    }
  }
  if (inputs.pipeline?.minutes != null && inputs.pipeline.minutes < minutes) {
    minutes = inputs.pipeline.minutes;
    minutesFrom = 'pipeline';
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
