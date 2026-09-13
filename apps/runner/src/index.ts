import { loadRunnerConfig } from './config';
import { dockerHost, run } from './container/host';
import { log } from './errors';
import { DEFAULT_IDLE_MS, memoryLaunchStore, sweepLaunches } from './launch/launches';
import { handlerFor } from './router';
import { memoryStore } from './runs';

/**
 * The Runner: a long-lived daemon on a machine the team administers, driving
 * one fresh Docker container per run.
 *
 * Everything it does goes through `router.ts`, which is given the container
 * host and the run store rather than reaching for them — that is what lets
 * every test drive the same routes against `tests/fake-host.ts` with no daemon
 * running.
 */
const config = loadRunnerConfig();

const launches = memoryLaunchStore();

const fetch = handlerFor({
  config,
  host: dockerHost,
  store: memoryStore(),
  launches,
  async probeHost() {
    const probe = await run('docker', ['version', '--format', '{{.Server.Version}}'], {
      timeoutMs: 4000,
    });
    const reachable = probe.exitCode === 0;
    return {
      reachable,
      detail: reachable
        ? `docker ${probe.stdout.trim()}`
        : 'the container host is not answering, so no run can start',
    };
  },
});

const server = Bun.serve({ port: config.port, fetch });

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

log.info('runner listening', { port: server.port });
