import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Callback, PipelineSnapshot } from '@factory/shared';
import type { RunnerConfig } from '../../src/config';
import { Orchestrator } from '../../src/orchestrate/loop';
import { fileStateStore, type StateStore } from '../../src/orchestrate/state';
import { handlerFor } from '../../src/router';
import { fileRunStore } from '../../src/run-records';
import type { RunStore } from '../../src/runs';
import { snapshot as base, credentials, FakeHost } from '../fake-host';

/**
 * A failed run's sandbox, kept for diagnosis, is released when the window
 * ends — even when the runner restarted in between (FR-023, FR-086).
 *
 * The record lived in memory only, so after a restart the application's
 * release request found no run and answered `released: false`; the
 * container ran until its own `sleep` ended.
 */

const TOKEN = 'a-token';
const snapshot: PipelineSnapshot = {
  ...base,
  pipeline: {
    ...base.pipeline,
    steps: [
      { type: 'agent', condition: 'always', agent_id: 'a-spec', output_files: ['docs/spec.md'] },
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

let dir: string;
let host: FakeHost;
let store: RunStore;
let states: StateStore;
let orchestrator: Orchestrator;
let handle: (request: Request) => Promise<Response>;
let callbacks: Callback[];

async function fakeFetch(url: string, init?: RequestInit): Promise<Response> {
  if (url === base.callback_url) {
    const callback = JSON.parse(String(init?.body)) as Callback;
    if (callback.event !== 'log_chunk') callbacks.push(callback);
    return Response.json({ applied: true, paused: false, continue: true });
  }
  if (url.endsWith(`/api/runs/${base.run_id}/credentials`)) {
    return Response.json({ credentials });
  }
  throw new Error(`unexpected request: ${init?.method ?? 'GET'} ${url}`);
}

function build(existingHost?: FakeHost) {
  host = existingHost ?? new FakeHost();
  store = fileRunStore(join(dir, 'runs'));
  states = fileStateStore(join(dir, 'state'));
  const config: RunnerConfig = {
    port: 8080,
    publicBaseUrl: 'http://runner.test',
    executionHost: 'process',
    workDir: '/tmp/factory-tests',
    stateDir: dir,
    sandboxImage: 'factory/runner:1',
    authToken: TOKEN,
  };
  orchestrator = new Orchestrator({
    host,
    store,
    states,
    fetch: fakeFetch,
    publicBaseUrl: config.publicBaseUrl,
    sleep: async () => {},
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

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'factory-retained-'));
  callbacks = [];
  build();
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('a retained failed sandbox', () => {
  test('is released by the application’s request after the runner restarted', async () => {
    // The step fails; the workspace keeps failed sandboxes for two hours.
    host.responses = [{ match: 'claude', result: { exitCode: 1, stderr: 'boom', stdout: '{}' } }];
    // `fail()` in the loop releases with no retention; the application's own
    // release call is what retains. Drive the step-level routes the way the
    // application does: start, step, then release with retention.
    await call('POST', `/runs/${base.run_id}/start`, {
      snapshot,
      credentials,
      sandbox: {
        image: 'factory/runner:1',
        cpu: 2,
        memoryMb: 4096,
        wallClockMinutes: 60,
        networkDuringImplement: true,
      },
    });
    const retained = await call(
      'DELETE',
      `/runs/${base.run_id}?outcome=failed&retain_failed_hours=2`,
    );
    expect(await retained.json()).toMatchObject({ released: false });
    expect(host.destroyed).toEqual([]);
    const kept = await store.get(base.run_id);
    expect(kept?.containerId).toBe('container-1');
    expect(kept?.credentials).toBeUndefined();

    // The runner restarts: a new process, the same directory, the same host.
    build(host);
    const released = await call('DELETE', `/runs/${base.run_id}?outcome=failed`);
    expect(await released.json()).toMatchObject({ released: true });
    expect(host.destroyed).toEqual(['container-1']);
    expect(await store.get(base.run_id)).toBeUndefined();
  });

  test('a run in flight is still adopted, quiet, after a restart with records on disk', async () => {
    host.files.set('/work/docs/spec.md', '# Spec');
    host.responses = [{ match: 'claude', result: { stdout: '{"total_cost_usd":0.42}' } }];
    const withGate: PipelineSnapshot = {
      ...snapshot,
      pipeline: {
        ...snapshot.pipeline,
        steps: [
          ...snapshot.pipeline.steps,
          { type: 'checkpoint', condition: 'always', approvers: 'anyone' },
        ],
      },
    };
    await call('POST', `/runs/${base.run_id}/execute`, withGate);
    await until(
      async () => (await states.get(base.run_id))?.phase === 'waiting_approval',
      'the checkpoint',
    );
    const state = await states.get(base.run_id);
    if (!state) throw new Error('no state');
    await states.set({ ...state, phase: 'stepping', index: 0, waitingAt: undefined });

    // The record survived on disk — without credentials — and the state too.
    build(host);
    host.leftover = 1;
    callbacks = [];
    await orchestrator.recover();
    await until(
      async () => (await states.get(base.run_id))?.phase === 'waiting_approval',
      'the checkpoint again',
    );
    expect(host.adopted).toEqual(['container-1']);
    expect(host.quiesced).toEqual(['container-1']);
    expect(host.created).toHaveLength(1);
    expect(callbacks.map((c) => c.event)).toEqual([
      'step_started',
      'step_finished',
      'waiting_approval',
    ]);
  });
});
