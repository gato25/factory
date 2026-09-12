import { beforeEach, describe, expect, test } from 'bun:test';
import type { RunnerConfig } from '../../src/config';
import { handlerFor } from '../../src/router';
import { memoryStore } from '../../src/runs';
import { credentials, FakeHost, snapshot } from '../fake-host';

/**
 * Every path out of a run ends with the sandbox released and the record gone
 * (T051, FR-002, FR-022, SC-003).
 *
 * This is the invariant the constitution gained in version 2.0.0, and hosting
 * is why it had to become an invariant rather than a nicety. A forgotten
 * container on a daemon the team administers is visible in `docker ps` and
 * costs a machine somebody already owns. A forgotten sandbox on a managed
 * service costs money per minute, on an account, until something releases it.
 *
 * So this file walks `data-model.md`'s state diagram exhaustively rather than
 * testing the happy path. Every arrow out of `running` is a test, and the one
 * arrow nothing here can drive — the alarm, which fires with no request made —
 * is asserted separately in `wall-clock.test.ts` because it belongs to the
 * platform rather than to any caller.
 */

const TOKEN = 'a-token';
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

const config: RunnerConfig = {
  port: 8080,
  sandboxImage: 'factory/runner:1',
  authToken: TOKEN,
  executionHost: 'docker',
};

const call = (method: string, path: string, body?: unknown) =>
  handle(
    new Request(`http://runner.internal${path}`, {
      method,
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
  );

const start = () =>
  call('POST', `/runs/${snapshot.run_id}/start`, { snapshot, credentials, sandbox });

beforeEach(() => {
  host = new FakeHost();
  store = memoryStore();
  host.files.set('/work/docs/spec.md', '# Spec');
  host.responses = [{ match: 'claude', result: { stdout: '{"total_cost_usd":0.42}' } }];
  handle = handlerFor({
    config,
    host,
    store,
    probeHost: async () => ({ reachable: true, detail: 'a fake host is always reachable' }),
  });
});

describe('every terminal outcome releases the sandbox and forgets the run', () => {
  // The three arrows out of `running` that a caller drives. `failed` with a
  // retention window is the fourth and is the next group, because it is the
  // one that does NOT release immediately.
  const outcomes: ('done' | 'cancelled' | 'failed')[] = ['done', 'cancelled', 'failed'];

  test.each(outcomes)('outcome=%s', async (outcome) => {
    await start();
    const response = await call('DELETE', `/runs/${snapshot.run_id}?outcome=${outcome}`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ released: true, retainedUntil: undefined });
    expect(host.destroyed).toEqual(['container-1']);
    // The record goes with it, which is what takes the credentials with it
    // (FR-016) — they are inside the record, so there is nothing left to leak.
    expect(await store.get(snapshot.run_id)).toBeUndefined();
  });

  test('an unrecognised outcome is treated as done rather than left running', async () => {
    // A caller sending something the Runner does not know must not leave a
    // sandbox alive. Defaulting to release is the safe direction: the worst
    // case is a sandbox released slightly early, against a sandbox that runs
    // for ever.
    await start();
    const response = await call('DELETE', `/runs/${snapshot.run_id}?outcome=exploded`);
    expect(((await response.json()) as { released: boolean }).released).toBe(true);
    expect(host.destroyed).toEqual(['container-1']);
  });

  test('a run that never started releases nothing and is not an error', async () => {
    // The orchestrator cleaning up after a failure that happened BEFORE the
    // sandbox existed. An error here would turn a handled failure into two.
    const response = await call('DELETE', '/runs/never-started?outcome=failed');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ released: false, retainedUntil: undefined });
    expect(host.destroyed).toEqual([]);
  });

  test('releasing twice is not an error and does not release twice', async () => {
    // A retrying orchestrator, or two paths both cleaning up. Recovery calls
    // destroy on a corpse by design.
    await start();
    await call('DELETE', `/runs/${snapshot.run_id}?outcome=done`);
    const again = await call('DELETE', `/runs/${snapshot.run_id}?outcome=done`);
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ released: false, retainedUntil: undefined });
    expect(host.destroyed).toEqual(['container-1']);
  });
});

describe('a sandbox is never reused', () => {
  test('a second run of the same ticket gets a fresh sandbox (FR-002, SC-002)', async () => {
    await start();
    await call('DELETE', `/runs/${snapshot.run_id}?outcome=failed`);

    // A second attempt at the same run id. It must not find the first
    // sandbox — a retry inheriting a half-finished workspace is how a run
    // succeeds for reasons nobody can reproduce.
    const second = await start();
    const { container_id } = (await second.json()) as { container_id: string };
    expect(container_id).toBe('container-2');
    expect(host.created).toHaveLength(2);
  });

  test('a failure during start leaves nothing running (C9)', async () => {
    host.createFails = true;
    const response = await start();
    expect(response.status).toBeGreaterThanOrEqual(400);
    // Nothing was created, so nothing needs releasing — and no record was
    // left behind pointing at a sandbox that does not exist.
    expect(host.created).toEqual([]);
    expect(await store.get(snapshot.run_id)).toBeUndefined();
  });
});
