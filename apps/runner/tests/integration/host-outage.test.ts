import { beforeEach, describe, expect, test } from 'bun:test';
import { type Callback, FactoryError, type PipelineSnapshot } from '@factory/shared';
import type { ContainerSpec, ExecOptions, ExecResult } from '../../src/container/host';
import { HOST_WAIT, Orchestrator } from '../../src/orchestrate/loop';
import { memoryStateStore, type StateStore } from '../../src/orchestrate/state';
import { memoryStore, type RunStore } from '../../src/runs';
import { snapshot as base, credentials, FakeHost } from '../fake-host';

/**
 * A run whose sandbox host stops answering waits for the host, rather than
 * failing at once with a sentence about the sandbox.
 *
 * A Docker daemon that restarts takes every container with it. The step
 * running at that moment loses its sandbox, and the replacement cannot be
 * made either, because the same daemon is still coming up. That used to be
 * `the sandbox is gone` and a failed run, for a fault in the machine.
 */

/**
 * A host that can be taken away and given back.
 *
 * The daemon goes away DURING the step: the first command the step runs is
 * where the sandbox is found to be gone, and until the host is back no
 * replacement can be made either. A sandbox this host has destroyed stays
 * gone, as a real one would.
 */
class OutageHost extends FakeHost {
  down = false;
  /** Take the host away at the step's first command. */
  loseAtNextStep = false;

  override async create(spec: ContainerSpec): Promise<string> {
    if (this.down) throw new FactoryError('sandbox_lost', 'could not create the sandbox');
    return super.create(spec);
  }

  override async exec(id: string, argv: string[], options?: ExecOptions): Promise<ExecResult> {
    if (this.loseAtNextStep && argv.join(' ').includes('claude')) {
      this.loseAtNextStep = false;
      this.down = true;
    }
    if (this.down) throw new FactoryError('sandbox_lost', 'the sandbox is gone');
    if (this.destroyed.includes(id)) {
      throw new FactoryError('sandbox_lost', `the sandbox ${id} is gone`);
    }
    return super.exec(id, argv, options);
  }
}

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

let host: OutageHost;
let store: RunStore;
let states: StateStore;
let orchestrator: Orchestrator;
let callbacks: Callback[];
/** What the host probe answers, per call; the host comes back when it says so. */
let probeAnswers: boolean[];
let probes: number;

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

function build(options: { probe: boolean; hostWait?: { budgetMs: number; pollMs: number } }) {
  host = new OutageHost();
  store = memoryStore();
  states = memoryStateStore();
  host.files.set('/work/docs/spec.md', '# Spec');
  host.responses = [{ match: 'claude', result: { stdout: '{"total_cost_usd":0.42}' } }];
  orchestrator = new Orchestrator({
    host,
    store,
    states,
    fetch: fakeFetch,
    publicBaseUrl: 'http://runner.test',
    sleep: async () => {},
    ...(options.probe
      ? {
          probeHost: async () => {
            const answer = probeAnswers[Math.min(probes, probeAnswers.length - 1)] ?? true;
            probes += 1;
            if (answer) host.down = false;
            return {
              reachable: answer,
              detail: answer ? 'docker 29.3.1' : 'the container host is not answering',
            };
          },
        }
      : {}),
    hostWait: options.hostWait ?? { budgetMs: 60_000, pollMs: 10_000 },
  });
}

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

/** Starts the run with the host up; the host goes away at the step's first command. */
async function startAndLoseTheHost() {
  host.loseAtNextStep = true;
  await orchestrator.execute({
    snapshot,
    sandbox: {
      image: 'factory/runner:1',
      cpu: 2,
      memoryMb: 4096,
      wallClockMinutes: 60,
      networkDuringImplement: true,
    },
  });
}

beforeEach(() => {
  callbacks = [];
  probes = 0;
  probeAnswers = [];
});

describe('a sandbox host that stops answering', () => {
  test('the run waits for it, and goes on in a replacement when it answers', async () => {
    build({ probe: true });
    // Down when asked, down, down, then back.
    probeAnswers = [false, false, false, true];
    await startAndLoseTheHost();

    await until(phaseIs('waiting_approval'), 'the checkpoint');
    expect(probes).toBe(4);
    // The lost sandbox was replaced once the host answered, and the run
    // reached its checkpoint as if nothing had happened.
    expect(host.created).toHaveLength(2);
    expect(events().at(-1)).toBe('waiting_approval@1');
    expect(callbacks.some((c) => c.event === 'failed')).toBe(false);
  });

  test('a host still silent when the wait is over fails the run, naming the host', async () => {
    build({ probe: true, hostWait: { budgetMs: 30_000, pollMs: 10_000 } });
    probeAnswers = [false];
    await startAndLoseTheHost();

    await until(gone, 'the run to fail');
    // One probe before waiting, then one per poll: 10, 20, 30 seconds.
    expect(probes).toBe(4);
    const failed = callbacks.at(-1) as Callback & { reason: string; detail: string };
    expect(failed.event).toBe('failed');
    expect(failed.reason).toBe('sandbox_lost');
    expect(failed.detail).toContain('The container host did not answer for 1 minutes');
    expect(failed.detail).toContain('the container host is not answering');
  });

  test('a sandbox lost while the host IS answering is the run’s own failure, at once', async () => {
    build({ probe: true });
    probeAnswers = [true];
    await startAndLoseTheHost();

    // The host says it is fine, so the loss is not an outage: no waiting.
    await until(gone, 'the run to fail');
    expect(probes).toBe(1);
    const failed = callbacks.at(-1) as Callback & { reason: string; detail: string };
    expect(failed.reason).toBe('sandbox_lost');
    expect(failed.detail).not.toContain('did not answer');
  });

  test('a host that offers no probe fails the run as before', async () => {
    build({ probe: false });
    await startAndLoseTheHost();
    await until(gone, 'the run to fail');
    expect((callbacks.at(-1) as Callback & { reason: string }).reason).toBe('sandbox_lost');
  });

  test('the default wait outlasts a daemon restart', () => {
    expect(HOST_WAIT.budgetMs).toBeGreaterThanOrEqual(2 * 60_000);
    expect(HOST_WAIT.pollMs).toBeLessThanOrEqual(30_000);
  });
});
