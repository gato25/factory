import { beforeEach, describe, expect, test } from 'bun:test';
import type { RunnerConfig } from '../../src/config';
import { handlerFor } from '../../src/router';
import { memoryStore } from '../../src/runs';
import { credentials, FakeHost, snapshot } from '../fake-host';

/**
 * A failed run's sandbox, kept for diagnosis (T052, FR-023, FR-086, D3).
 *
 * Three properties, and the second is the one that is easy to get wrong.
 *
 * 1. The sandbox stays for exactly the configured window and is then released.
 * 2. It loses its credentials **immediately** — not when the window closes.
 *    Retention exists so somebody can look at a workspace; nothing about
 *    looking at a workspace needs a live token, and a token left sitting in a
 *    record for a day is a token nobody is watching.
 * 3. A retained run is FINISHED. No step may run in it, and the refusal says
 *    nothing about the run having once existed (FR-007, FR-019).
 */

const TOKEN = 'a-token';
const sandbox = {
  image: 'factory/runner:1',
  cpu: 2,
  memoryMb: 4096,
  wallClockMinutes: 60,
  // True because these fixtures run agent steps, which reach the model from
  // inside the sandbox: the isolated combination is refused at the start.
  networkDuringImplement: true,
};

let host: FakeHost;
let store: ReturnType<typeof memoryStore>;
let handle: (request: Request) => Promise<Response>;

const config: RunnerConfig = {
  port: 8080,
  sandboxImage: 'factory/runner:1',
  executionHost: 'process',
  workDir: '/tmp/factory-tests',
  publicBaseUrl: 'http://runner.test',
  stateDir: '/tmp/factory-tests/state',
  authToken: TOKEN,
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

describe('a failed run with a retention window', () => {
  test('keeps its sandbox for exactly the configured window', async () => {
    await start();
    const before = Date.now();
    const response = await call(
      'DELETE',
      `/runs/${snapshot.run_id}?outcome=failed&retain_failed_hours=4`,
    );

    const body = (await response.json()) as { released: boolean; retainedUntil: string };
    expect(body.released).toBe(false);
    expect(host.destroyed).toEqual([]);

    // Four hours, to the second, from the moment the run ended.
    const until = Date.parse(body.retainedUntil);
    expect(until - before).toBeGreaterThanOrEqual(4 * 3_600_000 - 1_000);
    expect(until - before).toBeLessThanOrEqual(4 * 3_600_000 + 1_000);
  });

  test('loses its credentials immediately, not when the window closes (FR-016)', async () => {
    await start();
    expect((await store.get(snapshot.run_id))?.credentials).toBeDefined();

    await call('DELETE', `/runs/${snapshot.run_id}?outcome=failed&retain_failed_hours=4`);

    const retained = await store.get(snapshot.run_id);
    // The sandbox is still this run's, so the record stays — whatever sweeps
    // it up needs the container id.
    expect(retained?.containerId).toBe('container-1');
    expect(retained?.outcome).toBe('failed');
    expect(retained?.retainedUntil).toBeTruthy();
    // And the credentials are gone, which is the point.
    expect(retained?.credentials).toBeUndefined();
  });

  test('no credential value survives anywhere in the retained record', async () => {
    await start();
    await call('DELETE', `/runs/${snapshot.run_id}?outcome=failed&retain_failed_hours=24`);

    // Serialised and searched, rather than checking the one field: a token
    // copied into some other field would pass a field check and still be a
    // token sitting in the record for a day.
    const serialised = JSON.stringify(await store.get(snapshot.run_id));
    expect(serialised).not.toContain(credentials.gitToken);
    expect(serialised).not.toContain(credentials.modelKey);
  });

  test('is finished: no step may run in it, and the refusal gives nothing away', async () => {
    await start();
    await call('DELETE', `/runs/${snapshot.run_id}?outcome=failed&retain_failed_hours=4`);

    const before = host.calls.length;
    const step = await call('POST', `/runs/${snapshot.run_id}/steps/0`, {
      step: snapshot.pipeline.steps[0],
    });
    expect(step.status).toBe(404);
    // Worded identically to a run that never existed (FR-019).
    expect(await step.json()).toEqual({
      error: 'that run has no sandbox — start it first',
      reason: 'not_found',
    });
    expect(host.calls.length).toBe(before);

    // And a push cannot happen either, which is the one that would have
    // needed the credentials it no longer has.
    const push = await call('POST', `/runs/${snapshot.run_id}/verify-and-push`);
    expect(push.status).toBe(404);
  });
});

describe('a failed run with no retention window', () => {
  test('is released at once, like any other terminal outcome', async () => {
    // The default. Retention is opt-in, and a workspace that has not asked
    // for it should not accumulate sandboxes it is paying for.
    await start();
    const response = await call('DELETE', `/runs/${snapshot.run_id}?outcome=failed`);
    expect(await response.json()).toEqual({ released: true, retainedUntil: undefined });
    expect(host.destroyed).toEqual(['container-1']);
    expect(await store.get(snapshot.run_id)).toBeUndefined();
  });

  test('a retention window of zero hours is no retention, not an instant one', async () => {
    await start();
    const response = await call(
      'DELETE',
      `/runs/${snapshot.run_id}?outcome=failed&retain_failed_hours=0`,
    );
    expect(((await response.json()) as { released: boolean }).released).toBe(true);
  });
});

describe('retention applies only to failure', () => {
  test.each(['done', 'cancelled'] as const)(
    'a %s run is released even where the workspace retains failures',
    async (outcome) => {
      // Retention is for diagnosis. There is nothing to diagnose about a run
      // that succeeded, or one a person deliberately stopped, and keeping
      // those would multiply what the workspace pays for by every run it does.
      await start();
      const response = await call(
        'DELETE',
        `/runs/${snapshot.run_id}?outcome=${outcome}&retain_failed_hours=24`,
      );
      expect(((await response.json()) as { released: boolean }).released).toBe(true);
      expect(host.destroyed).toEqual(['container-1']);
    },
  );
});
