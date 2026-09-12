import { beforeEach, describe, expect, test } from 'bun:test';
import type { RunnerConfig } from '../../src/config';
import { handlerFor } from '../../src/router';
import { deadlineFor } from '../../src/run-object-state';
import { memoryStore, type RunRecord } from '../../src/runs';
import { credentials, FakeHost, snapshot } from '../fake-host';

/**
 * That a run's four requests address ONE sandbox and one workspace (T018,
 * FR-006, FR-008).
 *
 * This is the requirement the move to a hosted service put at risk. A daemon
 * kept the mapping in a process that outlived the requests; a Worker isolate
 * does not survive between them, so every one of the four operations has to
 * find the run's state somewhere it can be lost. The tests here drive the
 * routes, not the store, so they hold for whichever store is injected —
 * `memoryStore` here, one Durable Object per run in the Worker.
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

beforeEach(() => {
  host = new FakeHost();
  store = memoryStore();
  host.responses = [{ match: 'claude', result: { stdout: '{"total_cost_usd":0.42}' } }];
  handle = handlerFor({
    config,
    host,
    store,
    probeHost: async () => ({ reachable: true, detail: 'a fake host is always reachable' }),
  });
});

const start = () =>
  call('POST', `/runs/${snapshot.run_id}/start`, { snapshot, credentials, sandbox });

describe('one run, one sandbox', () => {
  test('start, step, verify-and-push and destroy all address the same sandbox (FR-006)', async () => {
    const started = await start();
    const { container_id } = (await started.json()) as { container_id: string };

    host.files.set('/work/docs/spec.md', '# Spec');
    expect(
      (
        await call('POST', `/runs/${snapshot.run_id}/steps/0`, {
          step: snapshot.pipeline.steps[0],
        })
      ).status,
    ).toBe(200);
    expect((await call('POST', `/runs/${snapshot.run_id}/verify-and-push`)).status).toBe(200);
    expect((await call('DELETE', `/runs/${snapshot.run_id}`)).status).toBe(200);

    // Every command the run issued went to the one container, and exactly one
    // was ever created. A mapping lost between requests would show up here as
    // a second sandbox, not as an error.
    expect(host.created).toHaveLength(1);
    expect(new Set(host.calls.map((c) => c.containerId))).toEqual(new Set([container_id]));
    expect(host.destroyed).toEqual([container_id]);
  });

  test('a document one step writes, a later step reads (FR-006)', async () => {
    await start();
    // The first step produces the specification the pipeline requires of it.
    host.files.set('/work/docs/spec.md', '# Spec\n\nGoogle OAuth sign-in.');
    const first = await call('POST', `/runs/${snapshot.run_id}/steps/0`, {
      step: snapshot.pipeline.steps[0],
    });
    expect(first.status).toBe(200);

    // A second step, a separate request, reads it back from the workspace —
    // which is only possible because the sandbox is the same one.
    const second = await call('POST', `/runs/${snapshot.run_id}/steps/1`, {
      step: { type: 'shell', condition: 'always', command: 'cat docs/spec.md' },
    });
    expect(second.status).toBe(200);

    // The second step's command was dispatched to the container the first step
    // ran in, and its working directory is that container's workspace. What a
    // fake host can prove ends here: that the two steps share a sandbox. That
    // the bytes actually survive in it is a real sandbox's answer, which is
    // T021's end-to-end test.
    const shellCall = host.calls.find((c) => c.argv.join(' ').includes('cat docs/spec.md'));
    expect(shellCall).toBeDefined();
    expect(host.created).toHaveLength(1);
    expect(new Set(host.calls.map((c) => c.containerId)).size).toBe(1);
  });

  test('a second start returns the existing sandbox rather than making another (FR-008)', async () => {
    const first = (await (await start()).json()) as { container_id: string };
    const second = (await (await start()).json()) as { container_id: string };

    expect(second.container_id).toBe(first.container_id);
    // The important assertion. A retrying caller — or two callers racing — must
    // not be able to leave a second container running that nobody will release,
    // which is a leak that costs money rather than an error somebody sees.
    expect(host.created).toHaveLength(1);
  });

  test('the record remembers which host the run started on (FR-025a)', async () => {
    await start();
    expect((await store.get(snapshot.run_id))?.executionHost).toBe('docker');
  });
});

describe('the wall-clock backstop', () => {
  const record = (wallClockMinutes: number | undefined): RunRecord => ({
    snapshot,
    credentials,
    sandbox: { ...sandbox, wallClockMinutes: wallClockMinutes as number },
    containerId: 'container-1',
  });

  test("falls due exactly at the administrator's ceiling (FR-009a)", () => {
    const now = Date.parse('2026-09-11T10:00:00.000Z');
    // 60 minutes means 60 minutes. Not the nearest allocation the execution
    // host happens to offer, in either direction: rounding up hands runs time
    // nobody granted them, rounding down stops them before their own limit.
    expect(deadlineFor(record(60), now)).toBe(Date.parse('2026-09-11T11:00:00.000Z'));
    expect(deadlineFor(record(45), now)).toBe(Date.parse('2026-09-11T10:45:00.000Z'));
    expect(deadlineFor(record(7), now)).toBe(Date.parse('2026-09-11T10:07:00.000Z'));
  });

  test('a missing or zero ceiling does not kill the run instantly', () => {
    // The failure this exists to prevent: a snapshot with no ceiling yielding a
    // deadline already in the past, so the alarm releases the sandbox before
    // the first step runs. A run given a few extra minutes is a far better
    // outcome than a run killed by an absent field.
    const now = Date.now();
    for (const ceiling of [undefined, 0, -5, Number.NaN]) {
      expect(deadlineFor(record(ceiling as number), now)).toBeGreaterThan(now);
    }
  });
});
