import { loadRunnerConfig } from './config';
import { run } from './container/host';
import { hostFor } from './container/hosts';
import { log } from './errors';
import { handlerFor } from './router';
import { memoryStore } from './runs';

/**
 * The Runner as a long-lived daemon on a machine the team administers.
 *
 * One of two entries; `worker.ts` is the other (002 FR-001). Both serve the
 * same routes from `router.ts` and differ only in what they inject — here, a
 * container daemon and an in-process store, which is all a single process
 * that outlives its requests needs.
 *
 * This path is also the rollback. It keeps working unchanged whatever happens
 * to the managed one, which is the point of the execution host being one
 * variable (FR-025).
 */
const config = loadRunnerConfig();
// Which execution host this deployment uses, resolved once (002 FR-025). A
// deployment configured for `hosted` fails here, at startup, with a message
// naming the Worker entry — rather than by accepting a ticket and then failing
// it with something about an undefined namespace.
const host = hostFor(config.executionHost);

const fetch = handlerFor({
  config,
  host,
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

log.info('runner listening', { port: server.port, execution_host: config.executionHost });
