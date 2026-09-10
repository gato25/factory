import type { ContainerHost } from './host';
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
  if (input.paths.length === 0) return { committed: false, hash: null };

  const quoted = input.paths.map((path) => `'${path}'`).join(' ');
  const subject = `design(${input.reference}): ${input.revising ? 'revise' : 'add'} screens`;

  // `--` keeps a path that looks like a flag from being read as one, and
  // `diff --cached --quiet` is what makes a re-run with no change a no-op
  // rather than an empty commit.
  const script = [
    `git add -- ${quoted}`,
    `git diff --cached --quiet && echo NOTHING_TO_COMMIT && exit 0`,
    `git commit -m '${subject.replace(/'/g, "'\\''")}' >/dev/null`,
    'git rev-parse HEAD',
  ].join('\n');

  const result = await host.exec(containerId, ['sh', '-c', script], { cwd: WORKDIR });
  if (result.exitCode !== 0) {
    throw new Error(`could not commit the design: ${result.stderr.trim()}`);
  }
  if (result.stdout.includes('NOTHING_TO_COMMIT')) return { committed: false, hash: null };

  return { committed: true, hash: result.stdout.trim().split('\n').pop() ?? null };
}
