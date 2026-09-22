import type { ContainerHost } from './host';
import { quote, quoteOne } from './shell';
import { WORKDIR } from './start';

/**
 * The design source and the exported screens are committed to the run's
 * branch (FR-105). That is what lets a design travel with the code it
 * describes, and what lets a later ticket revise the design rather than
 * redraw it (FR-106).
 */

export interface CommitDesignInput {
  reference: string;
  /** Workspace-relative paths to add. */
  paths: string[];
  revising: boolean;
}

export interface CommitOutcome {
  committed: boolean;
  /** The commit's hash, or null when there was nothing to commit. */
  hash: string | null;
}

export async function commitDesign(
  host: ContainerHost,
  containerId: string,
  input: CommitDesignInput,
): Promise<CommitOutcome> {
  return commitPaths(host, containerId, {
    paths: input.paths,
    subject: `design(${input.reference}): ${input.revising ? 'revise' : 'add'} screens`,
    whatFailed: 'the design',
  });
}

export interface CommitPathsInput {
  /** Workspace-relative paths to add. */
  paths: string[];
  subject: string;
  /** Named in the error when the commit itself fails. */
  whatFailed: string;
}

/**
 * Stages the given paths and commits them, or does nothing if they are
 * already committed.
 *
 * Generalised out of the design step because every step's output needs it,
 * not just that one. A run that waits overnight at an approval checkpoint
 * loses its sandbox — the lifetime is hours and the wait is however long a
 * person takes — and the replacement is a fresh clone. The recovery path
 * says it resumes "from the last commit on the branch", and the only step
 * that put anything there was the design one. So a specification and a plan
 * written before the checkpoint simply vanished, and the step after it
 * reported, correctly, that its inputs did not exist.
 */
export async function commitPaths(
  host: ContainerHost,
  containerId: string,
  input: CommitPathsInput,
): Promise<CommitOutcome> {
  if (input.paths.length === 0) return { committed: false, hash: null };

  // Paths come from a step's configuration, so they are quoted rather than
  // wrapped in quote characters (002 FR-015).
  const quoted = quote(input.paths);

  // `--` keeps a path that looks like a flag from being read as one, and
  // `diff --cached --quiet` is what makes a re-run with no change a no-op
  // rather than an empty commit. `--ignore-unmatch`-style tolerance comes
  // from `|| true`: a declared output a step chose not to write is not a
  // reason to fail the commit of the ones it did.
  const script = [
    `git add -- ${quoted} || true`,
    `git diff --cached --quiet && echo NOTHING_TO_COMMIT && exit 0`,
    `git commit -m ${quoteOne(input.subject)} >/dev/null`,
    'git rev-parse HEAD',
  ].join('\n');

  const result = await host.exec(containerId, ['sh', '-c', script], { cwd: WORKDIR });
  if (result.exitCode !== 0) {
    throw new Error(`could not commit ${input.whatFailed}: ${result.stderr.trim()}`);
  }
  if (result.stdout.includes('NOTHING_TO_COMMIT')) return { committed: false, hash: null };

  return { committed: true, hash: result.stdout.trim().split('\n').pop() ?? null };
}
