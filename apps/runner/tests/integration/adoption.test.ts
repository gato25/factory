import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Callback, PipelineSnapshot } from '@factory/shared';
import { killWorkingIn } from '../../src/container/process-host';
import { Orchestrator } from '../../src/orchestrate/loop';
import { memoryStateStore, type StateStore } from '../../src/orchestrate/state';
import { memoryStore, type RunStore } from '../../src/runs';
import { snapshot as base, credentials, FakeHost } from '../fake-host';

/**
 * A sandbox adopted after a restart is quiet before the step runs again.
 *
 * The runner's death killed the `docker exec` CLIENT of the step that was
 * running, not the agent inside the container. That agent went on working —
 * and spending — with nothing recording it, while the restarted runner
 * started the step again beside it: two agents in one workspace, one of them
 * invisible. Adoption now stops whatever is still running first.
 */

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
const sandbox = {
  image: 'factory/runner:1',
  cpu: 2,
  memoryMb: 4096,
  wallClockMinutes: 60,
  networkDuringImplement: true,
};

let host: FakeHost;
let store: RunStore;
let states: StateStore;
let orchestrator: Orchestrator;
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

function build(existing?: { states: StateStore; host: FakeHost }) {
  host = existing?.host ?? new FakeHost();
  store = memoryStore();
  states = existing?.states ?? memoryStateStore();
  host.files.set('/work/docs/spec.md', '# Spec');
  host.responses = [{ match: 'claude', result: { stdout: '{"total_cost_usd":0.42}' } }];
  orchestrator = new Orchestrator({
    host,
    store,
    states,
    fetch: fakeFetch,
    publicBaseUrl: 'http://runner.test',
    sleep: async () => {},
  });
}

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

/** Runs to the checkpoint, then rewinds the state to "mid-step" as a dead runner would leave it. */
async function dieMidStep() {
  await orchestrator.execute({ snapshot, sandbox });
  await until(phaseIs('waiting_approval'), 'the checkpoint');
  const state = await states.get(base.run_id);
  if (!state) throw new Error('no state');
  await states.set({ ...state, phase: 'stepping', index: 0, waitingAt: undefined });
}

beforeEach(() => {
  callbacks = [];
  build();
});

describe('adopting a sandbox after a restart', () => {
  test('stops what was still running in it before the step runs again', async () => {
    await dieMidStep();

    build({ states, host });
    host.leftover = 2; // the agent and its shell, still at work
    callbacks = [];
    await orchestrator.recover();
    await until(phaseIs('waiting_approval'), 'the checkpoint again');

    expect(host.adopted).toEqual(['container-1']);
    expect(host.quiesced).toEqual(['container-1']);
    // Quiet first, then the step: the stop precedes the re-run's first command.
    const stepStarted = callbacks.findIndex((c) => c.event === 'step_started');
    expect(stepStarted).toBeGreaterThan(-1);
    expect(events()).toEqual(['step_started@0', 'step_finished@0', 'waiting_approval@1']);
  });

  test('a sandbox that will not say what runs in it is still adopted', async () => {
    await dieMidStep();

    build({ states, host });
    host.quiesce = async () => {
      throw new Error('exec failed');
    };
    callbacks = [];
    await orchestrator.recover();
    await until(phaseIs('waiting_approval'), 'the checkpoint again');
    expect(host.adopted).toEqual(['container-1']);
    expect(events().at(-1)).toBe('waiting_approval@1');
  });

  test('a fresh sandbox is not quiesced: there is nothing in it yet', async () => {
    await orchestrator.execute({ snapshot, sandbox });
    await until(phaseIs('waiting_approval'), 'the checkpoint');
    expect(host.quiesced).toEqual([]);
  });
});

describe('the process host: what an earlier runner left working in a workspace', () => {
  let dir: string;
  let elsewhere: string;
  const spawned: ReturnType<typeof Bun.spawn>[] = [];

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'factory-ws-'));
    elsewhere = await mkdtemp(join(tmpdir(), 'factory-other-'));
  });
  afterEach(async () => {
    for (const proc of spawned) {
      try {
        proc.kill('SIGKILL');
      } catch {
        // already gone
      }
    }
    spawned.length = 0;
    await rm(dir, { recursive: true, force: true });
    await rm(elsewhere, { recursive: true, force: true });
  });

  test.skipIf(process.platform !== 'linux')(
    'is found by where it works, and killed; a process working elsewhere is not',
    async () => {
      const inside = Bun.spawn(['sleep', '300'], { cwd: dir, stdout: 'ignore', stderr: 'ignore' });
      const outside = Bun.spawn(['sleep', '300'], {
        cwd: elsewhere,
        stdout: 'ignore',
        stderr: 'ignore',
      });
      spawned.push(inside, outside);
      await new Promise((resolve) => setTimeout(resolve, 50));

      const stopped = await killWorkingIn(dir);
      expect(stopped).toBe(1);
      await inside.exited;
      expect(inside.killed || inside.exitCode !== null).toBe(true);
      // The other one is untouched.
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(outside.exitCode).toBeNull();
    },
  );

  test('a directory nothing works in stops nothing', async () => {
    expect(await killWorkingIn(dir)).toBe(0);
  });
});
