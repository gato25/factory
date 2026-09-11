import { FactoryError, type PipelineSnapshot } from '@factory/shared';
import { writeAgentConfig } from './config';
import type { ContainerHost } from './host';
import type { ResolvedCredentials } from './secrets';
import { type StartInput, startRunWorkspace, WORKDIR } from './start';

/**
 * A sandbox or its host can disappear mid-step. When that happens the step is
 * attempted once more in a NEW sandbox, resuming from the last commit on the
 * branch, and a second loss fails the run (FR-093).
 *
 * Once, not repeatedly, and that is the point: a host that drops two
 * sandboxes in a row is not having a bad moment, and a run that keeps
 * restarting spends the ticket's whole ceiling on infrastructure.
 */

export function isSandboxLoss(error: unknown): boolean {
  return error instanceof FactoryError && error.reason === 'sandbox_lost';
}

export interface RecoverInput extends StartInput {
  /** The sandbox that went away, if we still have its identifier. */
  lostContainerId?: string;
}

export interface Recovery<T> {
  outcome: T;
  /** True when the work above ran in a replacement sandbox. */
  recovered: boolean;
  /** Where the replacement resumed from. */
  resumedFrom?: string;
}

/**
 * Runs `work` in the given sandbox, and on sandbox loss builds a replacement
 * resuming from the last commit on the branch and runs it once more. Any
 * other failure is the step's own and passes straight through — only a lost
 * sandbox earns a second sandbox.
 */
export async function withSandboxRecovery<T>(
  host: ContainerHost,
  containerId: string,
  input: RecoverInput,
  work: (containerId: string) => Promise<T>,
): Promise<Recovery<T>> {
  try {
    return { outcome: await work(containerId), recovered: false };
  } catch (error) {
    if (!isSandboxLoss(error)) throw error;

    // Do not wait on the corpse: it is the host that is unreliable.
    await host.destroy(input.lostContainerId ?? containerId).catch(() => {});

    const replacement = await buildReplacement(host, input);
    try {
      const outcome = await work(replacement.containerId);
      return { outcome, recovered: true, resumedFrom: replacement.resumedFrom };
    } catch (second) {
      if (isSandboxLoss(second)) {
        throw new FactoryError(
          'sandbox_lost',
          'The sandbox disappeared while the step was running, and the replacement did too. ' +
            'The work committed to the branch is still there.',
          { detail: second instanceof Error ? second.message : String(second) },
        );
      }
      throw second;
    }
  }
}

/**
 * A fresh sandbox holding the branch as the lost one left it — the last
 * commit that reached the remote. Work committed but never pushed is gone
 * with the sandbox, which is why the implementing agent commits per task.
 */
export async function buildReplacement(
  host: ContainerHost,
  input: RecoverInput,
): Promise<{ containerId: string; resumedFrom: string }> {
  const { containerId } = await startRunWorkspace(host, {
    snapshot: input.snapshot,
    credentials: input.credentials,
    sandbox: input.sandbox,
  });

  try {
    const resumedFrom = await resumeFromBranch(
      host,
      containerId,
      input.snapshot,
      input.credentials,
    );
    // The prompts and skills are written from the snapshot, so the
    // replacement reads exactly what the lost sandbox read (FR-044).
    await writeAgentConfig(host, containerId, WORKDIR, { snapshot: input.snapshot });
    return { containerId, resumedFrom };
  } catch (error) {
    await host.destroy(containerId).catch(() => {});
    throw error;
  }
}

/**
 * Checks out the run branch as the remote has it. When no previous commit
 * reached the remote there is nothing to resume from, and the replacement
 * starts where the first sandbox did — the default branch.
 */
async function resumeFromBranch(
  host: ContainerHost,
  containerId: string,
  snapshot: PipelineSnapshot,
  credentials: ResolvedCredentials,
): Promise<string> {
  const branch = snapshot.repo.branch;
  const authenticated = snapshot.repo.clone_url.replace(
    /^https:\/\//,
    'https://oauth2:${GIT_TOKEN}@',
  );
  const fetched = await host.exec(
    containerId,
    [
      'sh',
      '-c',
      `git fetch "${authenticated}" '+refs/heads/${branch}:refs/remotes/origin/${branch}' && ` +
        `git checkout -B '${branch}' 'refs/remotes/origin/${branch}' && git rev-parse HEAD`,
    ],
    { cwd: WORKDIR, env: { GIT_TOKEN: credentials.gitToken } },
  );
  if (fetched.exitCode !== 0) {
    const head = await host.exec(containerId, ['git', 'rev-parse', 'HEAD'], { cwd: WORKDIR });
    return head.stdout.trim();
  }
  return fetched.stdout.trim().split('\n').pop() ?? '';
}
