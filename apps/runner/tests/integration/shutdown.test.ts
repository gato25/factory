import { beforeEach, describe, expect, test } from 'bun:test';
import type { Callback, PipelineSnapshot } from '@factory/shared';
import type { RunnerConfig } from '../../src/config';
import type { ExecOptions, ExecResult } from '../../src/container/host';
import { Orchestrator } from '../../src/orchestrate/loop';
import { memoryStateStore, type StateStore } from '../../src/orchestrate/state';
import { handlerFor } from '../../src/router';
import { memoryStore, type RunStore } from '../../src/runs';
import { snapshot as base, credentials, FakeHost } from '../fake-host';

/**
 * Shutting down leaves every run where a restart can pick it up, and leaves
 * no agent working headless.
 */

/** A host whose agent step runs until it is told to stop, as a real one does. */
class SlowHost extends FakeHost {
  private release: ((result: ExecResult) => void) | null = null;
  /** Resolves once the step is inside its command. */
  stepBegan: Promise<void>;
  private began!: () => void;

  constructor() {
    super();
    this.stepBegan = new Promise((resolve) => {
      this.began = resolve;
    });
  }

  override async exec(id: string, argv: string[], options?: ExecOptions): Promise<ExecResult> {
    // The agent's own invocation carries the output format; the CLI
    // self-test before a step does not.
    if (argv.join(' ').includes('--output-format') && this.release === null) {
      this.began();
      // The agent works until something ends it.
      return new Promise<ExecResult>((resolve) => {
        this.release = resolve;
      });
    }
    return super.exec(id, argv, options);
  }

  override async quiesce(containerId: string): Promise<{ stopped: number }> {
    await super.quiesce(containerId);
    // Killing the agent is what makes its `docker exec` return — with the
    // exit code of a killed process.
    this.release?.({ exitCode: 137, stdout: '', stderr: 'Killed' });
    return { stopped: 1 };
  }
}

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
let callbacks: Callback[];
let appDown: boolean;

async function fakeFetch(url: string, init?: RequestInit): Promise<Response> {
  if (url === base.callback_url) {
    const callback = JSON.parse(String(init?.body)) as Callback;
    if (callback.event === 'log_chunk') return Response.json({ applied: true });
    if (appDown && callback.event === 'step_finished') throw new TypeError('Unable to connect');
    callbacks.push(callback);
    return Response.json({ applied: true, paused: false, continue: true });
  }
  if (url.endsWith(`/api/runs/${base.run_id}/credentials`)) {
    return Response.json({ credentials });
  }
  throw new Error(`unexpected request: ${init?.method ?? 'GET'} ${url}`);
}

function build(existing?: { states: StateStore; host: FakeHost }, slow = false) {
  host = existing?.host ?? new SlowHost();
  store = memoryStore();
  states = existing?.states ?? memoryStateStore();
  host.files.set('/work/docs/spec.md', '# Spec');
  host.responses = [{ match: 'claude', result: { stdout: '{"total_cost_usd":0.42}' } }];
  orchestrator = new Orchestrator({
    host,
    store,
    states,
    fetch: fakeFetch,
    publicBaseUrl: config.publicBaseUrl,
    // Instant, except where a test needs a retry loop it can interrupt.
    sleep: slow ? () => new Promise((resolve) => setTimeout(resolve, 20)) : async () => {},
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
  throw new Error(`timed out waiting for ${what}`);
}
const phaseIs = (phase: string) => async () => (await states.get(base.run_id))?.phase === phase;
const events = () => callbacks.map((c) => `${c.event}@${c.step_index}`);

beforeEach(() => {
  callbacks = [];
  appDown = false;
  build();
});

describe('shutting down', () => {
  test('a step in flight: the agent is stopped, its outcome discarded, its position kept', async () => {
    const slow = host as SlowHost;
    await call('POST', `/runs/${base.run_id}/execute`, snapshot);
    await slow.stepBegan;
    expect(events()).toEqual(['started@0', 'step_started@0']);

    const result = await orchestrator.shutdown(2_000);
    expect(result.inFlight).toEqual([base.run_id]);
    expect(result.quiesced).toEqual([base.run_id]);
    expect(host.quiesced).toEqual(['container-1']);
    // The killed exec produced an "outcome"; it was not acted on.
    expect(events()).toEqual(['started@0', 'step_started@0']);
    const state = await states.get(base.run_id);
    expect(state?.phase).toBe('stepping');
    expect(state?.index).toBe(0);
    expect(state?.pending).toBeUndefined();
    // Nothing was destroyed and nothing was reported as failed.
    expect(host.destroyed).toEqual([]);

    // The restart: a new runner on the same files and host picks it up.
    build({ states, host });
    callbacks = [];
    await orchestrator.recover();
    await until(phaseIs('waiting_approval'), 'the checkpoint after the restart');
    expect(events()).toEqual(['step_started@0', 'step_finished@0', 'waiting_approval@1']);
  });

  test('new work is refused with 503, which the application retries later', async () => {
    await orchestrator.shutdown(100);
    const refused = await call('POST', `/runs/${base.run_id}/execute`, snapshot);
    expect(refused.status).toBe(503);
    expect(await refused.json()).toMatchObject({ error: expect.stringContaining('shutting down') });
    expect(orchestrator.isStopping).toBe(true);
  });

  test('a delivery being retried stops, and the outcome stays written down for the restart', async () => {
    // A plain host: the step finishes at once; the application is down.
    build({ states: memoryStateStore(), host: new FakeHost() }, true);
    host.files.set('/work/docs/spec.md', '# Spec');
    host.responses = [{ match: 'claude', result: { stdout: '{"total_cost_usd":0.42}' } }];
    appDown = true;
    await call('POST', `/runs/${base.run_id}/execute`, snapshot);
    await until(async () => (await states.get(base.run_id))?.pending !== undefined, 'the outcome');

    await orchestrator.shutdown(2_000);
    const state = await states.get(base.run_id);
    expect(state?.pending?.callback.event).toBe('step_finished');
    expect(state?.phase).toBe('stepping');
    expect(events()).not.toContain('failed@0');

    // After the restart, with the application back, it is delivered first.
    appDown = false;
    build({ states, host });
    callbacks = [];
    await orchestrator.recover();
    await until(phaseIs('waiting_approval'), 'the checkpoint');
    expect(events()).toEqual(['step_finished@0', 'waiting_approval@1']);
  });

  test('with nothing in flight it returns at once', async () => {
    const started = Date.now();
    const result = await orchestrator.shutdown(5_000);
    expect(result).toEqual({ inFlight: [], quiesced: [] });
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});
