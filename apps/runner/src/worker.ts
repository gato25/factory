import { DurableObject } from 'cloudflare:workers';
import { Sandbox as BaseSandbox } from '@cloudflare/sandbox';
import { loadRunnerConfig } from './config';
import type { ContainerHost } from './container/host';
import { hostedHost, type SandboxNamespaces } from './container/hosted';
import { hostFor } from './container/hosts';
import { OFFERED_SIZES, type SandboxSize, sizeOf } from './container/sizes';
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
  /**
   * One binding per offered sandbox size (D4, T045).
   *
   * Processing power and memory are deploy-time configuration on this host, so
   * a run is ROUTED to a size rather than given one — which means a binding
   * per size and no way around it. The names match `OFFERED_SIZES` in
   * `container/sizes.ts` exactly; a size named there with no binding here
   * fails on a real ticket, so `sandboxNamespaces` checks rather than assumes.
   */
  sandbox_1x3: DurableObjectNamespace<BaseSandbox<unknown>>;
  sandbox_1x4: DurableObjectNamespace<BaseSandbox<unknown>>;
  sandbox_2x6: DurableObjectNamespace<BaseSandbox<unknown>>;
  sandbox_4x12: DurableObjectNamespace<BaseSandbox<unknown>>;
  /** One run's state per run id — what replaces `memoryStore()` (D3). */
  RUN: DurableObjectNamespace<RunObject>;
  RUNNER_AUTH_TOKEN: string;
  RUNNER_AUTH_TOKEN_PREVIOUS?: string;
  SANDBOX_IMAGE?: string;
  EXECUTION_HOST?: string;
}

/**
 * The sized namespaces, as `hostedHost` wants them, with every declared size
 * proven present.
 *
 * Checked rather than assumed because the failure it prevents is specific: a
 * size listed in `sizes.ts` with no binding declared in `wrangler.jsonc`
 * presents at run time as a sandbox that cannot be reached, on a real ticket,
 * with an error about an undefined namespace. Here it is a deployment mistake
 * named at the first request instead.
 */
function sandboxNamespaces(env: WorkerEnv): SandboxNamespaces {
  const namespaces: Record<string, DurableObjectNamespace<BaseSandbox<unknown>>> = {};
  const missing: string[] = [];
  for (const size of OFFERED_SIZES) {
    const binding = (
      env as unknown as Record<string, DurableObjectNamespace<BaseSandbox<unknown>>>
    )[size.name];
    if (binding) namespaces[size.name] = binding;
    else missing.push(size.name);
  }
  if (missing.length > 0) {
    throw new Error(
      `runner: sizes.ts offers ${missing.join(', ')} but this deployment declares no container ` +
        'binding for them — add one per size to wrangler.jsonc, each with its own migration tag',
    );
  }
  return namespaces;
}

/**
 * The container class every sandbox binding names.
 *
 * One class serves every size: the size is deploy-time configuration attached
 * to the BINDING, not to the class, so four bindings of one class is the whole
 * mechanism. There is nothing per-size to write here.
 *
 * A subclass rather than a re-export of the SDK's for one reason:
 * `enableInternet` is stated here instead of inherited. The library's default happens to be `true` today,
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
class FactorySandbox extends BaseSandbox<WorkerEnv> {
  override enableInternet: boolean = true;
}

/**
 * One exported class per size, because a container binding names a class and
 * `instance_type` is attached to the binding.
 *
 * They are identical by design — the size is the deployment's, not the code's.
 * Subclasses rather than four bindings of one class because Wrangler requires
 * a distinct class per container binding; there is nothing per-size to write
 * inside them, and anything written here would have to be written four times.
 */
export class Sandbox1x3 extends FactorySandbox {}
export class Sandbox1x4 extends FactorySandbox {}
export class Sandbox2x6 extends FactorySandbox {}
export class Sandbox4x12 extends FactorySandbox {}

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
      // Given the identifier's own namespace rather than the whole map: the
      // alarm's job is to release ONE sandbox, and it should not fail to do
      // that because some other size's binding is missing.
      await hostedHost(namespaceForId(this.env, containerId)).destroy(containerId);
    }
    log.warn(retained ? 'released a retained sandbox' : 'released a sandbox at its deadline', {
      container_id: containerId,
      outcome: state?.record.outcome,
    });
    await this.forget();
  }
}

/**
 * The one namespace an existing sandbox identifier belongs to.
 *
 * Used by the alarm, which holds an identifier and needs only to destroy it.
 * Falls back to the smallest size's binding for an identifier that carries no
 * size — one minted before sizes existed. That fallback cannot release the
 * sandbox if it was really in another namespace, so it is a best effort on a
 * path that has no better option; `sleepAfter` is the second line underneath
 * it (D5).
 */
function namespaceForId(
  env: WorkerEnv,
  containerId: string,
): DurableObjectNamespace<BaseSandbox<unknown>> {
  const size = sizeOf(containerId);
  const bindings = env as unknown as Record<string, DurableObjectNamespace<BaseSandbox<unknown>>>;
  return bindings[size?.name ?? (OFFERED_SIZES[0] as SandboxSize).name] as DurableObjectNamespace<
    BaseSandbox<unknown>
  >;
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
  const missing = [
    ...OFFERED_SIZES.filter((size) => !(env as unknown as Record<string, unknown>)[size.name]).map(
      (size) => size.name,
    ),
    ...(env.RUN ? [] : ['RUN']),
  ];
  if (missing.length > 0) {
    return {
      reachable: false,
      detail:
        `this deployment is missing the ${missing.join(', ')} ` +
        `binding${missing.length > 1 ? 's' : ''}, so no run can start`,
    };
  }
  try {
    // A storage round trip through a run object that belongs to no run. Cheap,
    // starts no container, and fails if the Durable Object namespace is
    // bound but not reachable.
    await durableStore(env.RUN).get('readiness-probe');
    return {
      reachable: true,
      detail:
        `all ${OFFERED_SIZES.length} sandbox sizes and the run binding are present and storage ` +
        'is answering; no sandbox was started',
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
    const host: ContainerHost = hostFor(config.executionHost, () =>
      hostedHost(sandboxNamespaces(env)),
    );
    const handle = handlerFor({
      config,
      host,
      store: durableStore(env.RUN),
      probeHost: () => probeHostedHost(env),
    });
    return handle(request);
  },
};
