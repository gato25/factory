import { FactoryError, type PipelineSnapshot } from '@factory/shared';
import { writeAgentConfig } from './config';
import type { ContainerHost, ContainerSpec } from './host';
import { fetchRequirementFiles, writeRequirementFiles } from './requirements';
import { buildEnvironment, type ResolvedCredentials } from './secrets';
import { quoteOne } from './shell';

/**
 * The clone URL with the credential spliced in, as a shell fragment.
 *
 * This is the one place a shell expansion is wanted rather than escaped: the
 * token must be expanded BY the shell, because that is how it reaches git
 * without appearing in an argument list a process listing would show (FR-083).
 * So the fragment is three words a shell concatenates into one — a quoted
 * literal, the unquoted expansion, and the rest of the URL quoted. Everything
 * that came from the repository record stays inside quotes (002 FR-015).
 */
export function authenticatedRemote(cloneUrl: string): string {
  const withoutScheme = cloneUrl.replace(/^https:\/\//, '');
  return `'https://oauth2:'"$GIT_TOKEN"'@'${quoteOne(withoutScheme)}`;
}

/**
 * One fresh container per run, non-root, with the configured ceilings, the
 * workspace at /work, and never reused (FR-046, FR-047).
 */

export const WORKDIR = '/work';

/**
 * A run's resolved sandbox limits, as they arrive from the snapshot.
 *
 * Declared once and imported everywhere rather than repeated inline: the same
 * shape was written out in four places, so a change meant editing four and
 * forgetting a fifth.
 */
export interface SandboxLimits {
  image: string;
  /** Upper bounds on what a run may consume, never minimums (002 FR-009). */
  cpu: number;
  memoryMb: number;
  /** Enforced exactly, by the host itself (002 FR-009a, FR-010). */
  wallClockMinutes: number;
  networkDuringImplement: boolean;
}

export interface StartInput {
  snapshot: PipelineSnapshot;
  credentials: ResolvedCredentials;
  sandbox: SandboxLimits;
}

export async function startRunWorkspace(
  host: ContainerHost,
  input: StartInput,
): Promise<{ containerId: string }> {
  // Throws before a container exists when a design step has no credential (FR-083b).
  const env = buildEnvironment(input.snapshot, input.credentials);

  const spec: ContainerSpec = {
    image: input.sandbox.image,
    cpu: input.sandbox.cpu,
    memoryMb: input.sandbox.memoryMb,
    wallClockMinutes: input.sandbox.wallClockMinutes,
    network: input.sandbox.networkDuringImplement,
    env,
    workdir: WORKDIR,
  };

  // Collected BEFORE the container exists, so an application that cannot be
  // reached fails the start rather than leaving a sandbox running with no
  // brief in it. The call does nothing at all when the ticket has no
  // documents, which is the ordinary case.
  const requirements = await fetchRequirementFiles(input.snapshot);

  const containerId = await host.create(spec);
  try {
    await cloneRepository(host, containerId, input.snapshot, input.credentials.gitToken);
    await writeAgentConfig(host, containerId, WORKDIR, {
      snapshot: input.snapshot,
      requirementFiles: requirements.map((file) => file.name),
    });
    await writeRequirementFiles(host, containerId, WORKDIR, requirements);
    return { containerId };
  } catch (error) {
    // Never leave a half-prepared sandbox behind.
    await host.destroy(containerId).catch(() => {});
    throw error;
  }
}

/**
 * T072 — clone at the repository's CURRENT default branch, then check out the
 * run branch (FR-048). The credential reaches git through the environment and
 * an askpass helper, so it is never written into the workspace (FR-083).
 */
export async function cloneRepository(
  host: ContainerHost,
  containerId: string,
  snapshot: PipelineSnapshot,
  gitToken: string,
): Promise<void> {
  const script = [
    `git clone --branch ${quoteOne(snapshot.repo.default_branch)} --single-branch ` +
      `${authenticatedRemote(snapshot.repo.clone_url)} .`,
    // Detach the credential from the stored remote immediately.
    `git remote set-url origin ${quoteOne(snapshot.repo.clone_url)}`,
    'git config user.name "Code Factory"',
    'git config user.email "factory@localhost"',
    `git checkout -B ${quoteOne(snapshot.repo.branch)}`,
  ].join(' && ');

  const result = await host.exec(containerId, ['sh', '-c', script], {
    cwd: WORKDIR,
    env: { GIT_TOKEN: gitToken },
  });
  if (result.exitCode !== 0) {
    const detail = result.stderr.trim();
    // A rejected credential is a credential problem, not a sandbox problem.
    const rejected = /authentication|403|401|could not read Username/i.test(detail);
    throw new FactoryError(
      rejected ? 'credential_invalid' : 'sandbox_lost',
      rejected
        ? `Could not clone ${snapshot.repo.clone_url}: the access token was rejected.`
        : `Could not clone ${snapshot.repo.clone_url}.`,
      { detail },
    );
  }
}
