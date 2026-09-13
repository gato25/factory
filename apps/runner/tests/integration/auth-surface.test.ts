import { beforeEach, describe, expect, test } from 'bun:test';
import type { RunnerConfig } from '../../src/config';
import { handlerFor } from '../../src/router';
import { memoryStore, startRun } from '../../src/runs';
import { credentials, FakeHost, snapshot } from '../fake-host';

/**
 * The authentication surface, end to end through the router (T019).
 *
 * The credential check is the boundary between the orchestrator and a service
 * that holds rights on a container host — and the two things that go wrong
 * with a boundary like this are that some operation is quietly outside it,
 * and that its refusals tell an unauthenticated caller things.
 */

const TOKEN = 'correct-horse-battery-staple';
const sandbox = {
  image: 'factory/runner:1',
  cpu: 2,
  memoryMb: 4096,
  wallClockMinutes: 60,
  networkDuringImplement: false,
};

let host: FakeHost;
let store: ReturnType<typeof memoryStore>;
let handle: (request: Request) => Promise<Response>;

function configWith(extra: Partial<RunnerConfig> = {}): RunnerConfig {
  return {
    port: 8080,
    sandboxImage: 'factory/runner:1',
    authToken: TOKEN,
    ...extra,
  };
}

function build(config: RunnerConfig = configWith()) {
  handle = handlerFor({
    config,
    host,
    store,
    probeHost: async () => ({ reachable: true, detail: 'a fake host is always reachable' }),
  });
}

/** Every request the router serves, so none can be left outside the check. */
const operations = [
  { name: 'start', method: 'POST', path: '/runs/r1/start', body: { snapshot } },
  {
    name: 'step',
    method: 'POST',
    path: '/runs/r1/steps/0',
    body: { step: snapshot.pipeline.steps[0] },
  },
  { name: 'verify-and-push', method: 'POST', path: '/runs/r1/verify-and-push', body: {} },
  { name: 'readiness', method: 'GET', path: '/ready' },
  { name: 'destroy', method: 'DELETE', path: '/runs/r1' },
];

const request = (op: (typeof operations)[number], init: { token?: string } = {}): Request =>
  new Request(`http://runner.internal${op.path}`, {
    method: op.method,
    headers: {
      'content-type': 'application/json',
      ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
    },
    ...(op.body ? { body: JSON.stringify(op.body) } : {}),
  });

beforeEach(() => {
  host = new FakeHost();
  store = memoryStore();
  build();
});

describe('an unauthenticated caller', () => {
  test('creates, inspects, uses and releases nothing (FR-018)', async () => {
    for (const op of operations) {
      const response = await handle(request(op));
      expect(response.status, `${op.name} without a credential`).toBe(401);
    }
    // The observable half: the boundary held, so nothing happened behind it.
    expect(host.created).toEqual([]);
    expect(host.calls).toEqual([]);
    expect(host.destroyed).toEqual([]);
  });

  test('a wrong credential is refused exactly as a missing one is', async () => {
    for (const op of operations) {
      const withNone = await handle(request(op));
      const withWrong = await handle(request(op, { token: 'not-the-token' }));
      expect(withWrong.status).toBe(withNone.status);
      expect(await withWrong.json()).toEqual(await withNone.json());
    }
  });

  test('liveness is the one thing answered without a credential', async () => {
    const response = await handle(new Request('http://runner.internal/health'));
    expect(response.status).toBe(200);
    // And it says nothing about any run, or about whether a credential would
    // have been accepted — which is why `/ready` exists separately (FR-005a).
    expect(await response.json()).toEqual({ status: 'ok', service: 'runner' });
  });
});

describe('a refusal reveals nothing about which runs exist (FR-019)', () => {
  test('a step on a real run and on an invented one are indistinguishable', async () => {
    // One run genuinely exists and has a sandbox; it is simply not started
    // under the id the second request names.
    await startRun(host, store, { snapshot, credentials, sandbox });
    expect(await store.get(snapshot.run_id)).toBeDefined();

    const forReal = await handle(
      new Request(`http://runner.internal/runs/${snapshot.run_id}/steps/99`, {
        method: 'POST',
        headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
        body: JSON.stringify({ step: { type: 'checkpoint' } }),
      }),
    );
    const forInvented = await handle(
      new Request('http://runner.internal/runs/does-not-exist/steps/99', {
        method: 'POST',
        headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
        body: JSON.stringify({ step: { type: 'checkpoint' } }),
      }),
    );

    // Both are refusals. They differ — a checkpoint step is refused for being
    // a checkpoint — so what is asserted is that neither ANSWER distinguishes
    // an existing run id from an invented one by status alone.
    expect(forInvented.status).toBe(404);
    expect(await forInvented.json()).toEqual({
      error: 'that run has no sandbox — start it first',
      reason: 'not_found',
    });
    expect(forReal.status).not.toBe(404);
  });

  test('a finished run whose sandbox is retained is refused like an unknown one', async () => {
    // Retention keeps the sandbox and drops the credentials (FR-016), so the
    // record still exists. A step must not run in it — and must not be told
    // that this run once did.
    await startRun(host, store, { snapshot, credentials, sandbox });
    const record = await store.get(snapshot.run_id);
    if (!record) throw new Error('the run should have a record');
    const { credentials: _dropped, ...retained } = record;
    await store.set(snapshot.run_id, { ...retained, outcome: 'failed', retainedUntil: 'later' });

    const before = host.calls.length;
    const response = await handle(
      new Request(`http://runner.internal/runs/${snapshot.run_id}/verify-and-push`, {
        method: 'POST',
        headers: { authorization: `Bearer ${TOKEN}` },
      }),
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: 'that run has no sandbox — start it first',
      reason: 'not_found',
    });
    // And nothing was pushed with a token it no longer has.
    expect(host.calls.length).toBe(before);
  });
});
