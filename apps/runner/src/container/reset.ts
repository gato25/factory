import type { PipelineSnapshot } from '@factory/shared';
import type { ContainerHost } from './host';
import { quoteOne } from './shell';
import { authenticatedRemote, WORKDIR } from './start';

/**
 * An attempt beginning on a branch a previous attempt already wrote to starts
 * from a known state (FR-091). "Known" means the repository's current default
 * branch: a second attempt that inherited the first one's half-finished
 * commits would be reasoning about work nobody approved.
 *
 * The remote's own history for the branch is fetched first, even though it is
 * then discarded. That fetch is what gives the push that follows a lease to
 * check against, so replacing the branch stays a deliberate act rather than a
 * blind overwrite of whatever arrived in the meantime.
 */

export interface ResetOutcome {
  /** True when a previous attempt had already pushed this branch. */
  existedRemotely: boolean;
  /** What the branch pointed at before, so a person can find that work. */
  previousHead: string | null;
  /** What it points at now. */
  head: string;
}

export async function resetRunBranch(
  host: ContainerHost,
  containerId: string,
  snapshot: PipelineSnapshot,
  gitToken: string,
): Promise<ResetOutcome> {
  const branch = snapshot.repo.branch;
  const base = snapshot.repo.default_branch;
  // A branch no previous attempt pushed simply is not there; that is not an
  // error, so the fetch's failure is the answer rather than a throw.
  const fetched = await host.exec(
    containerId,
    [
      'sh',
      '-c',
      `git fetch ${authenticatedRemote(snapshot.repo.clone_url)} ` +
        quoteOne(`+refs/heads/${branch}:refs/remotes/origin/${branch}`),
    ],
    { cwd: WORKDIR, env: { GIT_TOKEN: gitToken } },
  );
  const existedRemotely = fetched.exitCode === 0;

  let previousHead: string | null = null;
  if (existedRemotely) {
    const shown = await host.exec(
      containerId,
      ['git', 'rev-parse', `refs/remotes/origin/${branch}`],
      { cwd: WORKDIR },
    );
    previousHead = shown.exitCode === 0 ? shown.stdout.trim() : null;
  }

  const reset = await host.exec(
    containerId,
    [
      'sh',
      '-c',
      `git checkout -B ${quoteOne(branch)} ${quoteOne(`origin/${base}`)} && git rev-parse HEAD`,
    ],
    { cwd: WORKDIR },
  );
  if (reset.exitCode !== 0) {
    throw new Error(`could not put ${branch} back to ${base}: ${reset.stderr.trim()}`);
  }

  return {
    existedRemotely,
    previousHead,
    head: reset.stdout.trim().split('\n').pop() ?? '',
  };
}

/**
 * Whether the branch this attempt will write to has history a previous
 * attempt left behind, without changing anything. The push flag and the
 * reset both depend on the answer.
 */
export async function branchExistsRemotely(
  host: ContainerHost,
  containerId: string,
  snapshot: PipelineSnapshot,
  gitToken: string,
): Promise<boolean> {
  const result = await host.exec(
    containerId,
    [
      'sh',
      '-c',
      `git ls-remote --exit-code --heads ${authenticatedRemote(snapshot.repo.clone_url)} ` +
        quoteOne(snapshot.repo.branch),
    ],
    { cwd: WORKDIR, env: { GIT_TOKEN: gitToken } },
  );
  return result.exitCode === 0;
}
