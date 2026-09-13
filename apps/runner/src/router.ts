import { FactoryError } from '@factory/shared';
import { authenticate } from './auth';
import type { RunnerConfig } from './config';
import type { ContainerHost } from './container/host';
import { log, toResponse } from './errors';
import {
  callbackSender,
  destroyRun,
  fetchCredentials,
  liveRun,
  type RunContext,
  type RunStore,
  runStep,
  type StepRequest,
  startRun,
  verifyAndPush,
} from './runs';

/**
 * The four operations in contracts/runner.md as routes.
 *
 * Kept apart from `index.ts` so the routing can be driven without a server:
 * `handlerFor` is given the container host and the run store rather than
 * reaching for them, which is how every test exercises the same table against
 * `tests/fake-host.ts` and an in-memory store.
 */

export interface RouterDeps {
  config: RunnerConfig;
  host: ContainerHost;
  store: RunStore;
  /**
   * Whether the execution host is answering, and what to say about it.
   *
   * Injected because the probe is the one thing that cannot be shared: asking a
   * daemon for its version and asking a managed service for a sandbox are
   * different questions with different failure modes (FR-020, T030).
   */
  probeHost: () => Promise<{ reachable: boolean; detail: string }>;
}

interface Route {
  method: string;
  pattern: RegExp;
  handle: (match: RegExpMatchArray, request: Request) => Promise<Response>;
}

export function routesFor(deps: RouterDeps): Route[] {
  const { config, host, store, probeHost } = deps;
  return [
    {
      method: 'POST',
      pattern: /^\/runs\/([^/]+)\/start$/,
      async handle(match, request) {
        const runId = match[1] as string;
        const body = (await request.json()) as {
          snapshot?: RunContext['snapshot'];
        } & Partial<RunContext>;
        if (!body.snapshot) throw new FactoryError('invalid_input', 'expected a snapshot');

        // A run already started keeps the sandbox it has (FR-008). Answering
        // with the existing sandbox rather than refusing makes the call
        // idempotent, which is what a retrying caller needs.
        const existing = await store.get(runId);
        if (existing?.containerId) {
          log.info('start called again for a run that already has a sandbox', {
            run_id: runId,
            container_id: existing.containerId,
          });
          return Response.json({ container_id: existing.containerId });
        }

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

        const state = await requireRun(store, runId);
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
        const runId = match[1] as string;
        await requireRun(store, runId);
        const outcome = await verifyAndPush(host, store, runId);
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
        // A Runner that cannot reach its execution host is useless, and that
        // is worth saying here rather than at the first run.
        const probe = await probeHost();
        return Response.json(
          {
            status: probe.reachable ? 'ok' : 'degraded',
            service: 'runner',
            container_host: probe.reachable ? 'reachable' : 'unreachable',
            detail: probe.detail,
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
            outcome === 'failed' || outcome === 'cancelled' || outcome === 'done'
              ? outcome
              : 'done',
          retainFailedHours: Number(url.searchParams.get('retain_failed_hours') ?? '0') || 0,
        });
        return Response.json(result);
      },
    },
  ];
}

/**
 * The record a step or a push needs, or a refusal.
 *
 * `liveRun` refuses when there is no record, or the record's run has finished,
 * and says nothing about whether the run exists (FR-007, FR-019).
 */
async function requireRun(store: RunStore, runId: string) {
  return liveRun(store, runId);
}

/**
 * One request, authenticated, routed, and with every failure turned into the
 * error shape `contracts/runner.md` specifies.
 */
export function handlerFor(deps: RouterDeps): (request: Request) => Promise<Response> {
  const routes = routesFor(deps);
  return async (request) => {
    const url = new URL(request.url);
    try {
      // Unauthenticated: liveness only, revealing nothing about any run.
      if (url.pathname === '/health' && request.method === 'GET') {
        return Response.json({ status: 'ok', service: 'runner' });
      }
      authenticate(request, deps.config.authToken, deps.config.previousAuthToken);

      for (const route of routes) {
        if (route.method !== request.method) continue;
        const match = url.pathname.match(route.pattern);
        if (match) return await route.handle(match, request);
      }
      return Response.json({ error: 'not found' }, { status: 404 });
    } catch (error) {
      return toResponse(error);
    }
  };
}
