import { beforeEach, describe, expect, test } from 'bun:test';
import type { Callback, PipelineSnapshot } from '@factory/shared';
import type { RunnerConfig } from '../../src/config';
import { Orchestrator } from '../../src/orchestrate/loop';
import { memoryStateStore, type StateStore } from '../../src/orchestrate/state';
import { handlerFor } from '../../src/router';
import { memoryStore, type RunStore } from '../../src/runs';
import { snapshot as base, credentials, FakeHost } from '../fake-host';

/**
 * A run driven from its snapshot to its merge request by the runner itself
 * (contracts/orchestrator.md), against the fake host and a fake application.
 *
 * What the application sees is what it always saw — the same callbacks in
 * the same order, authenticated the same way — because the application did
 * not change when the orchestrator moved in here. What is new is that the
 * loop's position is written down, so the tests can stop the runner and start
 * another one on the same state.
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

/** Spec agent, a checkpoint, a shell step, and a design step that the run will skip. */
const snapshot: PipelineSnapshot = {
  ...base,
  pipeline: {
    ...base.pipeline,
    steps: [
      { type: 'agent', condition: 'always', agent_id: 'a-spec', output_files: ['docs/spec.md'] },
      { type: 'checkpoint', condition: 'always', approvers: 'anyone' },
      { type: 'shell', condition: 'always', command: 'npm test' },
      { type: 'design', condition: 'ticket_has_ui', agent_id: 'a-spec' },
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
/** Every callback the application received, in order, without the log noise. */
let callbacks: Callback[];
/** What the application answers to the next callbacks. */
let pausedReply: boolean;
let providerCalls: { url: string; body: unknown; headers: Record<string, string> }[];

/** The application, the providers, and nothing else. */
async function fakeFetch(url: string, init?: RequestInit): Promise<Response> {
  const method = init?.method ?? 'GET';
  const headers = Object.fromEntries(
    Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [
      k.toLowerCase(),
      v,
    ]),
  );
  if (url === base.callback_url) {
    expect(headers.authorization).toBe(`Bearer ${base.resume_secret}`);
    const callback = JSON.parse(String(init?.body)) as Callback;
    if (callback.event !== 'log_chunk') callbacks.push(callback);
    return Response.json({ applied: true, paused: pausedReply, continue: !pausedReply });
  }
  if (url.endsWith(`/api/runs/${base.run_id}/credentials`)) {
    // A design credential too: the pipeline carries a design step, and a run
    // with one is refused at start without it (FR-083b).
    return Response.json({ credentials: { ...credentials, designKey: 'pencil_cli_test_key' } });
  }
  if (url.endsWith(`/api/runs/${base.run_id}/merge-request`)) {
    return Response.json({
      title: 'Add Google OAuth sign-in (#142)',
      description: 'The body the application composed.',
      labels: ['factory'],
      source_branch: base.repo.branch,
      target_branch: base.repo.default_branch,
    });
  }
  if (url.startsWith('https://gitlab.com/api/v4/')) {
    providerCalls.push({ url, body: JSON.parse(String(init?.body)), headers, ...{ method } });
    return Response.json({
      web_url: 'https://gitlab.com/netgroup/shop-frontend/-/merge_requests/7',
    });
  }
  throw new Error(`unexpected request: ${method} ${url}`);
}

function build(existing?: { states: StateStore; host: FakeHost }) {
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

/** The loop runs on its own; a test waits for it to reach somewhere. */
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

beforeEach(() => {
  callbacks = [];
  providerCalls = [];
  pausedReply = false;
  build();
  host.files.set('/work/docs/spec.md', '# Spec');
  host.responses = [
    { match: 'claude', result: { stdout: '{"total_cost_usd":0.42,"num_turns":3}' } },
    { match: 'npm test', result: { stdout: '12 pass\n' } },
  ];
});

describe('a run, start to merge request', () => {
  test('runs, waits at the checkpoint, and on approval finishes with a merge request', async () => {
    const accepted = await call('POST', `/runs/${base.run_id}/execute`, snapshot);
    expect(accepted.status).toBe(202);

    await until(phaseIs('waiting_approval'), 'the checkpoint');
    expect(events()).toEqual([
      'started@0',
      'step_started@0',
      'step_finished@0',
      'waiting_approval@1',
    ]);
    const finished = callbacks[2] as Callback & {
      status: string;
      cost_usd: string;
      artifacts: unknown[];
    };
    expect(finished.status).toBe('done');
    expect(finished.cost_usd).toBe('0.4200');
    expect(finished.artifacts).toEqual([{ kind: 'document', path: 'docs/spec.md', version: 1 }]);
    const waiting = callbacks[3] as Callback & { resume_url: string };
    expect(waiting.resume_url).toBe(`http://runner.test/runs/${base.run_id}/resume`);

    // A second trigger while waiting changes nothing.
    expect((await call('POST', `/runs/${base.run_id}/execute`, snapshot)).status).toBe(409);

    // The person approves, at the address the application was given.
    const resumed = await call('POST', `/runs/${base.run_id}/resume`, { decision: 'approved' });
    expect(resumed.status).toBe(200);

    await until(gone, 'the run to finish');
    expect(events()).toEqual([
      'started@0',
      'step_started@0',
      'step_finished@0',
      'waiting_approval@1',
      'step_started@2',
      'step_finished@2',
      // The design step's condition does not hold: skipped, never a failure.
      'step_skipped@3',
      'mr_opened@4',
      'done@4',
    ]);
    const skipped = callbacks[6] as Callback & { condition_not_met: string };
    expect(skipped.condition_not_met).toBe('ticket has no UI change');
    const done = callbacks[8] as Callback & { merge_request_url: string; cost_usd: string };
    expect(done.merge_request_url).toContain('/merge_requests/7');
    expect(done.cost_usd).toBe('0.4200');

    // The merge request was opened on the provider with the application's body
    // and the run's own token, and the sandbox was released.
    expect(providerCalls).toHaveLength(1);
    expect(providerCalls[0]?.url).toBe(
      'https://gitlab.com/api/v4/projects/netgroup%2Fshop-frontend/merge_requests',
    );
    expect(providerCalls[0]?.headers['private-token']).toBe(credentials.gitToken);
    expect(providerCalls[0]?.body).toMatchObject({
      source_branch: base.repo.branch,
      target_branch: 'main',
      title: 'Add Google OAuth sign-in (#142)',
    });
    expect(host.destroyed).toEqual(['container-1']);
  });

  test('a step that fails ends the run, tells the application why, and releases the sandbox', async () => {
    host.responses = [
      { match: 'claude', result: { exitCode: 1, stderr: 'Request timed out', stdout: '{}' } },
    ];
    await call('POST', `/runs/${base.run_id}/execute`, snapshot);
    await until(gone, 'the run to fail');
    expect(events()).toEqual(['started@0', 'step_started@0', 'step_finished@0', 'failed@0']);
    const failed = callbacks[3] as Callback & { reason: string; detail: string };
    expect(failed.reason).toBe('command_failed');
    expect(failed.detail).toContain('Request timed out');
    expect(host.destroyed).toEqual(['container-1']);
    expect(providerCalls).toHaveLength(0);
  });

  test('a ceiling reached after a step fails the run, naming the ceiling (FR-081)', async () => {
    const tight = { ...snapshot, limits: { cost_ceiling_usd: '0.1000', time_ceiling_minutes: 45 } };
    await call('POST', `/runs/${base.run_id}/execute`, tight);
    await until(gone, 'the run to fail');
    const failed = callbacks.at(-1) as Callback & { reason: string; detail: string };
    expect(failed.event).toBe('failed');
    expect(failed.reason).toBe('budget_exceeded');
    expect(failed.detail).toContain('$0.1000');
  });
});

describe('a pause (FR-096)', () => {
  test('the step that was running concludes, nothing further begins, and a withdrawal continues', async () => {
    pausedReply = true;
    await call('POST', `/runs/${base.run_id}/execute`, snapshot);
    await until(phaseIs('paused'), 'the pause');
    expect(events()).toEqual(['started@0', 'step_started@0', 'step_finished@0', 'paused@1']);
    expect(host.calls.filter((c) => c.argv.join(' ').includes('npm test'))).toHaveLength(0);

    pausedReply = false;
    await call('POST', `/runs/${base.run_id}/resume`, { paused: false });
    await until(phaseIs('waiting_approval'), 'the checkpoint after the pause');
    expect(events().at(-1)).toBe('waiting_approval@1');
  });
});

describe('a change request at a checkpoint (FR-061)', () => {
  test('re-runs the preceding step with the feedback, then returns to the same checkpoint', async () => {
    await call('POST', `/runs/${base.run_id}/execute`, snapshot);
    await until(phaseIs('waiting_approval'), 'the checkpoint');
    callbacks = [];

    await call('POST', `/runs/${base.run_id}/resume`, {
      decision: 'changes_requested',
      feedback: 'Name the OAuth scopes.',
    });
    await until(async () => events().includes('waiting_approval@1'), 'the checkpoint again');
    expect(events()).toEqual(['step_started@0', 'step_finished@0', 'waiting_approval@1']);
    // The reviewer's words were put where the agent reads them (FR-038).
    expect(host.files.get('/work/.factory/feedback.md')).toContain('Name the OAuth scopes.');
  });

  test('a cancellation at the checkpoint releases the sandbox and says so', async () => {
    await call('POST', `/runs/${base.run_id}/execute`, snapshot);
    await until(phaseIs('waiting_approval'), 'the checkpoint');
    await call('POST', `/runs/${base.run_id}/resume`, { decision: 'cancelled' });
    await until(gone, 'the run to be forgotten');
    expect(events().at(-1)).toBe('cancelled@1');
    expect(host.destroyed).toEqual(['container-1']);
  });
});

describe('a restart of the runner', () => {
  test('a run waiting at a checkpoint keeps waiting, and continues in its own sandbox', async () => {
    await call('POST', `/runs/${base.run_id}/execute`, snapshot);
    await until(phaseIs('waiting_approval'), 'the checkpoint');

    // A new runner: nothing in memory but the files on disk and the host.
    build({ states, host });
    const picked = await orchestrator.recover();
    expect(picked).toEqual({ resumed: [], waiting: [base.run_id] });

    callbacks = [];
    await call('POST', `/runs/${base.run_id}/resume`, { decision: 'approved' });
    await until(gone, 'the run to finish');
    // The sandbox the first runner made was adopted, not rebuilt.
    expect(host.adopted).toEqual(['container-1']);
    expect(host.created).toHaveLength(1);
    expect(events().at(-1)).toBe('done@4');
  });

  test('a run that was mid-step is driven again from that step', async () => {
    await call('POST', `/runs/${base.run_id}/execute`, snapshot);
    await until(phaseIs('waiting_approval'), 'the checkpoint');
    // Pretend the runner died just after the checkpoint was approved.
    const state = await states.get(base.run_id);
    if (!state) throw new Error('no state');
    await states.set({ ...state, phase: 'stepping', index: 2, waitingAt: undefined });

    build({ states, host });
    callbacks = [];
    const picked = await orchestrator.recover();
    expect(picked.resumed).toEqual([base.run_id]);
    await until(gone, 'the run to finish');
    expect(events()).toEqual([
      'step_started@2',
      'step_finished@2',
      'step_skipped@3',
      'mr_opened@4',
      'done@4',
    ]);
  });

  test('a sandbox the host no longer has is rebuilt, and the run goes on', async () => {
    await call('POST', `/runs/${base.run_id}/execute`, snapshot);
    await until(phaseIs('waiting_approval'), 'the checkpoint');

    build({ states, host });
    host.adoptFails = true;
    await orchestrator.recover();
    callbacks = [];
    await call('POST', `/runs/${base.run_id}/resume`, { decision: 'approved' });
    await until(gone, 'the run to finish');
    expect(host.created).toHaveLength(2);
    expect(events().at(-1)).toBe('done@4');
  });
});

describe('the application releasing a run', () => {
  test('a cancelled run is not rebuilt and not reported on', async () => {
    await call('POST', `/runs/${base.run_id}/execute`, snapshot);
    await until(phaseIs('waiting_approval'), 'the checkpoint');
    const released = await call('DELETE', `/runs/${base.run_id}?outcome=cancelled`);
    expect(released.status).toBe(200);
    expect(await states.get(base.run_id)).toBeUndefined();
    const resumed = await call('POST', `/runs/${base.run_id}/resume`, { decision: 'approved' });
    expect(resumed.status).toBe(404);
  });
});

describe('where a run is', () => {
  test('is readable while it runs, without the snapshot', async () => {
    await call('POST', `/runs/${base.run_id}/execute`, snapshot);
    await until(phaseIs('waiting_approval'), 'the checkpoint');
    const shown = (await (
      await call('GET', `/runs/${base.run_id}/orchestration`)
    ).json()) as Record<string, unknown>;
    expect(shown.phase).toBe('waiting_approval');
    expect(shown.index).toBe(1);
    expect(shown.spentUsd).toBe(0.42);
    expect(shown.snapshot).toBeUndefined();
  });
});
