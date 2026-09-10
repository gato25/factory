import { loadRunnerConfig } from './config';

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
    if (url.pathname === '/health' && request.method === 'GET') {
      return Response.json({ status: 'ok', service: 'runner' });
    }
    return new Response('Not found', { status: 404 });
  },
});

console.log(`runner listening on :${server.port}`);
