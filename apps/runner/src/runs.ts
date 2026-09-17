import {
  type Callback,
  FactoryError,
  type PipelineSnapshot,
  type Step,
  type StepOutcome,
} from '@factory/shared';
import { commitDesign } from './container/commit';
import { writeAgentConfig } from './container/config';
import { destroyRunWorkspace } from './container/destroy';
import type { ContainerHost } from './container/host';
import { pushBranch } from './container/push';
import { isSandboxLoss, withSandboxRecovery } from './container/recover';
import { resetRunBranch } from './container/reset';
import { type ResolvedCredentials, secretValues } from './container/secrets';
import { type SandboxLimits, startRunWorkspace, WORKDIR } from './container/start';
import { runClaudeStep } from './engines/claude-cli';
import { runDesignStep } from './engines/design-cli';
import { runShellStep } from './engines/shell';
import { log } from './errors';
import { LogSink } from './stream/logs';

/**
 * The four operations in contracts/runner.md, as logic rather than routes, so
 * they can be driven by a test without a server. Everything a run needs
 * arrives in the request: the Runner keeps no state of its own between calls
 * except the container it created.
 */

/**
 * How long to keep trying an application that cannot be reached at all.
 *
 * Roughly 30 seconds in seven tries. A run picked up after a restart asks for
 * its credentials the instant the service is listening, and on one machine
 * both start together — the execution service was answering in 23 ms while the
 * application needed a second to boot, so a resumed run died of
 * `credential_missing` before the thing it was asking had opened its port. An
 * application that is genuinely down still fails the run; it just takes half a
 * minute to say so, which is the right trade for not losing a run's work to a
 * restart.
 */
const REACH_WAITS_MS = [250, 500, 1000, 2000, 4000, 8000, 15000] as const;

/**
 * The Runner asks the app for a run's credentials rather than receiving them
 * through the orchestrator, which FR-083 forbids holding any. Authenticated
 * with the run's own secret, exactly as a callback is.
 *
 * A refusal is immediate: the application answered, and waiting will not
 * change its mind. Being unreachable is retried — see `REACH_WAITS_MS`.
 */
export async function fetchCredentials(
  snapshot: PipelineSnapshot,
  doFetch: (url: string, init?: RequestInit) => Promise<Response> = fetch,
  options: { sleep?: (ms: number) => Promise<void>; waits?: readonly number[] } = {},
): Promise<ResolvedCredentials> {
  const url = snapshot.callback_url.replace(
    /\/api\/hooks\/[^/]+$/,
    `/api/runs/${snapshot.run_id}/credentials`,
  );
  const waits = options.waits ?? REACH_WAITS_MS;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  let response: Response | undefined;
  let unreachable: unknown;
  for (let attempt = 0; ; attempt += 1) {
    try {
      response = await doFetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${snapshot.resume_secret}`,
        },
      });
      break;
    } catch (error) {
      unreachable = error;
      if (attempt >= waits.length) break;
      await sleep(waits[attempt] ?? 0);
    }
  }

  if (!response) {
    const error = unreachable;
    // The application being unreachable is a distinct failure from it refusing
    // the request, and it must say which application (002 FR-021). This became
    // worth naming when the execution service moved off the same machine: what
    // used to be a loopback call is now a call across the internet, so "could
    // not get credentials" could mean a misconfigured address, a firewall, or
    // an application that is simply down — and an operator cannot tell those
    // apart without the address.
    //
    // `origin` rather than the full URL on purpose: it carries no path, no
    // query and no userinfo, so naming it cannot leak the run's own secret.
    throw new FactoryError(
      'credential_missing',
      `could not reach the application at ${safeOrigin(url)} for this run's credentials`,
      { detail: error instanceof Error ? error.message : String(error) },
    );
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new FactoryError(
      response.status === 401 ? 'not_authorised' : 'credential_missing',
      body.error ?? `the app answered ${response.status} for this run's credentials`,
    );
  }
  const body = (await response.json()) as { credentials?: ResolvedCredentials };
  if (!body.credentials?.gitToken || !body.credentials?.modelKey) {
    throw new FactoryError('credential_missing', 'the app returned no usable credentials');
  }
  return body.credentials;
}

/**
 * The address to name in a failure, with nothing secret in it.
 *
 * `URL.origin` drops the path, the query and any userinfo, which is what makes
 * it safe to put in an error a caller will see and a log line will keep. Falls
 * back to a description rather than the raw string, because a URL that will not
 * parse is exactly the configuration mistake worth reporting and exactly the
 * one whose raw value is least trustworthy.
 */
function safeOrigin(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return 'an address that is not a valid URL';
  }
}

export interface RunContext {
  snapshot: PipelineSnapshot;
  credentials: ResolvedCredentials;
  sandbox: SandboxLimits;
}

/**
 * A run's state between the separate requests that make up the run.
 *
 * `credentials` is optional here where it is required on `RunContext`, and the
 * difference is the whole of FR-016's retention rule: a failed run's sandbox
 * may be kept for diagnosis, and when it is, the record loses its credentials
 * while keeping its sandbox. Nothing about reading a workspace needs a live
 * token, and a token left behind for a day is a token nobody is watching.
 *
 * So a record with no credentials is a FINISHED run. `liveRun` refuses to serve
 * a step from one, which is what stops the optionality from becoming a
 * `state.credentials?.gitToken` that pushes to nowhere.
 */
export type RunRecord = Omit<RunContext, 'credentials'> & {
  containerId?: string;
  credentials?: ResolvedCredentials;
  /** When a retained failed sandbox may be released (FR-086). */
  retainedUntil?: string;
  /** `running`, or the terminal outcome the destroy call reported. */
  outcome?: 'running' | 'done' | 'failed' | 'cancelled';
};

/**
 * The record a step or a push needs, or a refusal.
 *
 * Both refusals are worded alike on purpose (FR-007, FR-019): a caller learns
 * that the run is not one this service can act on, and nothing about whether a
 * run by that name ever existed. A message separating "never started" from
 * "already finished" would let anyone holding the service's credential
 * enumerate run identifiers.
 */
export async function liveRun(store: RunStore, runId: string): Promise<Required<RunRecord>> {
  const state = await store.get(runId);
  if (!state?.containerId || !state.credentials) {
    throw new FactoryError('not_found', 'that run has no sandbox — start it first');
  }
  return state as Required<RunRecord>;
}

/**
 * Where a run's state lives between calls.
 *
 * Asynchronous so that a store backed by something other than this process's
 * memory can satisfy the same interface without every caller changing. Only
 * `memoryStore` exists today, and every test drives the logic through it.
 */
export interface RunStore {
  get(runId: string): Promise<RunRecord | undefined>;
  set(runId: string, value: RunRecord): Promise<void>;
  delete(runId: string): Promise<void>;
}

export function memoryStore(): RunStore {
  const runs = new Map<string, RunRecord>();
  return {
    get: async (runId) => runs.get(runId),
    set: async (runId, value) => {
      runs.set(runId, value);
    },
    delete: async (runId) => {
      runs.delete(runId);
    },
  };
}

export type CallbackSender = (callback: Callback) => Promise<void>;

/** Posts a callback to the app, authenticated with the run's own secret. */
export function callbackSender(
  snapshot: PipelineSnapshot,
  doFetch: (url: string, init?: RequestInit) => Promise<Response> = fetch,
): CallbackSender {
  return async (callback) => {
    try {
      await doFetch(snapshot.callback_url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${snapshot.resume_secret}`,
        },
        body: JSON.stringify(callback),
      });
    } catch (error) {
      // A lost log chunk must not fail the step that produced it.
      log.warn('a callback could not be delivered', {
        run_id: snapshot.run_id,
        event: callback.event,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  };
}

/**
 * `POST /runs/{run_id}/start` — one fresh container, the repository cloned at
 * its current default branch, the run branch checked out, and every agent's
 * prompt and skill written into the workspace.
 */
export async function startRun(
  host: ContainerHost,
  store: RunStore,
  context: RunContext,
): Promise<{ container_id: string }> {
  const { snapshot } = context;
  const { containerId } = await startRunWorkspace(host, {
    snapshot,
    credentials: context.credentials,
    sandbox: context.sandbox,
  });

  // A branch a previous attempt already wrote to starts from a known state
  // (FR-091). On a first attempt this finds nothing and does nothing.
  if (snapshot.attempt > 1) {
    const reset = await resetRunBranch(host, containerId, snapshot, context.credentials.gitToken);
    if (reset.existedRemotely) {
      log.info('brought the run branch back to a known state', {
        run_id: snapshot.run_id,
        previous_head: reset.previousHead,
      });
    }
  }

  await store.set(snapshot.run_id, { ...context, containerId, outcome: 'running' });
  return { container_id: containerId };
}

export interface StepRequest {
  step: Step;
  feedback?: string;
  has_ui?: boolean;
  /** What the run has spent, so this step's limit is what is left (FR-080). */
  spent_so_far_usd?: string;
  design_screens?: string[];
}

/**
 * `POST /runs/{run_id}/steps/{index}` — exactly one step, dispatched by type
 * and nothing else. The Runner does not know what a specification or a plan
 * is (Principle III).
 */
export async function runStep(
  host: ContainerHost,
  store: RunStore,
  runId: string,
  stepIndex: number,
  request: StepRequest,
  send: CallbackSender,
): Promise<StepOutcome> {
  const state = await liveRun(store, runId);
  const { snapshot, credentials } = state;

  const logs = new LogSink({
    secrets: secretValues(credentials),
    send: (chunk) =>
      send({
        run_id: runId,
        attempt: snapshot.attempt,
        step_index: stepIndex,
        event: 'log_chunk',
        ...chunk,
      } as Callback),
  });

  await send({
    run_id: runId,
    attempt: snapshot.attempt,
    step_index: stepIndex,
    event: 'step_started',
  } as Callback);

  const recovery = await withSandboxRecovery(
    host,
    state.containerId,
    { snapshot, credentials, sandbox: state.sandbox, lostContainerId: state.containerId },
    (containerId) => dispatch(host, containerId, state, stepIndex, request, logs),
    // A run whose record is gone was released on purpose: not rebuilt.
    async () => Boolean((await store.get(runId))?.containerId),
  );
  if (recovery.recovered) {
    // The replacement is what later steps must use.
    await store.set(runId, { ...state, containerId: recovery.outcome.containerId });
    log.warn('a step ran in a replacement sandbox', {
      run_id: runId,
      step_index: stepIndex,
      resumed_from: recovery.resumedFrom,
    });
  }

  const outcome = recovery.outcome.outcome;

  // The classification is a separate event, so the app can store it whether
  // or not the step that produced it went on to succeed (FR-099, FR-100).
  if (outcome.classification) {
    await send({
      run_id: runId,
      attempt: snapshot.attempt,
      step_index: stepIndex,
      event: 'ticket_classified',
      has_ui: outcome.classification.has_ui,
      rationale: outcome.classification.rationale,
    } as Callback);
  }

  return outcome;
}

/** By type, and only by type (contracts/runner.md). */
async function dispatch(
  host: ContainerHost,
  containerId: string,
  state: RunContext,
  stepIndex: number,
  request: StepRequest,
  logs: LogSink,
): Promise<{ outcome: StepOutcome; containerId: string }> {
  const { snapshot } = state;
  const step = request.step;

  if (step.type === 'shell') {
    return { outcome: await runShellStep(host, { step, containerId, logs }), containerId };
  }

  // A checkpoint and a notification never reach the Runner: the orchestrator
  // handles both without a sandbox. Refused here for that reason, before an
  // agent lookup that would blame the wrong thing.
  if (step.type !== 'agent' && step.type !== 'design') {
    throw new FactoryError('invalid_input', `a ${step.type} step is not the Runner's to run`);
  }

  const agent = snapshot.agents.find((candidate) => candidate.id === step.agent_id);
  if (!agent) {
    throw new FactoryError(
      'invalid_input',
      `step ${stepIndex + 1} names an agent this run has no definition for`,
    );
  }

  if (step.type === 'design') {
    return {
      outcome: await runDesignStep(host, {
        step,
        snapshot,
        agent,
        containerId,
        logs,
        spentSoFarUsd: request.spent_so_far_usd,
        feedback: request.feedback,
      }),
      containerId,
    };
  }
  await writeAgentConfig(host, containerId, WORKDIR, {
    snapshot,
    feedback: request.feedback,
    hasUi: request.has_ui,
    designScreens: request.design_screens,
  });
  return {
    outcome: await runClaudeStep(host, {
      step,
      snapshot,
      agent,
      containerId,
      logs,
      spentSoFarUsd: request.spent_so_far_usd,
      feedback: request.feedback,
      hasUi: request.has_ui,
      designScreens: request.design_screens,
    }),
    containerId,
  };
}

/**
 * `POST /runs/{run_id}/verify-and-push` — pushes the branch. It runs NO tests
 * of its own: verification exists only as a shell step an author added
 * (FR-055a, FR-055b).
 */
export async function verifyAndPush(host: ContainerHost, store: RunStore, runId: string) {
  const state = await liveRun(store, runId);
  // A second attempt replaces the branch it reset, so the push carries a
  // lease rather than blindly overwriting (FR-091).
  const outcome = await pushBranch(
    host,
    state.containerId,
    state.snapshot,
    state.credentials.gitToken,
    { force: state.snapshot.attempt > 1 },
  );
  return outcome;
}

/**
 * `DELETE /runs/{run_id}` — releases the sandbox (SC-012), unless the
 * workspace keeps a failed run's sandbox for diagnosis, in which case it is
 * retained for the configured window (FR-086).
 */
export async function destroyRun(
  host: ContainerHost,
  store: RunStore,
  runId: string,
  options: { outcome?: 'done' | 'failed' | 'cancelled'; retainFailedHours?: number } = {},
) {
  const state = await store.get(runId);
  if (!state?.containerId) return { released: false, retainedUntil: undefined };

  const result = await destroyRunWorkspace(host, state.containerId, {
    outcome: options.outcome ?? 'done',
    retainFailedHours: options.retainFailedHours ?? 0,
  });
  if (result.destroyed) {
    await store.delete(runId);
  } else {
    // A retained sandbox is still this run's, so the mapping stays until it is
    // actually released; whatever sweeps it up needs the container id. What
    // does NOT stay is the credentials: retention exists for diagnosis, and
    // nothing about reading a workspace needs a live token (FR-016).
    const { credentials: _dropped, ...withoutCredentials } = state;
    await store.set(runId, {
      ...withoutCredentials,
      outcome: options.outcome ?? 'done',
      ...(result.retainedUntil ? { retainedUntil: result.retainedUntil } : {}),
    });
  }
  return { released: result.destroyed, retainedUntil: result.retainedUntil };
}

export { commitDesign, isSandboxLoss };
