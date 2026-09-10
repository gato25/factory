import { FactoryError, type PipelineSnapshot } from '@factory/shared';
import { writeAgentConfig } from './config';
import type { ContainerHost, ContainerSpec } from './host';
import { buildEnvironment, type ResolvedCredentials } from './secrets';

/**
 * One fresh container per run, non-root, with the configured ceilings, the
 * workspace at /work, and never reused (FR-046, FR-047).
 */

export const WORKDIR = '/work';

export interface StartInput {
  snapshot: PipelineSnapshot;
  credentials: ResolvedCredentials;
  sandbox: {
    image: string;
    cpu: number;
    memoryMb: number;
    wallClockMinutes: number;
    networkDuringImplement: boolean;
  };
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

  const containerId = await host.create(spec);
  try {
    await cloneRepository(host, containerId, input.snapshot, input.credentials.gitToken);
    await writeAgentConfig(host, containerId, WORKDIR, { snapshot: input.snapshot });
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
  const authenticated = snapshot.repo.clone_url.replace(
    /^https:\/\//,
    `https://oauth2:$\{GIT_TOKEN}@`,
  );
  const script = [
    `git clone --branch '${snapshot.repo.default_branch}' --single-branch "${authenticated}" .`,
    // Detach the credential from the stored remote immediately.
    `git remote set-url origin '${snapshot.repo.clone_url}'`,
    'git config user.name "Code Factory"',
    'git config user.email "factory@localhost"',
    `git checkout -B '${snapshot.repo.branch}'`,
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
