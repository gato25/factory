import { join } from 'node:path';
import { loadRunnerConfig } from './config';
import { type ContainerHost, dockerHost, run } from './container/host';
import { currentUser, isolatingHost, uidWarning } from './container/isolate';
import { configureLabels, runnerIdentityFor } from './container/labels';
import { processHost } from './container/process-host';
import { reapForgottenLaunches, reapStoppedContainers } from './container/reap';
import { watchContainerHost } from './container/watch';
import { log } from './errors';
import { DEFAULT_IDLE_MS, memoryLaunchStore, sweepLaunches } from './launch/launches';
import { acquireInstanceLock, assertWritable } from './orchestrate/lock';
import { Orchestrator } from './orchestrate/loop';
import { fileStateStore } from './orchestrate/state';
import { handlerFor } from './router';
import { fileRunStore } from './run-records';

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

// Before anything else: that every run's position CAN be written down, and
// that nothing else is writing there (`lock.ts`). Both fail the start with a
// sentence naming the cause, rather than failing the first run with one
// that does not.
await assertWritable(config.stateDir);
const lock = await acquireInstanceLock(config.stateDir);

// Every container this service makes says which runner made it, so a sweep
// on a daemon two runners share removes only this one's (`labels.ts`).
const runnerIdentity = runnerIdentityFor(config.stateDir);
configureLabels({ runner: runnerIdentity });

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

// An isolated step runs as an unprivileged user over a workspace this
// service made; where this service is root, the two cannot be the same
// person and the step's writes fail (`isolate.ts`, `stepUser`).
const uidProblem =
  config.executionHost === 'process' && isolation === null ? uidWarning(currentUser()) : null;
if (uidProblem) {
  log.warn('isolated steps will not be able to write their workspace', { detail: uidProblem });
}

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

/**
 * Docker, asked again and again rather than once (see `watch.ts`).
 *
 * Under `docker` the daemon is what every run lives in; under `process` it is
 * what the steps that run commands, and the Run it card, get their container
 * from. Either way a daemon that stops answering an hour after startup is
 * worth one line in the log at the moment it happens, and one when it is
 * back — and the loop, asked whether a lost sandbox was the daemon's doing,
 * needs a current answer rather than the one from startup. Not started under
 * `process` on a machine that had no Docker to begin with: that machine was
 * told so at startup, and a probe every half minute would tell it nothing new.
 */
const dockerWatch = watchContainerHost({
  probe: probeDocker,
  intervalMs: 30_000,
  consequence:
    config.executionHost === 'docker'
      ? 'no sandbox can be created or reached until it answers; a run that loses its sandbox meanwhile waits for it'
      : 'steps that run commands, and the Run it card, cannot have a container until it answers',
});
const watchingDocker = config.executionHost === 'docker' || isolation === null;
if (watchingDocker) {
  void dockerWatch.check();
  dockerWatch.start();
}

// Run records on disk beside the state files, so a sandbox kept for
// diagnosis is still this service's to release after a restart (FR-023).
// Credentials stay in memory (`run-records.ts`).
const store = fileRunStore(join(config.stateDir, 'runs'));
const launches = memoryLaunchStore();
const orchestrator = new Orchestrator({
  host,
  store,
  states: fileStateStore(config.stateDir),
  publicBaseUrl: config.publicBaseUrl,
  // Under `docker` a lost sandbox may be the daemon's fault, and the run
  // waits for the daemon. A directory on this machine has no daemon to wait
  // for, so the process host offers no probe.
  ...(config.executionHost === 'docker' ? { probeHost: () => dockerWatch.check() } : {}),
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

// Launches live in memory, so this process knows none from before it
// started; the containers it made for them are running for nobody. Removed
// — this runner's only, and launches only (`reap.ts`).
if (watchingDocker) {
  void reapForgottenLaunches({
    runner: runnerIdentity,
    known: new Set(launches.all().map((launch) => launch.id)),
  }).catch((error) =>
    log.warn('could not sweep forgotten launches', {
      detail: error instanceof Error ? error.message : String(error),
    }),
  );
}

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

// Containers this service made that have stopped and that nothing is going
// to release — left by a crash, or by a version of this service that made
// sandboxes without `--rm` — are removed (see `reap.ts`). Once now, for what
// the last process left, and then every ten minutes; a stopped container
// costs disk, not money, so ten minutes is soon enough.
if (watchingDocker) {
  const reap = () =>
    reapStoppedContainers().catch((error) =>
      log.warn('the sandbox sweep failed', {
        detail: error instanceof Error ? error.message : String(error),
      }),
    );
  void reap();
  setInterval(() => void reap(), 10 * 60_000);
}

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

/**
 * Ending on a signal, in order: nothing further begins and the agents still
 * working are stopped (`Orchestrator.shutdown`), the watch and the lock go,
 * the server closes, and the process exits 0 — so a supervisor reads a
 * clean stop, not a crash. A second signal during this exits at once.
 */
let stopping = false;
async function shutdown(signal: string): Promise<void> {
  if (stopping) {
    log.warn('a second signal during shutdown; exiting at once', { signal });
    process.exit(130);
  }
  stopping = true;
  log.info('shutting down', { signal, runs_in_flight: 'stopping their agents first' });
  try {
    const { inFlight, quiesced } = await orchestrator.shutdown();
    log.info('shutdown: runs left where a restart picks them up', {
      in_flight: inFlight,
      agents_stopped_in: quiesced,
    });
  } catch (error) {
    log.error('shutdown did not complete cleanly', {
      detail: error instanceof Error ? error.message : String(error),
    });
  }
  dockerWatch.stop();
  await lock.release().catch(() => {});
  server.stop(true);
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
