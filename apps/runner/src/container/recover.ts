import { FactoryError, type PipelineSnapshot } from '@factory/shared';
import { writeAgentConfig } from './config';
import type { ContainerHost } from './host';
import type { ResolvedCredentials } from './secrets';
import { quoteOne } from './shell';
import { authenticatedRemote, type StartInput, startRunWorkspace, WORKDIR } from './start';

/**
 * A sandbox or its host can disappear mid-step. When that happens the step is
 * attempted again in a NEW sandbox holding the branch as the steps before it
 * left it (FR-093).
 *
 * A few times, not once and not forever — see `MAX_REPLACEMENTS` below for
 * why that number changed and what still bounds it.
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
 * How many replacement sandboxes one step may be given.
 *
 * This was one, and the reasoning held at the time: a rebuild resumed from
 * the last commit that had reached the remote, and only the design step ever
 * pushed anything, so a rebuild usually meant starting the step from a
 * workspace with none of the run's work in it. Doing that repeatedly would
 * have spent a ticket's whole ceiling on infrastructure.
 *
 * Every step now commits what it produced and pushes it, and a rebuilt
 * workspace takes the branch rather than starting it over. So a replacement
 * costs a clone and loses nothing — a run of this pipeline lost its sandbox
 * and came back with its specification, design, plan and task list intact.
 * A lost sandbox is a bad moment on the host, not a reason to throw away
 * four finished steps.
 *
 * Bounded rather than unlimited because a host that cannot hold a sandbox at
 * all must still fail rather than clone forever, and the step's own time
 * ceiling is the other thing stopping it.
 */
const MAX_REPLACEMENTS = 3;

/**
 * Runs `work` in the given sandbox, and on sandbox loss builds a replacement
 * that takes the branch as the steps before it left it, then runs the work
 * again. Any other failure is the step's own and passes straight through —
 * only a lost sandbox earns another sandbox.
 */
export async function withSandboxRecovery<T>(
  host: ContainerHost,
  containerId: string,
  input: RecoverInput,
  work: (containerId: string) => Promise<T>,
  /**
   * Whether a lost sandbox is worth replacing. A run the application has
   * cancelled had its sandbox released on purpose, and rebuilding it would
   * clone the repository again for a step nobody wants — so the caller says.
   */
  canRecover: () => Promise<boolean> = async () => true,
): Promise<Recovery<T>> {
  let current = containerId;
  let resumedFrom: string | undefined;
  let lost = 0;

  for (;;) {
    try {
      const outcome = await work(current);
      return lost === 0 ? { outcome, recovered: false } : { outcome, recovered: true, resumedFrom };
    } catch (error) {
      if (!isSandboxLoss(error)) throw error;
      if (!(await canRecover())) throw error;

      lost += 1;
      if (lost > MAX_REPLACEMENTS) {
        throw new FactoryError(
          'sandbox_lost',
          `The sandbox disappeared while the step was running, and so did ${MAX_REPLACEMENTS} ` +
            'replacements. Something is wrong with the machine running the steps rather than ' +
            'with this ticket. The work committed to the branch is still there.',
          { detail: error instanceof Error ? error.message : String(error) },
        );
      }

      // Do not wait on the corpse: it is the host that is unreliable.
      await host.destroy(lost === 1 ? (input.lostContainerId ?? current) : current).catch(() => {});

      const replacement = await buildReplacement(host, input);
      current = replacement.containerId;
      resumedFrom = replacement.resumedFrom;
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
    // A replacement is built mid-attempt, so it takes the run's branch from
    // the remote rather than starting it from the default branch. Without
    // this it cloned the default branch and every step's pushed work was
    // discarded, which is the whole thing this function exists to preserve.
    adoptBranch: true,
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
  // A branch name reaches here from the repository record, so it is quoted
  // rather than interpolated (002 FR-015). The remote is the one fragment that
  // must stay shell-expandable — see authenticatedRemote.
  const refspec = quoteOne(`+refs/heads/${branch}:refs/remotes/origin/${branch}`);
  const remoteRef = quoteOne(`refs/remotes/origin/${branch}`);
  const fetched = await host.exec(
    containerId,
    [
      'sh',
      '-c',
      `git fetch ${authenticatedRemote(snapshot.repo.clone_url)} ${refspec} && ` +
        `git checkout -B ${quoteOne(branch)} ${remoteRef} && git rev-parse HEAD`,
    ],
    { cwd: WORKDIR, env: { GIT_TOKEN: credentials.gitToken } },
  );
  if (fetched.exitCode !== 0) {
    const head = await host.exec(containerId, ['git', 'rev-parse', 'HEAD'], { cwd: WORKDIR });
    return head.stdout.trim();
  }
  return fetched.stdout.trim().split('\n').pop() ?? '';
}
