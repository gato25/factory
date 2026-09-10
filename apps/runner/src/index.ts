import { authenticate } from './auth';
import { loadRunnerConfig } from './config';
import { log, toResponse } from './errors';

/**
 * The Runner is the only component with rights on the container host
 * (research.md D5). It is never reachable from the public internet and
 * authenticates every call per run (contracts/runner.md).
 */
const config = loadRunnerConfig();

const server = Bun.serve({
  port: config.port,
  fetch(request) {
    const url = new URL(request.url);
    try {
      // Unauthenticated: liveness only, revealing nothing about any run.
      if (url.pathname === '/health' && request.method === 'GET') {
        return Response.json({ status: 'ok', service: 'runner' });
      }
      authenticate(request, config.authToken);
      // Run lifecycle endpoints arrive with user story 1 (T066–T077).
      return Response.json({ error: 'not found' }, { status: 404 });
    } catch (error) {
      return toResponse(error);
    }
  },
});

log.info('runner listening', { port: server.port });
