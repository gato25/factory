import { loadRunnerConfig } from './config';
import { type ContainerHost, dockerHost, run } from './container/host';
import { isolatingHost } from './container/isolate';
import { processHost } from './container/process-host';
import { log } from './errors';
import { DEFAULT_IDLE_MS, memoryLaunchStore, sweepLaunches } from './launch/launches';
import { Orchestrator } from './orchestrate/loop';
import { fileStateStore } from './orchestrate/state';
import { handlerFor } from './router';
import { memoryStore } from './runs';

/**
 * The Runner: a long-lived daemon on a machine the team administers. It
 * executes every step of a run — as processes on this machine by default, as
 * Docker containers when `EXECUTION_HOST=docker` — and it drives the run
 * from its snapshot to its merge request, writing each run's position to
 * disk so a restart resumes rather than loses it.
 *
 * Everything it does goes through `router.ts`, which is given the execution
 * host and the stores rather than reaching for them — that is what lets
 * every test drive the same routes against `tests/fake-host.ts` with no
 * daemon running.
 */
const config = loadRunnerConfig();

/**
 * Why a run on this machine can still have a container.
 *
 * `EXECUTION_HOST=docker` puts the whole run in one, which is what a
 * deployment does. `process` puts none of it in one, which is fast and is
 * what a developer wants for the steps that only read files and write
 * Markdown — and is how an agent stopping its own dev server stopped the
 * runner. So `process` now means: the workspace is a directory here, and the
 * steps whose agents may run commands execute in a throwaway container over
 * it. Docker absent, or its image unbuilt, and the runner says which steps
 * are unprotected rather than failing to start.
 */
async function isolationProblem(image: string): Promise<string | null> {
  const daemon = await run('docker', ['version', '--format', '{{.Server.Version}}'], {
    timeoutMs: 8000,
  }).catch(() => ({ exitCode: 1, stdout: '', stderr: 'docker is not installed' }));
  if (daemon.exitCode !== 0) return 'docker is not answering';
  const built = await run('docker', ['image', 'inspect', image], { timeoutMs: 8000 }).catch(() => ({
    exitCode: 1,
    stdout: '',
    stderr: '',
  }));
  return built.exitCode === 0
    ? null
    : `the sandbox image ${image} is not built — docker build -t ${image} infra/sandbox`;
}

const base = processHost({ root: config.workDir });
const isolation =
  config.executionHost === 'docker' ? null : await isolationProblem(config.sandboxImage);
if (isolation) {
  log.warn('steps that may run commands will NOT be isolated', {
    detail: isolation,
    consequence: 'a command from an agent reaches this machine, not a container',
  });
}

const host: ContainerHost =
  config.executionHost === 'docker'
    ? dockerHost
    : isolation === null
      ? isolatingHost({ base, image: config.sandboxImage })
      : base;

/** Whether Docker is answering, and which version. */
async function probeDocker(): Promise<{ reachable: boolean; detail: string }> {
  const probe = await run('docker', ['version', '--format', '{{.Server.Version}}'], {
    timeoutMs: 4000,
  }).catch(() => ({ exitCode: 1, stdout: '', stderr: 'docker is not installed' }));
  const reachable = probe.exitCode === 0;
  return {
    reachable,
    detail: reachable
      ? `docker ${probe.stdout.trim()}`
      : 'the container host is not answering, so no run can start',
  };
}

/**
 * Whether this machine has what a step runs — git and the Claude CLI — asked
 * through the same shell a step would use, so a tool the shell cannot find is
 * reported here rather than at the first step.
 */
async function probeTools(): Promise<{ reachable: boolean; detail: string }> {
  const found = await Promise.all(
    ['git', 'claude'].map(async (tool) => {
      const probe = await run('sh', ['-c', `${tool} --version`], { timeoutMs: 15_000 }).catch(
        () => ({ exitCode: 1, stdout: '', stderr: '' }),
      );
      return probe.exitCode === 0 ? (probe.stdout.trim().split('\n')[0] ?? tool) : null;
    }),
  );
  const missing = ['git', 'claude'].filter((_tool, index) => !found[index]);
  return missing.length === 0
    ? {
        reachable: true,
        detail: `${found.join('; ')}; runs execute as processes under ${config.workDir}`,
      }
    : {
        reachable: false,
        detail: `not found on this machine: ${missing.join(', ')} — install it, or set EXECUTION_HOST=docker`,
      };
}

const store = memoryStore();
const launches = memoryLaunchStore();
const orchestrator = new Orchestrator({
  host,
  store,
  states: fileStateStore(config.stateDir),
  publicBaseUrl: config.publicBaseUrl,
});

const fetch = handlerFor({
  config,
  host,
  store,
  launches,
  orchestrator,
  // A launch publishes a port and needs a network namespace of its own, which
  // only a container gives (003 FR-006); so launches go to Docker whichever
  // host runs execute on. Without Docker, Run it says so on the card.
  launchHost: dockerHost,
  probeHost: config.executionHost === 'docker' ? probeDocker : probeTools,
});

const server = Bun.serve({ port: config.port, fetch });

// Runs that were in flight when this process last stopped pick up where
// they were; runs that were waiting keep waiting.
void orchestrator.recover().then(({ resumed, waiting }) => {
  if (resumed.length || waiting.length) {
    log.info('runs picked up after a restart', { resumed, waiting });
  }
});

// Launches nobody is looking at are stopped (003 FR-011). Every minute is
// often enough for a 30-minute idle period, and the container's own lifetime
// ceiling is underneath this in any case (FR-012).
setInterval(() => {
  void sweepLaunches({ host: dockerHost, store: launches, idleMs: DEFAULT_IDLE_MS }).catch(
    (error) =>
      log.warn('the launch sweep failed', {
        detail: error instanceof Error ? error.message : String(error),
      }),
  );
}, 60_000);

log.info('runner listening', {
  port: server.port,
  public_base_url: config.publicBaseUrl,
  execution_host: config.executionHost,
  state_dir: config.stateDir,
  ...(config.executionHost === 'process' ? { work_dir: config.workDir } : {}),
  // Which steps get a wall, said at startup rather than discovered from a
  // container that either did or did not appear.
  ...(config.executionHost === 'process'
    ? { isolated_steps: isolation === null ? 'agents permitted a shell' : 'none' }
    : {}),
});
