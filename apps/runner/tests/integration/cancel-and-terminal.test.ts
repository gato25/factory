import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Callback, PipelineSnapshot } from '@factory/shared';
import type { RunnerConfig } from '../../src/config';
import type { ExecOptions, ExecResult } from '../../src/container/host';
import { Orchestrator } from '../../src/orchestrate/loop';
import { fileStateStore, type StateStore } from '../../src/orchestrate/state';
import { handlerFor } from '../../src/router';
import { fileRunStore } from '../../src/run-records';
import type { RunStore } from '../../src/runs';
import { snapshot as base, credentials, FakeHost } from '../fake-host';

/**
 * A run that ends stays ended, whatever else is happening at the moment.
 *
 * Three ways it did not: a cancel during a step was undone by the loop's
 * next save; a failure the application could not be told about was deleted
 * by the next restart with its sandbox still running; and a restart between
 * opening the merge request and telling the application asked the provider
 * for a second one.
 */

/** A host whose agent step runs until it is told to stop. */
class SlowHost extends FakeHost {
  private release: ((result: ExecResult) => void) | null = null;
  stepBegan: Promise<void>;
  private began!: () => void;

  constructor() {
    super();
    this.stepBegan = new Promise((resolve) => {
      this.began = resolve;
    });
  }

  override async exec(id: string, argv: string[], options?: ExecOptions): Promise<ExecResult> {
    if (argv.join(' ').includes('--output-format') && this.release === null) {
      this.began();
      return new Promise<ExecResult>((resolve) => {
        this.release = resolve;
      });
    }
    return super.exec(id, argv, options);
  }

  /** The agent finishes — successfully, as far as it knows. */
  finishStep(): void {
    this.release?.({ exitCode: 0, stdout: '{"total_cost_usd":0.42}', stderr: '' });
  }
}

const TOKEN = 'a-token';
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
const OPENED = 'https://gitlab.com/netgroup/shop-frontend/-/merge_requests/7';

let dir: string;
let host: FakeHost;
let store: RunStore;
let states: StateStore;
let orchestrator: Orchestrator;
let handle: (request: Request) => Promise<Response>;
let callbacks: Callback[];
/** Callback events the application currently refuses to take. */
let downFor: Set<string>;
let providerPosts: number;
let providerListed: string[];

async function fakeFetch(url: string, init?: RequestInit): Promise<Response> {
  const method = init?.method ?? 'GET';
  if (url === base.callback_url) {
    const callback = JSON.parse(String(init?.body)) as Callback;
    if (callback.event === 'log_chunk') return Response.json({ applied: true });
    if (downFor.has(callback.event)) throw new TypeError('Unable to connect');
    callbacks.push(callback);
    return Response.json({ applied: true, paused: false, continue: true });
  }
  if (url.endsWith(`/api/runs/${base.run_id}/credentials`)) {
    return Response.json({ credentials });
  }
  if (url.endsWith(`/api/runs/${base.run_id}/merge-request`)) {
    return Response.json({
      title: 'Add Google OAuth sign-in (#142)',
      description: 'The body.',
      source_branch: base.repo.branch,
      target_branch: base.repo.default_branch,
    });
  }
  if (url.startsWith('https://gitlab.com/api/v4/')) {
    if (method === 'POST') {
      providerPosts += 1;
      return Response.json({ web_url: OPENED });
    }
    return Response.json(providerListed.map((u) => ({ web_url: u })));
  }
  throw new Error(`unexpected request: ${method} ${url}`);
}

/** A runner on the directory; `slow` gives it a sleep a test can interrupt. */
function build(existingHost?: FakeHost, slow = false) {
  host = existingHost ?? new SlowHost();
  store = fileRunStore(join(dir, 'runs'));
  states = fileStateStore(join(dir, 'state'));
  host.files.set('/work/docs/spec.md', '# Spec');
  if (host.responses.length === 0) {
    host.responses = [
      { match: 'claude', result: { stdout: '{"total_cost_usd":0.42}' } },
      { match: 'git log', result: { stdout: 'abc1234 a commit\n' } },
    ];
  }
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
    sleep: slow ? () => new Promise((resolve) => setTimeout(resolve, 20)) : async () => {},
    callbackDelivery: { budgetMs: 60_000, firstDelayMs: 1_000 },
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
  throw new Error(`timed out waiting for ${what}; callbacks: ${events().join(' → ')}`);
}
const phaseIs = (phase: string) => async () => (await states.get(base.run_id))?.phase === phase;
const gone = async () => (await states.get(base.run_id)) === undefined;
const events = () => callbacks.map((c) => `${c.event}@${c.step_index}`);
const stateFiles = async () =>
  (await readdir(join(dir, 'state')).catch(() => [])).filter((n) => n.endsWith('.json'));

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'factory-terminal-'));
  callbacks = [];
  downFor = new Set();
  providerPosts = 0;
  providerListed = [];
  build();
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('a cancel that lands while a step is running', () => {
  test('is not undone by the step finishing: no state, no callbacks, one release', async () => {
    const slow = host as SlowHost;
    await call('POST', `/runs/${base.run_id}/execute`, snapshot);
    await slow.stepBegan;

    const released = await call('DELETE', `/runs/${base.run_id}?outcome=cancelled`);
    expect(released.status).toBe(200);
    expect(await stateFiles()).toEqual([]);
    expect(host.destroyed).toEqual(['container-1']);

    // The agent finishes a moment later, successfully as far as it knows.
    callbacks = [];
    slow.finishStep();
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Nothing came back: no state file, no step_finished, no failed.
    expect(await stateFiles()).toEqual([]);
    expect(events()).toEqual([]);
    expect(host.destroyed).toEqual(['container-1']);
    expect(await store.get(base.run_id)).toBeUndefined();
  });
});

describe('a run that failed while the application was down', () => {
  test('is finished ending by the next runner: told, released, forgotten', async () => {
    const failing = new FakeHost();
    failing.responses = [
      { match: 'claude', result: { exitCode: 1, stderr: 'boom', stdout: '{}' } },
    ];
    build(failing, true);
    downFor = new Set(['failed']);
    await call('POST', `/runs/${base.run_id}/execute`, snapshot);
    // The failure is written down as pending its delivery, and the delivery
    // is being retried when the runner stops.
    await until(
      async () => (await states.get(base.run_id))?.pending?.after.outcome === 'terminal',
      'the failure to be written down',
    );
    await orchestrator.shutdown(2_000);
    // Shutdown interrupted the report: nothing released, nothing forgotten.
    expect(host.destroyed).toEqual([]);
    expect((await states.get(base.run_id))?.pending?.after.outcome).toBe('terminal');

    // A new runner, same files and host, application back.
    build(host);
    downFor = new Set();
    callbacks = [];
    const picked = await orchestrator.recover();
    expect(picked.resumed).toEqual([base.run_id]);
    await until(gone, 'the run to be forgotten');
    expect(events()).toEqual(['failed@0']);
    expect(host.destroyed).toEqual(['container-1']);
  });
});

describe('a cancel at a checkpoint while the application is down', () => {
  test('is finished ending by the next runner too', async () => {
    build(new FakeHost(), true);
    await call('POST', `/runs/${base.run_id}/execute`, snapshot);
    await until(phaseIs('waiting_approval'), 'the checkpoint');
    downFor = new Set(['cancelled']);
    const resumed = call('POST', `/runs/${base.run_id}/resume`, { decision: 'cancelled' });
    await until(phaseIs('cancelled'), 'the cancel to be written down');
    await orchestrator.shutdown(2_000);
    await resumed.catch(() => {});
    expect(host.destroyed).toEqual([]);

    build(host);
    downFor = new Set();
    callbacks = [];
    await orchestrator.recover();
    await until(gone, 'the run to be forgotten');
    expect(events()).toEqual(['cancelled@1']);
    expect(host.destroyed).toEqual(['container-1']);
  });
});

describe('finishing, across a restart', () => {
  const finishing: PipelineSnapshot = {
    ...snapshot,
    pipeline: { ...snapshot.pipeline, steps: [snapshot.pipeline.steps[0] as never] },
  };

  test('a merge request already opened is not opened again', async () => {
    build(new FakeHost(), true);
    downFor = new Set(['mr_opened']); // the mr_opened delivery cannot get through …
    await call('POST', `/runs/${base.run_id}/execute`, finishing);
    await until(
      async () => (await states.get(base.run_id))?.mergeRequestUrl === OPENED,
      'the merge request to be written down',
    );
    expect(providerPosts).toBe(1);
    await orchestrator.shutdown(2_000);

    // … and the runner restarts with the application back.
    build(host);
    downFor = new Set();
    callbacks = [];
    await orchestrator.recover();
    await until(gone, 'the run to finish');
    expect(providerPosts).toBe(1);
    expect(events()).toEqual(['mr_opened@1', 'done@1']);
    const done = callbacks[1] as Callback & { merge_request_url: string };
    expect(done.merge_request_url).toBe(OPENED);
  });

  test('a merge request the provider already has is used, not duplicated', async () => {
    build(new FakeHost());
    providerListed = ['https://gitlab.com/netgroup/shop-frontend/-/merge_requests/3'];
    await call('POST', `/runs/${base.run_id}/execute`, finishing);
    await until(gone, 'the run to finish');
    expect(providerPosts).toBe(0);
    const done = callbacks.at(-1) as Callback & { merge_request_url: string };
    expect(done.merge_request_url).toContain('/merge_requests/3');
  });
});

describe('an edit at a checkpoint that names a path outside the workspace', () => {
  test('is refused with 400, and the run keeps waiting', async () => {
    build(new FakeHost());
    await call('POST', `/runs/${base.run_id}/execute`, snapshot);
    await until(phaseIs('waiting_approval'), 'the checkpoint');
    const refused = await call('POST', `/runs/${base.run_id}/resume`, {
      decision: 'edited',
      edited_paths: ['../../.ssh/authorized_keys'],
      edited_documents: { '../../.ssh/authorized_keys': 'ssh-ed25519 AAAA' },
    });
    expect(refused.status).toBe(400);
    expect((await states.get(base.run_id))?.phase).toBe('waiting_approval');
    expect([...host.files.keys()].some((p) => p.includes('authorized_keys'))).toBe(false);
  });
});
