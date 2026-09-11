import { beforeEach, describe, expect, test } from 'bun:test';
import type { RunnerConfig } from '../../src/config';
import { annotateUnreachable } from '../../src/container/unreachable';
import { handlerFor } from '../../src/router';
import { memoryStore } from '../../src/runs';
import { credentials, FakeHost, snapshot } from '../fake-host';

/**
 * What network reach a run's steps have, and how a step that could not reach
 * something reports it (T036, FR-011, FR-013).
 *
 * **This file was rewritten after T006, and the rewrite is the finding.** It
 * used to assert that an agent step ran with outbound reach narrowed to a
 * permitted set and other steps ran unrestricted. That cannot be enforced on
 * the managed host: its allow and deny lists govern only traffic routed through
 * the provider's own proxy, not sockets a process opens for itself — and an
 * agent step runs arbitrary code, which opens its own. So the requirement
 * became all-or-nothing, stated honestly, and these tests assert the
 * consequence: every step of a run has the SAME reach, because there is no
 * mechanism to vary it and a test claiming otherwise would be asserting a
 * comforting fiction.
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
  host.files.set('/work/docs/spec.md', '# Spec');
  host.responses = [{ match: 'claude', result: { stdout: '{"total_cost_usd":0.42}' } }];
  handle = handlerFor({
    config,
    host,
    store,
    probeHost: async () => ({ reachable: true, detail: 'a fake host is always reachable' }),
  });
});

describe('reach is established once, for the sandbox’s life (FR-011)', () => {
  test('it is decided at creation and nothing per-step touches it', async () => {
    await call('POST', `/runs/${snapshot.run_id}/start`, { snapshot, credentials, sandbox });

    // One decision, recorded once, on the spec the sandbox was created with.
    expect(host.created).toHaveLength(1);
    expect(host.created[0]?.network).toBe(false);

    // Then two steps of different kinds, and neither re-creates a sandbox or
    // is given any reach of its own. `ExecOptions` has no network field at
    // all, which is what makes this structural rather than a convention.
    await call('POST', `/runs/${snapshot.run_id}/steps/0`, {
      step: snapshot.pipeline.steps[0],
    });
    await call('POST', `/runs/${snapshot.run_id}/steps/1`, {
      step: { type: 'shell', condition: 'always', command: 'npm test' },
    });

    expect(host.created).toHaveLength(1);
    for (const executed of host.calls) {
      expect(Object.keys(executed.options ?? {})).not.toContain('network');
    }
  });

  test('an agent step reaches the model service, which is why reach cannot be removed', async () => {
    // Why all-or-nothing had to be the answer rather than "restrict the agent
    // step". An agent step IS a call to a model service — the command carries
    // the credential for one — so a sandbox with no outbound reach cannot run
    // one. Restricting it to nothing would not secure the step, it would
    // prevent it.
    expect(snapshot.pipeline.steps[0]?.type).toBe('agent');
    await call('POST', `/runs/${snapshot.run_id}/start`, { snapshot, credentials, sandbox });
    await call('POST', `/runs/${snapshot.run_id}/steps/0`, {
      step: snapshot.pipeline.steps[0],
    });

    // The model credential reaches the sandbox as environment, which is the
    // observable form of "this step talks to a service over the network".
    expect(Object.keys(host.created[0]?.env ?? {})).toContain('ANTHROPIC_API_KEY');
    const agentCall = host.calls.find((executed) => executed.argv.includes('claude'));
    expect(agentCall).toBeDefined();
  });

  test('the managed host declares reach on the container class, not per step', async () => {
    const worker = await Bun.file('apps/runner/src/worker.ts').text();
    expect(worker).toContain('override enableInternet: boolean = true');
    // And it is stated, not inherited: a library version that flipped the
    // default would break every model-driven step with a failure that looks
    // like the model being down.
    expect(worker).toContain('flipped');
  });
});

describe('a step that could not reach something names it (FR-013)', () => {
  test('the address appears in what the step reports', async () => {
    host.responses = [
      {
        match: 'npm',
        result: {
          exitCode: 1,
          stderr: 'npm ERR! code ENOTFOUND\nnpm ERR! getaddrinfo ENOTFOUND registry.npmjs.org',
        },
      },
    ];
    await call('POST', `/runs/${snapshot.run_id}/start`, { snapshot, credentials, sandbox });
    const response = await call('POST', `/runs/${snapshot.run_id}/steps/0`, {
      step: { type: 'shell', condition: 'always', command: 'npm install' },
    });
    expect(response.status).toBe(200);

    // The fake host does not annotate — only the managed host does, where the
    // failure mode is new — so what is proven here is that the detection
    // itself recognises the shape a real tool produced.
    const annotated = annotateUnreachable(
      'npm ERR! code ENOTFOUND\nnpm ERR! getaddrinfo ENOTFOUND registry.npmjs.org',
    );
    expect(annotated).toContain('this step could not reach registry.npmjs.org');
  });

  test('an ordinary step failure is not dressed up as a network problem', async () => {
    // The other half, and the one that keeps the first half worth reading. A
    // failing test suite must not be reported as an unreachable dependency,
    // or the annotation becomes noise nobody trusts.
    const ordinary = 'FAIL src/auth.test.ts\n  ● expected 2 to equal 3';
    expect(annotateUnreachable(ordinary)).toBe(ordinary);
  });
});
