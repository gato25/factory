import { FactoryError, type PipelineSnapshot } from '@factory/shared';
import type { ContainerHost } from './host';
import { quoteOne } from './shell';
import { authenticatedRemote, WORKDIR } from './start';

/**
 * Pushes the run's branch. It runs NO tests of its own — verification exists
 * only as a shell step an author added (FR-055a, FR-055b). The name is kept
 * because pushing is the gate before a merge request is opened.
 */

export type PushOutcome =
  | { pushed: true; commits: { hash: string; subject: string }[] }
  | { pushed: false; reason: string; detail: string };

export async function pushBranch(
  host: ContainerHost,
  containerId: string,
  snapshot: PipelineSnapshot,
  gitToken: string,
  options: { force?: boolean } = {},
): Promise<PushOutcome> {
  // Force is used on a retry, where the branch is brought back to a known
  // state rather than accumulating two attempts' work (FR-091).
  const flag = options.force ? '--force-with-lease' : '';
  const result = await host.exec(
    containerId,
    [
      'sh',
      '-c',
      `git push ${flag} ${authenticatedRemote(snapshot.repo.clone_url)} ` +
        quoteOne(snapshot.repo.branch),
    ],
    { cwd: WORKDIR, env: { GIT_TOKEN: gitToken } },
  );

  if (result.exitCode !== 0) {
    const detail = result.stderr.trim();
    return {
      pushed: false,
      reason: /authentication|403|401/i.test(detail)
        ? 'the access token was rejected when pushing'
        : 'the branch could not be pushed',
      detail,
    };
  }

  const log = await host.exec(
    containerId,
    // The range is one token, so a branch name is never shell syntax (002 FR-015).
    ['sh', '-c', `git log --format='%h %s' ${quoteOne(`${snapshot.repo.default_branch}..HEAD`)}`],
    { cwd: WORKDIR },
  );
  const commits = log.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const space = line.indexOf(' ');
      return { hash: line.slice(0, space), subject: line.slice(space + 1) };
    });

  return { pushed: true, commits };
}

/**
 * T080 — the branch pushed but the merge request could not be opened. This is
 * NOT total failure: the code exists and must not be discarded (FR-098).
 */
export function pushedWithoutMergeRequest(detail: string): FactoryError {
  return new FactoryError(
    'command_failed',
    'The branch was pushed, but the merge request could not be opened. Your code is safe on ' +
      'the branch — open the merge request on the provider, or retry.',
    { detail },
  );
}
