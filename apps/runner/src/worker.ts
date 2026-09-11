import { DurableObject } from 'cloudflare:workers';
import { Sandbox as BaseSandbox } from '@cloudflare/sandbox';
import { loadRunnerConfig } from './config';
import type { ContainerHost } from './container/host';
import { hostedHost } from './container/hosted';
import { hostFor } from './container/hosts';
import { log } from './errors';
import { handlerFor } from './router';
import { deadlineFor, type RunObjectState } from './run-object-state';
import type { RunRecord, RunStore } from './runs';

/**
 * The Runner as a Worker.
 *
 * One of two entries; `index.ts` is the other (002 FR-001). Both serve the same
 * routes from `router.ts`; this one injects the managed sandbox host and
 * Durable Object storage in place of a container daemon and a `Map`.
 *
 * **This is the only file permitted to import `@cloudflare/sandbox`.** The SDK
 * imports `cloudflare:workers`, which exists only in the Workers runtime, so a
 * second importer anywhere in `src/` makes that file unloadable under Bun — and
 * the first time this was tried it took the entire test suite and the whole
 * Docker path down with it. Logic that needs testing therefore lives elsewhere:
 * command construction in `container/hosted-command.ts`, the record lifecycle
 * in `run-object-state.ts`. What is left here is wiring, which is the only kind
 * of code that can safely be unreachable from a test.
 */

/**
 * Required for egress interception, and not obvious: without it the SDK reports
 * "ctx.exports.ContainerProxy is undefined, export ContainerProxy from the
 * containers package in your worker entrypoint". It is a `WorkerEntrypoint`
 * reached through `ctx.exports`, so a plain re-export is all it needs and no
 * wrangler binding — measured on the spike, where its absence failed every
 * sandbox that touched the network.
 */
export { ContainerProxy } from '@cloudflare/sandbox';

export interface WorkerEnv {
  /** One sandbox per run, addressed by the id `hostedHost` mints (FR-006). */
  SANDBOX: DurableObjectNamespace<BaseSandbox<unknown>>;
  /** One run's state per run id — what replaces `memoryStore()` (D3). */
  RUN: DurableObjectNamespace<RunObject>;
  RUNNER_AUTH_TOKEN: string;
  RUNNER_AUTH_TOKEN_PREVIOUS?: string;
  SANDBOX_IMAGE?: string;
  EXECUTION_HOST?: string;
}

/**
 * The container class the sandbox binding names.
 *
 * A subclass rather than a re-export for one reason: `enableInternet` is stated
 * here instead of inherited. The library's default happens to be `true` today,
 * and a step driven by a model is itself a call to a model service — so a
 * version that flipped that default would break every run, silently, with a
 * failure that looks like the model being down rather than like a config
 * change. FR-011 says a run's sandbox has network reach for the whole of its
 * life; this is where that is true.
 *
 * There is no allow or deny list, and that absence is deliberate. T006 measured
 * that the lists govern only traffic routed through the SDK's proxy, not sockets
 * a process opens for itself, so an allowlist here would be a filter that reads
 * as enforcement and enforces nothing. FR-011a requires the setting to be
 * presented as unavailable instead — see `container/hosted.ts`.
 */
export class Sandbox extends BaseSandbox<WorkerEnv> {
  override enableInternet: boolean = true;
}

/**
 * One run's state, for the length of that run.
 *
 * Addressed by run id, so the four separate requests that make up a run reach
 * the same state and the same sandbox without a database and without a lock:
 * the platform guarantees one instance per id, which is what makes FR-008's
 * "a second start cannot create a second sandbox" true by construction rather
 * than by a check that races.
 *
 * It also owns the alarm, and that is the important part. The constitution's
 * 2.0.0 invariant is that every path ends with the sandbox released — including
 * the path where nothing ever calls back, because the orchestrator died or the
 * network partitioned. Nothing outside the platform can guarantee that; an
 * alarm can (FR-010).
 */
export class RunObject extends DurableObject<WorkerEnv> {
  /** The run's record, or nothing if it has not started or has been released. */
  async load(): Promise<RunRecord | undefined> {
    const state = await this.ctx.storage.get<RunObjectState>('state');
    return state?.record;
  }

  async save(record: RunRecord): Promise<void> {
    const existing = await this.ctx.storage.get<RunObjectState>('state');
    // Set once, from the ceiling the run started with, and never moved by a
    // later write. A deadline recomputed on each step would be a deadline the
    // run could extend indefinitely by taking more steps (FR-009a).
    const deadline = existing?.deadline ?? deadlineFor(record, Date.now());
    await this.ctx.storage.put<RunObjectState>('state', { record, deadline });

    // The alarm is whichever comes first: the wall-clock ceiling while the run
    // is going, or the end of the retention window once it has failed. Setting
    // it on every save is deliberate — `setAlarm` replaces rather than adds, so
    // a run that finishes and is retained moves its own backstop forward
    // without anything having to cancel the old one.
    const retainUntil = record.retainedUntil ? Date.parse(record.retainedUntil) : Number.NaN;
    const at = Number.isFinite(retainUntil) ? Math.min(retainUntil, deadline) : deadline;
    await this.ctx.storage.setAlarm(at);
  }

  async forget(): Promise<void> {
    // `deleteAll` is what makes FR-016 true on this path: the credentials are
    // inside the record, so deleting the storage deletes them. Nothing is left
    // for a later reader, and the alarm goes with it.
    await this.ctx.storage.deleteAll();
    await this.ctx.storage.deleteAlarm();
  }

  /**
   * The backstop. Reached when a run outlives its wall-clock ceiling, or when a
   * retained failed sandbox reaches the end of its window.
   *
   * A sandbox is released either way. The difference between the two cases is
   * only what gets logged, because the operator's question is different: "what
   * ran over" versus "what was kept and has now gone".
   */
  override async alarm(): Promise<void> {
    const state = await this.ctx.storage.get<RunObjectState>('state');
    const containerId = state?.record.containerId;
    const retained = Boolean(state?.record.retainedUntil);

    if (containerId) {
      // Never throws, by the execution host contract — which matters here more
      // than anywhere, because an alarm that throws is retried and a backstop
      // that retries forever is not a backstop.
      await hostedHost(this.env.SANDBOX).destroy(containerId);
    }
    log.warn(retained ? 'released a retained sandbox' : 'released a sandbox at its deadline', {
      container_id: containerId,
      outcome: state?.record.outcome,
    });
    await this.forget();
  }
}

/**
 * The run store, backed by one Durable Object per run.
 *
 * The three methods map to three RPC calls. What looks like a plain `Map` to
 * `runs.ts` is a round trip to storage that survives the isolate — which is the
 * whole reason the interface became asynchronous.
 */
export function durableStore(namespace: DurableObjectNamespace<RunObject>): RunStore {
  const object = (runId: string) => namespace.get(namespace.idFromName(runId));
  return {
    get: (runId) => object(runId).load(),
    set: (runId, value) => object(runId).save(value),
    delete: (runId) => object(runId).forget(),
  };
}

/**
 * Whether this deployment can reach what it needs to start a run (FR-020, T030).
 *
 * Deliberately does NOT start a sandbox. Doing so would make the settings
 * screen's readiness check cost a container, and — worse — would report
 * `degraded` whenever the instance limit was reached, which is exactly when
 * runs are healthy and busy. So this proves the two things that are cheap and
 * that actually go wrong in practice: the bindings a run needs are present, and
 * Durable Object storage answers.
 *
 * The `detail` says what was and was not proven, rather than claiming a
 * reachable sandbox service. An operator reading "ok" here and then seeing a
 * run fail to get a sandbox needs to know the check never covered that.
 */
async function probeHostedHost(env: WorkerEnv): Promise<{ reachable: boolean; detail: string }> {
  const missing = [env.SANDBOX ? undefined : 'SANDBOX', env.RUN ? undefined : 'RUN'].filter(
    (name): name is string => name !== undefined,
  );
  if (missing.length > 0) {
    return {
      reachable: false,
      detail: `this deployment is missing the ${missing.join(' and ')} binding, so no run can start`,
    };
  }
  try {
    // A storage round trip through a run object that belongs to no run. Cheap,
    // starts no container, and fails if the Durable Object namespace is
    // bound but not reachable.
    await durableStore(env.RUN).get('readiness-probe');
    return {
      reachable: true,
      detail: 'sandbox and run bindings present and storage answering; no sandbox was started',
    };
  } catch (error) {
    return {
      reachable: false,
      detail: `run state is unreachable: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    // Read per request rather than at module scope: `env` arrives with the
    // request and there is no module-scope moment in a Worker at which it
    // exists. Cheap — it is a handful of string reads.
    const config = loadRunnerConfig(env as unknown as Record<string, string | undefined>);
    const host: ContainerHost = hostFor(config.executionHost, () => hostedHost(env.SANDBOX));
    const handle = handlerFor({
      config,
      host,
      store: durableStore(env.RUN),
      probeHost: () => probeHostedHost(env),
    });
    return handle(request);
  },
};
