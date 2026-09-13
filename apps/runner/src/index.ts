import { loadRunnerConfig } from './config';
import { dockerHost, run } from './container/host';
import { log } from './errors';
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

const fetch = handlerFor({
  config,
  host: dockerHost,
  store: memoryStore(),
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

log.info('runner listening', { port: server.port });
