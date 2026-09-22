/**
 * What every container this service creates is marked with, so that a
 * container can be traced back to the run, step or launch it was made for —
 * and so that one which cannot be traced to anything alive can be found.
 *
 * A runner that died between `docker run` and writing the container's id
 * down left a container nothing could account for: not in any run's record,
 * not in any state file, running out its wall-clock `sleep` on a machine
 * whose operator had no way to tell it from a sandbox somebody was using.
 * `docker ps --filter label=factory.owner=code-factory` now answers that.
 */

export const OWNER_LABEL = 'factory.owner';
export const OWNER = 'code-factory';
export const KIND_LABEL = 'factory.kind';
export const RUN_LABEL = 'factory.run';
export const LAUNCH_LABEL = 'factory.launch';
export const STEP_LABEL = 'factory.step';

export type ContainerKind =
  /** A run's sandbox, alive for the run. */
  | 'run'
  /** One isolated step's container over a run's workspace (`isolate.ts`). */
  | 'step'
  /** A branch launched for somebody to look at (003). */
  | 'launch';

export type ContainerLabels = Record<string, string>;

/** The labels for a run's sandbox. */
export function runLabels(runId: string): ContainerLabels {
  return { [OWNER_LABEL]: OWNER, [KIND_LABEL]: 'run', [RUN_LABEL]: runId };
}

/** The labels for a launch's container. */
export function launchLabels(launchId: string): ContainerLabels {
  return { [OWNER_LABEL]: OWNER, [KIND_LABEL]: 'launch', [LAUNCH_LABEL]: launchId };
}

/**
 * The labels for one isolated step's container: the run's own, re-marked as
 * a step's, with which step. Given the run's labels, because the isolating
 * host has the run's spec and nothing else that names the run.
 */
export function stepLabels(
  runLabelsOrNone: ContainerLabels | undefined,
  stepIndex?: number,
): ContainerLabels {
  return {
    ...(runLabelsOrNone ?? { [OWNER_LABEL]: OWNER }),
    [KIND_LABEL]: 'step',
    ...(stepIndex === undefined ? {} : { [STEP_LABEL]: String(stepIndex) }),
  };
}

/** `--label key=value` for each, in a stable order. */
export function labelArgs(labels: ContainerLabels | undefined): string[] {
  return Object.entries(labels ?? {})
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([key, value]) => ['--label', `${key}=${value}`]);
}

/** The filter that selects every container this service made. */
export const OWNED_FILTER = `label=${OWNER_LABEL}=${OWNER}`;
