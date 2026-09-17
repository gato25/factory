import { FactoryError, type PipelineSnapshot } from '@factory/shared';
import { log } from '../errors';
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

/**
 * Steps that reach the model API, which they do from inside the sandbox.
 *
 * A shell step runs a command and needs nothing outside the container. An
 * agent or design step is a CLI that talks to Anthropic over the network —
 * the network is not an incidental convenience for it, it is the whole of
 * what the step does.
 */
const NEEDS_THE_MODEL = new Set(['agent', 'design']);

export async function startRunWorkspace(
  host: ContainerHost,
  input: StartInput,
): Promise<{ containerId: string }> {
  /**
   * Refused here rather than discovered three minutes later.
   *
   * `networkDuringImplement: false` isolates the sandbox, and the agent runs
   * INSIDE that sandbox: with no network it cannot reach the model at all. It
   * does not fail quickly either — the CLI sits there until it times out and
   * reports `Request timed out` with zero tokens and zero cost, which reads
   * as a model problem or a slow step rather than as a setting.
   *
   * The setting's own explanation had it backwards — "an agent writing code
   * does not need the internet" — when an agent writing code is an outbound
   * API call and nothing else. Narrowing the reach to just that call is not
   * available: an agent step runs arbitrary code that opens its own sockets,
   * which is why `egress.test.ts` records the reach as all-or-nothing.
   *
   * So the combination is refused, and the message names the setting.
   */
  /**
   * On a host that cannot isolate — processes on this machine — the setting
   * is not applied and the run proceeds connected, with that said in the log.
   * Refusing instead would mean no run could start on the default settings
   * for a reason nothing on that machine could ever satisfy; and applying it
   * is not available, so pretending to would be the worse dishonesty.
   */
  const canIsolate = host.isolates !== false;
  if (!input.sandbox.networkDuringImplement && !canIsolate) {
    log.warn(
      'this workspace keeps a sandbox off the network while code is written, but runs here ' +
        'execute as processes on this machine, which cannot be cut off — the run proceeds connected',
      { run_id: input.snapshot.run_id },
    );
  }
  const isolate = !input.sandbox.networkDuringImplement && canIsolate;

  const modelSteps = input.snapshot.pipeline.steps.filter((step) => NEEDS_THE_MODEL.has(step.type));
  if (isolate && modelSteps.length > 0) {
    throw new FactoryError(
      'invalid_input',
      'This pipeline has steps that reach the model from inside the sandbox, and this ' +
        'workspace keeps the sandbox off the network. Turn on “Let a sandbox reach the ' +
        'network while code is being written” in Settings, or use a pipeline of shell ' +
        'steps only.',
      { detail: `${modelSteps.length} of ${input.snapshot.pipeline.steps.length} steps need it` },
    );
  }

  // Throws before a container exists when a design step has no credential (FR-083b).
  const env = buildEnvironment(input.snapshot, input.credentials);

  const spec: ContainerSpec = {
    image: input.sandbox.image,
    cpu: input.sandbox.cpu,
    memoryMb: input.sandbox.memoryMb,
    wallClockMinutes: input.sandbox.wallClockMinutes,
    network: !isolate,
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
    // The clone is the one thing a sandbox needs the network for, and it has
    // just happened. FR-085's restriction is about the rest of the sandbox's
    // life, so it is applied here rather than at creation — where it stopped
    // the clone instead of the agent.
    //
    // Inside the `try`: a restriction that could not be applied is a failed
    // start, and the sandbox is destroyed below. Carrying on would leave an
    // agent writing code in a container with the internet, in a workspace
    // that had asked for the opposite.
    if (isolate) await host.disconnectNetwork(containerId);
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
