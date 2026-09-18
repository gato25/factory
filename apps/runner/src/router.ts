import { FactoryError, type ResumeRequest } from '@factory/shared';
import { authenticate } from './auth';
import type { RunnerConfig } from './config';
import type { ContainerHost } from './container/host';
import { openDesignFile } from './desktop/open';
import { log, toResponse } from './errors';
import {
  beginLaunch,
  type LaunchDeps,
  type LaunchStore,
  lookAtLaunch,
  memoryLaunchStore,
  stopLaunch,
} from './launch/launches';
import type { Orchestrator, ResumePoint } from './orchestrate/loop';
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
  /**
   * Where launches live between requests (003). Optional: a deployment that
   * never launches anything — and every existing test — need not supply one.
   */
  launches?: LaunchStore;
  /**
   * The host a launch runs on, when it is not the one runs use.
   *
   * A launch publishes a port and needs a network namespace of its own, which
   * only a container gives; so where runs execute as processes on this
   * machine, launches still go to Docker. Absent, launches use `host`.
   */
  launchHost?: ContainerHost;
  /** Tunables for the launch lifecycle, injected by tests. */
  launchDeps?: Partial<Omit<LaunchDeps, 'host' | 'store'>>;
  /**
   * The loop that drives a run from its snapshot to its merge request
   * (contracts/orchestrator.md), when this deployment orchestrates. Optional
   * so the step-level routes can still be driven on their own by tests.
   */
  orchestrator?: Orchestrator;
}

interface Route {
  method: string;
  pattern: RegExp;
  handle: (match: RegExpMatchArray, request: Request) => Promise<Response>;
}

export function routesFor(deps: RouterDeps): Route[] {
  const { config, host, store, probeHost } = deps;
  const launchDeps: LaunchDeps = {
    host: deps.launchHost ?? host,
    store: deps.launches ?? memoryLaunchStore(),
    ...deps.launchDeps,
  };
  const orchestrator = deps.orchestrator;
  return [
    // --- the whole run: accepted here, driven by the orchestrator -----------
    {
      /**
       * `POST /runs/{run_id}/execute` — the trigger (contracts/orchestrator.md
       * §1). The body is the resolved snapshot, with an optional `resume`
       * block when a person is continuing a run from where the application
       * knows it stands. Answers at once; the run proceeds on its own and
       * reports through callbacks.
       */
      method: 'POST',
      pattern: /^\/runs\/([^/]+)\/execute$/,
      async handle(match, request) {
        if (!orchestrator) {
          throw new FactoryError(
            'invalid_input',
            'this execution service does not orchestrate runs',
          );
        }
        const runId = match[1] as string;
        const body = (await request.json()) as
          | (RunContext['snapshot'] & { resume?: ResumePoint })
          | { snapshot?: RunContext['snapshot'] & { resume?: ResumePoint } };
        const snapshot =
          'snapshot' in body && body.snapshot
            ? body.snapshot
            : (body as RunContext['snapshot'] & { resume?: ResumePoint });
        if (!snapshot?.run_id || !snapshot.pipeline?.steps) {
          throw new FactoryError('invalid_input', 'expected a run snapshot');
        }
        if (snapshot.run_id !== runId) {
          throw new FactoryError('invalid_input', 'the snapshot names a different run');
        }
        const limits = snapshot.sandbox;
        const result = await orchestrator.execute({
          snapshot,
          sandbox: {
            image: limits?.image || config.sandboxImage,
            cpu: limits?.cpu ?? 2,
            memoryMb: limits?.memory_mb ?? 4096,
            wallClockMinutes: limits?.wall_clock_minutes ?? 90,
            networkDuringImplement: limits?.network_during_implement ?? false,
          },
        });
        log.info(result.accepted ? 'run accepted' : 'run not accepted', {
          run_id: runId,
          phase: result.phase,
        });
        return Response.json(
          { execution_id: runId, accepted: result.accepted, phase: result.phase },
          { status: result.accepted ? 202 : 409 },
        );
      },
    },
    {
      /**
       * `POST /runs/{run_id}/resume` — the application's answer to a wait
       * (§4): a decision at a checkpoint, or a pause withdrawn.
       */
      method: 'POST',
      pattern: /^\/runs\/([^/]+)\/resume$/,
      async handle(match, request) {
        if (!orchestrator) {
          throw new FactoryError(
            'invalid_input',
            'this execution service does not orchestrate runs',
          );
        }
        const body = (await request.json().catch(() => ({}))) as Partial<ResumeRequest> & {
          paused?: boolean;
        };
        await orchestrator.resume(match[1] as string, body);
        return Response.json({ ok: true });
      },
    },
    {
      /** Where a run is in its pipeline, for anybody debugging one. */
      method: 'GET',
      pattern: /^\/runs\/([^/]+)\/orchestration$/,
      async handle(match) {
        const state = await orchestrator?.state(match[1] as string);
        if (!state)
          throw new FactoryError('not_found', 'that run is not one this service is driving');
        const { snapshot: _snapshot, ...rest } = state;
        return Response.json(rest);
      },
    },
    // --- launches: a ticket's branch, running (003, contracts/launches.md) ---
    {
      method: 'POST',
      pattern: /^\/launches$/,
      async handle(_match, request) {
        const body = (await request.json()) as {
          clone_url?: string;
          branch?: string;
          git_token?: string;
          command?: string;
          port?: number;
          sandbox?: {
            image?: string;
            cpu?: number;
            memory_mb?: number;
            wall_clock_minutes?: number;
          };
        };
        if (!body.clone_url || !body.branch || !body.git_token) {
          throw new FactoryError('invalid_input', 'expected clone_url, branch and git_token');
        }
        if (
          body.port !== undefined &&
          !(Number.isInteger(body.port) && body.port > 0 && body.port < 65536)
        ) {
          throw new FactoryError(
            'invalid_input',
            'port must be a whole number between 1 and 65535',
          );
        }
        const record = beginLaunch(launchDeps, {
          cloneUrl: body.clone_url,
          branch: body.branch,
          gitToken: body.git_token,
          ...(body.command ? { command: body.command } : {}),
          ...(body.port ? { port: body.port } : {}),
          sandbox: {
            image: body.sandbox?.image || config.sandboxImage,
            cpu: body.sandbox?.cpu ?? 2,
            memoryMb: body.sandbox?.memory_mb ?? 4096,
            wallClockMinutes: body.sandbox?.wall_clock_minutes ?? 90,
            networkDuringImplement: true,
          },
        });
        log.info('launch begun', { launch_id: record.id, branch: record.branch });
        return Response.json({ launch_id: record.id, status: record.status }, { status: 202 });
      },
    },
    {
      method: 'GET',
      pattern: /^\/launches\/([^/]+)$/,
      async handle(match) {
        const looked = await lookAtLaunch(launchDeps, match[1] as string);
        if (!looked) throw new FactoryError('not_found', 'no such launch');
        return Response.json({
          launch_id: looked.id,
          status: looked.status,
          address: looked.address,
          command: looked.command,
          port: looked.port,
          from: looked.from,
          notes: looked.notes,
          detail: looked.detail,
          log: looked.log,
        });
      },
    },
    {
      method: 'DELETE',
      pattern: /^\/launches\/([^/]+)$/,
      async handle(match) {
        const result = await stopLaunch(launchDeps, match[1] as string);
        return Response.json(result);
      },
    },
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
      /**
       * `POST /runs/{run_id}/open-design` — hand a run's design source to the
       * desktop application on this machine.
       *
       * A development convenience, and only that: it does something only when
       * this service and the person's browser are on the same machine, which
       * is the local setup and never a deployment. A runner that executes in
       * containers refuses and says so. See `desktop/open.ts` for what is
       * checked before anything is opened.
       */
      method: 'POST',
      pattern: /^\/runs\/([^/]+)\/open-design$/,
      async handle(match, request) {
        const runId = match[1] as string;
        const body = (await request.json().catch(() => ({}))) as { path?: string };
        if (typeof body.path !== 'string' || body.path.length === 0) {
          throw new FactoryError('invalid_input', 'name the design to open with `path`');
        }
        const opened = await openDesignFile(
          {
            host,
            containerIdFor: async (id) => (await orchestrator?.state(id))?.containerId,
          },
          runId,
          body.path,
        );
        return Response.json(opened);
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
        // Released on purpose, so the loop must not rebuild it.
        await orchestrator?.cancel(match[1] as string);
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
