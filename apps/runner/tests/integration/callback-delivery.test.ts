import { beforeEach, describe, expect, test } from 'bun:test';
import type { Callback, PipelineSnapshot } from '@factory/shared';
import type { RunnerConfig } from '../../src/config';
import { CALLBACK_DELIVERY, Orchestrator } from '../../src/orchestrate/loop';
import { type LoopState, memoryStateStore, type StateStore } from '../../src/orchestrate/state';
import { handlerFor } from '../../src/router';
import { CALLBACK_TIMEOUT_MS, callbackSender, memoryStore, type RunStore } from '../../src/runs';
import { snapshot as base, credentials, FakeHost } from '../fake-host';

/**
 * A step's outcome reaches the application even when the application is not
 * there to take it at once.
 *
 * The expensive part of a step is the work; the report is one request. The
 * loop used to give the request twelve seconds and then fail the run — less
 * than a restart of the application takes — and a runner restarted in that
 * window ran the whole step again, because its position on disk still said
 * the step was ahead. Now the outcome is written down before it is sent,
 * sent for as long as the delivery budget allows, and sent FIRST by a runner
 * that picks the run up.
 */

const TOKEN = 'a-token';
const config: RunnerConfig = {
  port: 8080,
  publicBaseUrl: 'http://runner.test',
  executionHost: 'process',
  workDir: '/tmp/factory-tests',
  stateDir: '/tmp/factory-tests/state',
  sandboxImage: 'factory/runner:1',
  authToken: TOKEN,
};

/** One agent step, then a checkpoint, so a run has somewhere to stop. */
const snapshot: PipelineSnapshot = {
  ...base,
  pipeline: {
    ...base.pipeline,
    steps: [
      { type: 'agent', condition: 'always', agent_id: 'a-spec', output_files: ['docs/spec.md'] },
      { type: 'checkpoint', condition: 'always', approvers: 'anyone' },
    ],
  },
  sandbox: {
    image: 'factory/runner:1',
    cpu: 2,
    memory_mb: 4096,
    wall_clock_minutes: 60,
    network_during_implement: true,
  },
};

let host: FakeHost;
let store: RunStore;
let states: StateStore;
let orchestrator: Orchestrator;
let handle: (request: Request) => Promise<Response>;
/** Every callback the application accepted, in order, without the log noise. */
let callbacks: Callback[];
/** Every request made, in order, as `event` for a callback or the path otherwise. */
let requests: string[];
/** The signal each callback request carried. */
let signals: (AbortSignal | null | undefined)[];
/** How the application answers a callback of this event, per attempt: throw, a status, or accept. */
let answer: (event: string, attempt: number) => 'unreachable' | number | 'ok';
let attempts: Record<string, number>;

async function fakeFetch(url: string, init?: RequestInit): Promise<Response> {
  if (url === base.callback_url) {
    const callback = JSON.parse(String(init?.body)) as Callback;
    if (callback.event === 'log_chunk') return Response.json({ applied: true });
    attempts[callback.event] = (attempts[callback.event] ?? 0) + 1;
    requests.push(callback.event);
    signals.push(init?.signal);
    const verdict = answer(callback.event, attempts[callback.event] ?? 1);
    if (verdict === 'unreachable') throw new TypeError('Unable to connect');
    if (typeof verdict === 'number') return new Response('not now', { status: verdict });
    callbacks.push(callback);
    return Response.json({ applied: true, paused: false, continue: true });
  }
  if (url.endsWith(`/api/runs/${base.run_id}/credentials`)) {
    requests.push('credentials');
    return Response.json({ credentials });
  }
  throw new Error(`unexpected request: ${init?.method ?? 'GET'} ${url}`);
}

function build(existing?: { states: StateStore; host: FakeHost }, delivery = {}) {
  host = existing?.host ?? new FakeHost();
  store = memoryStore();
  states = existing?.states ?? memoryStateStore();
  orchestrator = new Orchestrator({
    host,
    store,
    states,
    fetch: fakeFetch,
    publicBaseUrl: config.publicBaseUrl,
    sleep: async () => {},
    callbackDelivery: delivery,
  });
  handle = handlerFor({
    config,
    host,
    store,
    orchestrator,
    probeHost: async () => ({ reachable: true, detail: 'fake' }),
  });
}

const call = (method: string, path: string, body?: unknown) =>
  handle(
    new Request(`http://runner.internal${path}`, {
      method,
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
  );

async function until(condition: () => Promise<boolean> | boolean, what: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`timed out waiting for ${what}; callbacks so far: ${events().join(' → ')}`);
}
const phaseIs = (phase: string) => async () => (await states.get(base.run_id))?.phase === phase;
const gone = async () => (await states.get(base.run_id)) === undefined;
const events = () => callbacks.map((c) => `${c.event}@${c.step_index}`);
/** How many times a step began, which is what `step_started` announces. */
const stepRuns = () => attempts.step_started ?? 0;

beforeEach(() => {
  callbacks = [];
  requests = [];
  signals = [];
  attempts = {};
  answer = () => 'ok';
  build();
  host.files.set('/work/docs/spec.md', '# Spec');
  host.responses = [
    { match: 'claude', result: { stdout: '{"total_cost_usd":0.42,"num_turns":3}' } },
  ];
});

describe('an application that is not there when a step finishes', () => {
  test('gets the outcome when it is back, and the step is not run again', async () => {
    // Down for five attempts: with the real schedule that is 1+2+4+8+16
    // seconds, a short deploy.
    answer = (event, attempt) => (event === 'step_finished' && attempt <= 5 ? 'unreachable' : 'ok');
    await call('POST', `/runs/${base.run_id}/execute`, snapshot);
    await until(phaseIs('waiting_approval'), 'the checkpoint');

    expect(attempts.step_finished).toBe(6);
    expect(stepRuns()).toBe(1);
    expect(events()).toEqual([
      'started@0',
      'step_started@0',
      'step_finished@0',
      'waiting_approval@1',
    ]);
  });

  test('every request has a timeout of its own, so a hung connection is tried again', async () => {
    await call('POST', `/runs/${base.run_id}/execute`, snapshot);
    await until(phaseIs('waiting_approval'), 'the checkpoint');
    expect(signals.length).toBeGreaterThan(0);
    for (const signal of signals) expect(signal).toBeInstanceOf(AbortSignal);
  });

  test('a refusal is not retried, because asking again will not change it', async () => {
    answer = (event) => (event === 'step_finished' ? 400 : 'ok');
    await call('POST', `/runs/${base.run_id}/execute`, snapshot);
    await until(gone, 'the run to fail');
    expect(attempts.step_finished).toBe(1);
    const failed = callbacks.at(-1) as Callback & { reason: string; detail: string };
    expect(failed.event).toBe('failed');
    expect(failed.reason).toBe('app_unreachable');
    expect(failed.detail).toContain('answered 400');
  });

  test('being asked to slow down is not a refusal', async () => {
    answer = (event, attempt) => (event === 'step_finished' && attempt <= 2 ? 429 : 'ok');
    await call('POST', `/runs/${base.run_id}/execute`, snapshot);
    await until(phaseIs('waiting_approval'), 'the checkpoint');
    expect(attempts.step_finished).toBe(3);
  });

  test('when the budget is spent the run fails, naming the application, and is reported once', async () => {
    // A five-second budget with one-second first pause: attempts at 0, 1, 3
    // and 5 seconds, and then no more.
    build(undefined, { budgetMs: 5_000, firstDelayMs: 1_000 });
    host.files.set('/work/docs/spec.md', '# Spec');
    host.responses = [{ match: 'claude', result: { stdout: '{"total_cost_usd":0.42}' } }];
    answer = (event) => (event === 'step_finished' ? 'unreachable' : 'ok');

    await call('POST', `/runs/${base.run_id}/execute`, snapshot);
    await until(gone, 'the run to fail');
    expect(attempts.step_finished).toBe(4);
    // The failure itself is reported with one attempt, not another budget's worth.
    expect(attempts.failed).toBe(1);
    const failed = callbacks.at(-1) as Callback & { reason: string; detail: string };
    expect(failed.event).toBe('failed');
    expect(failed.reason).toBe('app_unreachable');
    expect(failed.detail).toContain('could not be reached for step_finished');
    expect(host.destroyed).toEqual(['container-1']);
  });

  test('the default budget is a deploy, not a hiccup', () => {
    expect(CALLBACK_DELIVERY.budgetMs).toBeGreaterThanOrEqual(10 * 60_000);
    expect(CALLBACK_DELIVERY.timeoutMs).toBe(CALLBACK_TIMEOUT_MS);
  });
});

/** The state a runner would have died with: the step done, its outcome unsent. */
function unsent(state: LoopState, outcome: 'done' | 'failed'): LoopState {
  return {
    ...state,
    phase: 'stepping',
    index: 0,
    waitingAt: undefined,
    pending: {
      callback: {
        run_id: base.run_id,
        attempt: base.attempt,
        step_index: 0,
        event: 'step_finished',
        status: outcome,
        duration_s: 12,
        cost_usd: '0.4200',
        summary: outcome === 'failed' ? 'the agent gave up' : undefined,
        artifacts: [{ kind: 'document', path: 'docs/spec.md', version: 1 }],
        artifact_contents: { 'docs/spec.md': '# Spec, as the step left it' },
      },
      since: new Date().toISOString(),
      after:
        outcome === 'failed'
          ? { outcome: 'failed', reason: 'command_failed', detail: 'the agent gave up' }
          : { outcome: 'done' },
    },
  };
}

describe('a runner that stopped with an outcome unsent', () => {
  test('delivers it first after the restart, and does not run the step again', async () => {
    await call('POST', `/runs/${base.run_id}/execute`, snapshot);
    await until(phaseIs('waiting_approval'), 'the checkpoint');
    const state = await states.get(base.run_id);
    if (!state) throw new Error('no state');
    await states.set(unsent(state, 'done'));

    // A new runner, and an application that is still down for a moment.
    build({ states, host });
    callbacks = [];
    requests = [];
    attempts = {};
    answer = (event, attempt) => (event === 'step_finished' && attempt <= 2 ? 'unreachable' : 'ok');
    const picked = await orchestrator.recover();
    expect(picked.resumed).toEqual([base.run_id]);
    await until(phaseIs('waiting_approval'), 'the checkpoint again');

    expect(events()).toEqual(['step_finished@0', 'waiting_approval@1']);
    expect(stepRuns()).toBe(0);
    // Told first: nothing was asked of the application until it had taken
    // the outcome. Had credentials been fetched first, the application being
    // down would have failed the run before delivery got its chance.
    expect(requests.indexOf('credentials')).toBeGreaterThan(requests.lastIndexOf('step_finished'));
    const delivered = callbacks[0] as Callback & { artifact_contents: Record<string, string> };
    expect(delivered.artifact_contents['docs/spec.md']).toBe('# Spec, as the step left it');
    expect((await states.get(base.run_id))?.pending).toBeUndefined();
  });

  test('a failed step still fails the run once its outcome is delivered', async () => {
    await call('POST', `/runs/${base.run_id}/execute`, snapshot);
    await until(phaseIs('waiting_approval'), 'the checkpoint');
    const state = await states.get(base.run_id);
    if (!state) throw new Error('no state');
    await states.set(unsent(state, 'failed'));

    build({ states, host });
    callbacks = [];
    await orchestrator.recover();
    await until(gone, 'the run to fail');
    expect(events()).toEqual(['step_finished@0', 'failed@0']);
    const failed = callbacks[1] as Callback & { reason: string; detail: string };
    expect(failed.reason).toBe('command_failed');
    expect(failed.detail).toBe('the agent gave up');
  });

  test('is visible to somebody debugging, without the outcome’s body', async () => {
    await call('POST', `/runs/${base.run_id}/execute`, snapshot);
    await until(phaseIs('waiting_approval'), 'the checkpoint');
    const state = await states.get(base.run_id);
    if (!state) throw new Error('no state');
    await states.set(unsent(state, 'done'));

    const response = await call('GET', `/runs/${base.run_id}/orchestration`);
    const text = await response.text();
    const shown = JSON.parse(text) as { pending: Record<string, unknown> };
    expect(shown.pending).toMatchObject({ event: 'step_finished', step_index: 0, after: 'done' });
    expect(text).not.toContain('as the step left it');
  });
});

describe('the best-effort sender a step uses for its log', () => {
  test('gives each request a timeout too', async () => {
    let seen: AbortSignal | null | undefined;
    const send = callbackSender(base as PipelineSnapshot, async (_url, init) => {
      seen = init?.signal;
      return Response.json({ applied: true });
    });
    await send({
      run_id: base.run_id,
      attempt: 1,
      step_index: 0,
      event: 'step_started',
    } as Callback);
    expect(seen).toBeInstanceOf(AbortSignal);
  });
});
