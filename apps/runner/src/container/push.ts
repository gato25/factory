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
  const flag = options.force ? await lease(host, containerId, snapshot, gitToken) : '';
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
 * The lease to push a retry under: `--force-with-lease=<branch>:<sha>`, the
 * `<sha>` being where the remote branch stands right now.
 *
 * A bare `--force-with-lease` cannot work here, and a real run showed how it
 * fails. The lease's expected value comes from a remote-tracking ref, and
 * there is none: a run clones the DEFAULT branch with `--single-branch`, so
 * its own branch is never in the clone's refs, and the push goes to a URL
 * rather than a named remote, which has no tracking refs at all. Git then
 * refuses with "stale info" — so once any attempt had created the branch, no
 * later attempt on that ticket could ever push. The second attempt's work was
 * complete, committed, and unpushable.
 *
 * Naming the expected commit keeps what the lease is for: the push still
 * refuses if the branch moved since it was read, which is somebody else's
 * work, and overwrites only what this ticket's own previous attempt left.
 *
 * No branch on the remote yet means nothing to force: a plain push creates it.
 * A failure to read the remote also yields no flag — the push is about to
 * fail on the same credential or network, and its own error says so better
 * than a guess here would.
 */
async function lease(
  host: ContainerHost,
  containerId: string,
  snapshot: PipelineSnapshot,
  gitToken: string,
): Promise<string> {
  const branch = snapshot.repo.branch;
  const seen = await host.exec(
    containerId,
    [
      'sh',
      '-c',
      `git ls-remote ${authenticatedRemote(snapshot.repo.clone_url)} ` +
        quoteOne(`refs/heads/${branch}`),
    ],
    { cwd: WORKDIR, env: { GIT_TOKEN: gitToken } },
  );
  if (seen.exitCode !== 0) return '';

  const sha = seen.stdout.trim().split(/\s+/)[0] ?? '';
  if (!/^[0-9a-f]{40}$/.test(sha)) return '';
  return `--force-with-lease=${quoteOne(`${branch}:${sha}`)}`;
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
