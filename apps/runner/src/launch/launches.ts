import { FactoryError } from '@factory/shared';
import type { ContainerHost } from '../container/host';
import { quoteOne } from '../container/shell';
import { authenticatedRemote, type SandboxLimits, WORKDIR } from '../container/start';
import { log } from '../errors';
import { DETECTION_FILES, detectStart, explainNoStart, type WorkspaceFiles } from './detect';

/**
 * A launch: a ticket's pushed branch, running in a fresh sandbox on a port
 * only this machine can reach (003 FR-001, FR-002, FR-006).
 *
 * The shape of a launch is decided by two facts about starting a project.
 * Installing can take minutes, so `beginLaunch` answers at once and the work
 * continues here while the application polls (D1). And a project that binds
 * `localhost` inside its container is unreachable from outside it however the
 * port is published, so every command this runs is told — through `HOST`,
 * `PORT` and the framework's own flags — to listen on every interface.
 *
 * Lifetime is enforced twice, on purpose. The idle sweep stops a launch nobody
 * has looked at for a while (FR-011). Underneath it, the container's own
 * `sleep <ceiling>` — the same mechanism that bounds a run — ends it whatever
 * happens to this process (FR-012). Nothing that forgets a launch can leave a
 * project running on somebody's machine.
 */

export type LaunchStatus = 'starting' | 'running' | 'failed' | 'stopped';

export interface LaunchRecord {
  id: string;
  containerId?: string;
  status: LaunchStatus;
  cloneUrl: string;
  branch: string;
  /** What actually ran, once known — detected or given. */
  command: string | null;
  port: number | null;
  /** The install step, once chosen — detected, or none. */
  installCommand: string | null;
  /** Where the command came from, for the screen to say (FR-004). */
  from: string | null;
  notes: string[];
  /** `host:port` on this machine's loopback, once listening. */
  address: string | null;
  /** Why it failed or stopped (FR-007). */
  detail: string | null;
  startedAt: number;
  lastActivityAt: number;
}

export interface LaunchStore {
  get(id: string): LaunchRecord | undefined;
  set(record: LaunchRecord): void;
  delete(id: string): void;
  all(): LaunchRecord[];
  /** Resolves when the background work for a launch has settled — for tests. */
  settled(id: string): Promise<void>;
  /** @internal */
  track(id: string, work: Promise<void>): void;
}

export function memoryLaunchStore(): LaunchStore {
  const records = new Map<string, LaunchRecord>();
  const work = new Map<string, Promise<void>>();
  return {
    get: (id) => records.get(id),
    set: (record) => {
      records.set(record.id, record);
    },
    delete: (id) => {
      records.delete(id);
      work.delete(id);
    },
    all: () => [...records.values()],
    settled: (id) => work.get(id) ?? Promise.resolve(),
    track: (id, promise) => {
      work.set(
        id,
        promise.catch(() => {}),
      );
    },
  };
}

export interface LaunchInput {
  cloneUrl: string;
  branch: string;
  gitToken: string;
  /** Set on the repository; absent means detect (FR-004, FR-005). */
  command?: string;
  port?: number;
  sandbox: SandboxLimits;
}

export interface LaunchDeps {
  host: ContainerHost;
  store: LaunchStore;
  /** Readiness probes, injectable so a test can answer for the project. */
  fetch?: (url: string, init?: RequestInit) => Promise<Response>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** How long installing may take before the launch fails. */
  installTimeoutMs?: number;
  /** How long from start until the port must answer (FR-010). */
  startTimeoutMs?: number;
  pollMs?: number;
  /** How long a launch may go unlooked-at before the sweep stops it (FR-011). */
  idleMs?: number;
  newId?: () => string;
}

const LOG = `${WORKDIR}/.factory/launch.log`;
const INSTALL_LOG = `${WORKDIR}/.factory/install.log`;
/** Written by the start script when the command exits — the crash sentinel (D4). */
const EXIT = `${WORKDIR}/.factory/launch.exit`;

export const DEFAULT_IDLE_MS = 30 * 60_000;
const DEFAULT_START_TIMEOUT_MS = 120_000;
const DEFAULT_INSTALL_TIMEOUT_MS = 10 * 60_000;
const LOG_TAIL = 40;

/**
 * Starts a launch and returns at once (D1). The clone, the install, the start
 * and the wait for the port all happen after this returns; `store.settled(id)`
 * resolves when they have, which is what a test awaits.
 */
export function beginLaunch(deps: LaunchDeps, input: LaunchInput): LaunchRecord {
  const now = deps.now ?? Date.now;
  const record: LaunchRecord = {
    id: (deps.newId ?? (() => crypto.randomUUID()))(),
    status: 'starting',
    cloneUrl: input.cloneUrl,
    branch: input.branch,
    command: input.command ?? null,
    port: input.port ?? null,
    installCommand: null,
    from: input.command ? 'set on the repository' : null,
    notes: [],
    address: null,
    detail: null,
    startedAt: now(),
    lastActivityAt: now(),
  };
  deps.store.set(record);
  deps.store.track(record.id, runLaunch(deps, record, input));
  return record;
}

async function runLaunch(deps: LaunchDeps, record: LaunchRecord, input: LaunchInput) {
  const { host } = deps;
  const fail = async (detail: string) => {
    record.status = 'failed';
    record.detail = detail;
    if (record.containerId) await host.destroy(record.containerId).catch(() => {});
    log.warn('launch failed', { launch_id: record.id, detail });
  };

  try {
    // The command is needed before the container exists, because the port it
    // will listen on has to be published at creation. When nothing was set on
    // the repository, a first container is made to read the workspace from;
    // detection needs the files, and the files need a clone.
    let command = input.command ?? null;
    let port = input.port ?? null;

    if (!command || !port) {
      const probeId = await host.create(containerSpec(input.sandbox, []));
      try {
        await cloneBranch(host, probeId, input);
        const files = await readWorkspace(host, probeId);
        const proposal = detectStart(files);
        if (!proposal) {
          await fail(
            `${explainNoStart(files)} Set a start command and port on the repository, and try again.`,
          );
          return;
        }
        command = command ?? proposal.command;
        port = port ?? proposal.port;
        record.from = input.command ? 'set on the repository' : proposal.from;
        record.notes = proposal.notes;
        if (proposal.install) record.notes = [...record.notes];
        record.command = command;
        record.port = port;
        record.installCommand = proposal.install ?? null;
      } finally {
        await host.destroy(probeId).catch(() => {});
      }
    } else {
      record.command = command;
      record.port = port;
    }

    // Now the real one, with the port published (FR-006).
    const containerId = await host.create(containerSpec(input.sandbox, [port]));
    record.containerId = containerId;
    await cloneBranch(host, containerId, input);

    // Install, synchronously but bounded: its output is the first thing a
    // person needs when a launch fails, so it goes to a file that is read
    // back on failure and on every look while starting (FR-008).
    const install = record.installCommand ?? (await installCommandFor(host, containerId));
    if (install) {
      const installed = await host.exec(
        containerId,
        ['sh', '-c', `mkdir -p .factory && ${install} > ${quoteOne(INSTALL_LOG)} 2>&1`],
        { cwd: WORKDIR, timeoutMs: deps.installTimeoutMs ?? DEFAULT_INSTALL_TIMEOUT_MS },
      );
      if (installed.exitCode !== 0) {
        const output = await tail(host, containerId, INSTALL_LOG);
        await fail(`Installing dependencies failed (\`${install}\`).\n${output.join('\n')}`.trim());
        return;
      }
    }

    // Detached (D1): the exec returns when the wrapper shell does, and the
    // project keeps running as a child of the container's own `sleep`. The
    // exit code lands in a file the readiness loop watches, so a crash on
    // boot is a fast failure rather than a two-minute wait (D4, FR-009).
    const started = await host.exec(
      containerId,
      [
        'sh',
        '-c',
        `mkdir -p .factory && rm -f ${quoteOne(EXIT)} && ` +
          `( nohup sh -c ${quoteOne(command)} >> ${quoteOne(LOG)} 2>&1; echo $? > ${quoteOne(EXIT)} ) ` +
          '> /dev/null 2>&1 &',
      ],
      { cwd: WORKDIR, env: { PORT: String(port), HOST: '0.0.0.0' }, timeoutMs: 15_000 },
    );
    if (started.exitCode !== 0) {
      await fail(`The start command could not be launched.\n${started.stderr}`.trim());
      return;
    }

    const address = await host.address(containerId, port);
    if (!address) {
      await fail(`The container did not publish port ${port}, so nothing can reach it.`);
      return;
    }

    const listening = await waitUntilListening(deps, containerId, address, port);
    if (!listening.ok) {
      await fail(listening.reason);
      return;
    }

    record.address = address;
    record.status = 'running';
    record.lastActivityAt = (deps.now ?? Date.now)();
    log.info('launch running', { launch_id: record.id, address, command });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await fail(message);
  }
}

/** The spec a launch's sandbox is created with — the run's ceilings, network on. */
function containerSpec(sandbox: SandboxLimits, publish: number[]) {
  return {
    image: sandbox.image,
    cpu: sandbox.cpu,
    memoryMb: sandbox.memoryMb,
    wallClockMinutes: sandbox.wallClockMinutes,
    // A project installs dependencies and serves requests; a launch with no
    // network is a launch that cannot start.
    network: true,
    env: {},
    workdir: WORKDIR,
    publish,
  };
}

/**
 * The branch, cloned the way a run clones it: the credential through the
 * environment and detached from the stored remote at once (FR-017).
 */
async function cloneBranch(host: ContainerHost, containerId: string, input: LaunchInput) {
  const script = [
    `git clone --branch ${quoteOne(input.branch)} --single-branch --depth 1 ` +
      `${authenticatedRemote(input.cloneUrl)} .`,
    `git remote set-url origin ${quoteOne(input.cloneUrl)}`,
  ].join(' && ');
  const result = await host.exec(containerId, ['sh', '-c', script], {
    cwd: WORKDIR,
    env: { GIT_TOKEN: input.gitToken },
    timeoutMs: 120_000,
  });
  if (result.exitCode !== 0) {
    const detail = result.stderr.trim();
    const rejected = /authentication|403|401|could not read Username/i.test(detail);
    const missing = /Remote branch .* not found|couldn't find remote ref/i.test(detail);
    throw new FactoryError(
      rejected ? 'credential_invalid' : 'sandbox_lost',
      rejected
        ? `Could not clone ${input.cloneUrl}: the access token was rejected.`
        : missing
          ? `The branch ${input.branch} is not on ${input.cloneUrl}. Was the run's push refused?`
          : `Could not clone ${input.branch} from ${input.cloneUrl}.`,
      { detail },
    );
  }
}

async function readWorkspace(host: ContainerHost, containerId: string): Promise<WorkspaceFiles> {
  const files: WorkspaceFiles = {};
  for (const path of DETECTION_FILES) {
    files[path] = await host.readFile(containerId, `${WORKDIR}/${path}`);
  }
  return files;
}

/** The install a repository-set command still needs, decided from the lockfile. */
async function installCommandFor(host: ContainerHost, containerId: string): Promise<string | null> {
  const files = await readWorkspace(host, containerId);
  if (!files['package.json']) return null;
  return files['package-lock.json'] ? 'npm ci' : 'npm install';
}

/**
 * The last lines of a file in the sandbox. A missing file is no output; a
 * missing sandbox is let through, because the caller reads that as "the
 * lifetime ceiling was reached" (FR-012).
 */
async function tail(host: ContainerHost, containerId: string, path: string): Promise<string[]> {
  const text = await host.readFile(containerId, path).catch((error: unknown) => {
    if (error instanceof FactoryError && error.reason === 'sandbox_lost') throw error;
    return null;
  });
  if (!text) return [];
  return text.replace(/\n+$/, '').split('\n').slice(-LOG_TAIL);
}

/**
 * Waits for the port to answer — any HTTP status counts as listening — or for
 * the command to have exited, whichever comes first (FR-009, FR-010).
 */
async function waitUntilListening(
  deps: LaunchDeps,
  containerId: string,
  address: string,
  port: number,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const doFetch = deps.fetch ?? fetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const now = deps.now ?? Date.now;
  const deadline = now() + (deps.startTimeoutMs ?? DEFAULT_START_TIMEOUT_MS);
  const poll = deps.pollMs ?? 1000;

  while (now() < deadline) {
    const exited = await deps.host.stat(containerId, EXIT).catch(() => null);
    if (exited) {
      const output = await tail(deps.host, containerId, LOG);
      const code = (await deps.host.readFile(containerId, EXIT).catch(() => ''))?.trim();
      return {
        ok: false,
        reason:
          `The project exited${code ? ` with code ${code}` : ''} before it started listening.\n` +
          output.join('\n'),
      };
    }
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.min(poll * 2, 5000));
      await doFetch(`http://${address}/`, { method: 'GET', signal: controller.signal });
      clearTimeout(timer);
      return { ok: true };
    } catch {
      // Not listening yet.
    }
    await sleep(poll);
  }
  const output = await tail(deps.host, containerId, LOG);
  return {
    ok: false,
    reason:
      `Nothing answered on port ${port} within ${Math.round((deps.startTimeoutMs ?? DEFAULT_START_TIMEOUT_MS) / 1000)} seconds. ` +
      'If the server is up, it is probably listening on localhost instead of 0.0.0.0.\n' +
      output.join('\n'),
  };
}

/**
 * The record and the latest output, and a note that somebody looked (FR-011).
 *
 * A running launch whose container has gone — the lifetime ceiling, most
 * likely — is reported as stopped with that reason rather than as running at
 * an address that no longer answers (FR-012).
 */
export async function lookAtLaunch(
  deps: LaunchDeps,
  id: string,
): Promise<(LaunchRecord & { log: string[] }) | undefined> {
  const record = deps.store.get(id);
  if (!record) return undefined;
  record.lastActivityAt = (deps.now ?? Date.now)();

  let output: string[] = [];
  if (record.containerId && (record.status === 'starting' || record.status === 'running')) {
    try {
      output = await tail(deps.host, record.containerId, LOG);
      if (output.length === 0) output = await tail(deps.host, record.containerId, INSTALL_LOG);
    } catch (error) {
      if (error instanceof FactoryError && error.reason === 'sandbox_lost') {
        record.status = 'stopped';
        record.address = null;
        record.detail = 'The sandbox reached its lifetime ceiling and was removed.';
      }
    }
  }
  return { ...record, log: output };
}

/** Destroys the container and marks the launch stopped (FR-002). */
export async function stopLaunch(
  deps: LaunchDeps,
  id: string,
  reason = 'Stopped.',
): Promise<{ stopped: boolean }> {
  const record = deps.store.get(id);
  if (!record || record.status === 'stopped' || record.status === 'failed') {
    return { stopped: false };
  }
  if (record.containerId) await deps.host.destroy(record.containerId).catch(() => {});
  record.status = 'stopped';
  record.address = null;
  record.detail = reason;
  log.info('launch stopped', { launch_id: id, reason });
  return { stopped: true };
}

/**
 * Stops every launch nobody has looked at for the idle period (FR-011), and
 * forgets launches that ended a while ago so the store does not grow for ever.
 */
export async function sweepLaunches(deps: LaunchDeps): Promise<string[]> {
  const now = (deps.now ?? Date.now)();
  const idle = deps.idleMs ?? DEFAULT_IDLE_MS;
  const swept: string[] = [];
  for (const record of deps.store.all()) {
    const quiet = now - record.lastActivityAt;
    if ((record.status === 'running' || record.status === 'starting') && quiet > idle) {
      await stopLaunch(deps, record.id, 'Stopped after 30 minutes with nobody looking at it.');
      swept.push(record.id);
    } else if ((record.status === 'stopped' || record.status === 'failed') && quiet > idle * 4) {
      deps.store.delete(record.id);
    }
  }
  return swept;
}
