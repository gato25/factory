import { FactoryError } from '@factory/shared';
import { authenticate } from './auth';
import { loadRunnerConfig } from './config';
import { run } from './container/host';
import { hostFor } from './container/hosts';
import { log, toResponse } from './errors';
import {
  callbackSender,
  destroyRun,
  fetchCredentials,
  memoryStore,
  type RunContext,
  runStep,
  type StepRequest,
  startRun,
  verifyAndPush,
} from './runs';

/**
 * The Runner is the only component with rights on the container host
 * (research.md D5). It exposes the four operations in contracts/runner.md, is
 * never reachable from the public internet, and authenticates every call.
 *
 * The routing is thin on purpose: everything below it is in runs.ts, where it
 * can be driven by a test without a server.
 */
const config = loadRunnerConfig();
const store = memoryStore();
// Which execution host this deployment uses, resolved once (002 FR-025). A
// deployment configured for a host that cannot be built fails here, at
// startup, rather than by accepting a ticket and then failing it.
const host = hostFor(config.executionHost);

interface Route {
  method: string;
  pattern: RegExp;
  handle: (match: RegExpMatchArray, request: Request) => Promise<Response>;
}

const routes: Route[] = [
  {
    method: 'POST',
    pattern: /^\/runs\/([^/]+)\/start$/,
    async handle(match, request) {
      const runId = match[1] as string;
      const body = (await request.json()) as {
        snapshot?: RunContext['snapshot'];
      } & Partial<RunContext>;
      if (!body.snapshot) throw new FactoryError('invalid_input', 'expected a snapshot');
      // The snapshot carries credential REFERENCES; the values come from the
      // app, so the orchestration service never holds one (FR-083).
      const credentials = body.credentials ?? (await fetchCredentials(body.snapshot));

      // The snapshot's own limits, which is where an administrator's
      // settings reach a run (FR-085). Compiled-in figures are a last
      // resort for a snapshot written before this field existed — used
      // silently, they meant nothing anybody configured had any effect.
      const limits = body.snapshot.sandbox;
      const result = await startRun(host, store, {
        snapshot: body.snapshot,
        credentials,
        sandbox: body.sandbox ?? {
          image: limits?.image || config.sandboxImage,
          cpu: limits?.cpu ?? 2,
          memoryMb: limits?.memory_mb ?? 4096,
          wallClockMinutes: limits?.wall_clock_minutes ?? 90,
          networkDuringImplement: limits?.network_during_implement ?? false,
        },
      });
      if (!limits) {
        log.warn('the snapshot carries no sandbox limits, so defaults were used', {
          run_id: runId,
        });
      }
      log.info('sandbox created', { run_id: runId, container_id: result.container_id });
      return Response.json(result);
    },
  },
  {
    method: 'POST',
    pattern: /^\/runs\/([^/]+)\/steps\/(\d+)$/,
    async handle(match, request) {
      const runId = match[1] as string;
      const stepIndex = Number(match[2]);
      const body = (await request.json()) as StepRequest;
      if (!body?.step) throw new FactoryError('invalid_input', 'expected a step');

      const state = await store.get(runId);
      if (!state) throw new FactoryError('not_found', 'that run has no sandbox — start it first');

      const outcome = await runStep(
        host,
        store,
        runId,
        stepIndex,
        body,
        callbackSender(state.snapshot),
      );
      return Response.json(outcome);
    },
  },
  {
    method: 'POST',
    pattern: /^\/runs\/([^/]+)\/verify-and-push$/,
    async handle(match) {
      const outcome = await verifyAndPush(host, store, match[1] as string);
      return Response.json(outcome);
    },
  },
  {
    // Readiness, behind authentication on purpose. `/health` answers
    // liveness to anyone, which means it can never tell a good credential
    // from a bad one — an operator with the wrong token was being told the
    // Runner "accepted our credential" (FR-005a). This route is the one the
    // settings screen probes, so a wrong token comes back 401.
    method: 'GET',
    pattern: /^\/ready$/,
    async handle() {
      // A Runner that cannot reach its container host is useless, and that
      // is worth saying here rather than at the first run.
      const probe = await run('docker', ['version', '--format', '{{.Server.Version}}'], {
        timeoutMs: 4000,
      });
      const reachable = probe.exitCode === 0;
      return Response.json(
        {
          status: reachable ? 'ok' : 'degraded',
          service: 'runner',
          container_host: reachable ? 'reachable' : 'unreachable',
          detail: reachable
            ? `docker ${probe.stdout.trim()}`
            : 'the container host is not answering, so no run can start',
        },
        // Not a 5xx: the Runner itself is answering, and the credential was
        // accepted. Saying otherwise would hide which of the two is wrong.
        { status: 200 },
      );
    },
  },
  {
    method: 'DELETE',
    pattern: /^\/runs\/([^/]+)$/,
    async handle(match, request) {
      const url = new URL(request.url);
      const outcome = url.searchParams.get('outcome');
      const result = await destroyRun(host, store, match[1] as string, {
        outcome:
          outcome === 'failed' || outcome === 'cancelled' || outcome === 'done' ? outcome : 'done',
        retainFailedHours: Number(url.searchParams.get('retain_failed_hours') ?? '0') || 0,
      });
      return Response.json(result);
    },
  },
];

const server = Bun.serve({
  port: config.port,
  async fetch(request) {
    const url = new URL(request.url);
    try {
      // Unauthenticated: liveness only, revealing nothing about any run.
      if (url.pathname === '/health' && request.method === 'GET') {
        return Response.json({ status: 'ok', service: 'runner' });
      }
      authenticate(request, config.authToken);

      for (const route of routes) {
        if (route.method !== request.method) continue;
        const match = url.pathname.match(route.pattern);
        if (match) return await route.handle(match, request);
      }
      return Response.json({ error: 'not found' }, { status: 404 });
    } catch (error) {
      return toResponse(error);
    }
  },
});

log.info('runner listening', { port: server.port });
