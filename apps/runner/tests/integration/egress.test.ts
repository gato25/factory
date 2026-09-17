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

/**
 * What a pipeline with agent steps must be given.
 *
 * `snapshot`'s first step is an agent step, and an agent step reaches the
 * model from inside the sandbox — so this is not a permissive choice made for
 * the tests' convenience, it is the only setting under which such a pipeline
 * can start at all. The runner refuses the other combination outright, and
 * the last describe in this file is about that.
 */
const sandbox = {
  image: 'factory/runner:1',
  cpu: 2,
  memoryMb: 4096,
  wallClockMinutes: 60,
  networkDuringImplement: true,
};

/** The same sandbox, cut off — which only a pipeline of shell steps may use. */
const isolated = { ...sandbox, networkDuringImplement: false };

/** A pipeline that needs nothing outside the container. */
const shellOnly = {
  ...snapshot,
  pipeline: {
    ...snapshot.pipeline,
    steps: [{ type: 'shell' as const, condition: 'always' as const, command: 'npm test' }],
  },
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
    expect(host.created[0]?.network).toBe(true);

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

    // The fake host does not annotate, so what is proven here is that the
    // detection itself recognises the shape a real tool produced.
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

/**
 * When the restriction is applied, and why not at creation.
 *
 * A sandbox is prepared by cloning the repository FROM INSIDE IT, so a
 * container created with `--network none` cannot be prepared: the clone
 * cannot resolve a hostname. With the default setting — no network while code
 * is written — that meant no run could ever start. The runner reported
 * `Could not clone …` with reason `sandbox_lost`, which reads as a broken
 * sandbox rather than as a restriction applied one step too early.
 *
 * So the network is given, the clone uses it, and then it is taken away —
 * still before any step runs, which is what FR-085 actually asks for.
 */
describe('the network is taken away after the clone, not withheld before it', () => {
  test('a sandbox that must be isolated is disconnected once, during start', async () => {
    await call('POST', `/runs/${snapshot.run_id}/start`, {
      snapshot: shellOnly,
      credentials,
      sandbox: isolated,
    });

    expect(host.created).toHaveLength(1);
    // The intent is still recorded on the spec…
    expect(host.created[0]?.network).toBe(false);
    // …and carried out, once, on the container that was just prepared — after
    // the clone, which is the thing that needed the network in the first place.
    expect(host.disconnected).toEqual(['container-1']);
  });

  test('a sandbox allowed the network is left connected', async () => {
    await call('POST', `/runs/${snapshot.run_id}/start`, { snapshot, credentials, sandbox });
    expect(host.disconnected).toEqual([]);
  });

  test('a restriction that could not be applied fails the start', async () => {
    // The dangerous outcome is not "the start failed" — it is arbitrary code
    // running in a connected sandbox in a workspace that asked for the
    // opposite. So this must not be swallowed.
    host.disconnectFails = true;
    const response = await call('POST', `/runs/${snapshot.run_id}/start`, {
      snapshot: shellOnly,
      credentials,
      sandbox: isolated,
    });

    expect(response.status).toBeGreaterThanOrEqual(400);
    // And nothing is left running that the workspace did not want running.
    expect(host.destroyed).toEqual(['container-1']);
  });
});

/**
 * The combination that cannot work is refused, not attempted.
 *
 * An agent step is an outbound call to the model, made from inside the
 * sandbox. Isolating the sandbox does not make that step run offline; it
 * makes it hang until the CLI gives up — `Request timed out`, zero tokens,
 * zero cost, three minutes gone — which reads as a slow model rather than as
 * a setting three screens away.
 */
describe('a pipeline that needs the model in a sandbox that has no network', () => {
  test('is refused at the start, naming the setting', async () => {
    const response = await call('POST', `/runs/${snapshot.run_id}/start`, {
      snapshot,
      credentials,
      sandbox: isolated,
    });
    expect(response.status).toBeGreaterThanOrEqual(400);
    const body = (await response.json()) as { error?: string };
    expect(body.error).toContain('reach the network');

    // And nothing was built: no sandbox to clean up, no three-minute wait.
    expect(host.created).toHaveLength(0);
  });

  test('is allowed once the sandbox may reach the network', async () => {
    const response = await call('POST', `/runs/${snapshot.run_id}/start`, {
      snapshot,
      credentials,
      sandbox,
    });
    expect(response.status).toBeLessThan(400);
    expect(host.created).toHaveLength(1);
  });

  test('a pipeline of shell steps only is still allowed to be isolated', async () => {
    const response = await call('POST', `/runs/${snapshot.run_id}/start`, {
      snapshot: shellOnly,
      credentials,
      sandbox: isolated,
    });
    expect(response.status).toBeLessThan(400);
    // Built, and then cut off — which is what the setting is actually for.
    expect(host.disconnected).toEqual(['container-1']);
  });
});

/**
 * Where nothing can be isolated, the setting is not a refusal.
 *
 * Runs on a development machine execute as processes, and a process cannot be
 * cut off from the network. The default setting asks for exactly that, so the
 * first ticket on every fresh install was refused for a reason nothing on the
 * machine could satisfy. The host says it cannot isolate; the run proceeds
 * connected and the log says so, which is the honest version of the setting.
 */
describe('a host that cannot isolate', () => {
  test('starts an agent pipeline connected instead of refusing it', async () => {
    (host as { isolates?: boolean }).isolates = false;
    const response = await call('POST', `/runs/${snapshot.run_id}/start`, {
      snapshot,
      credentials,
      sandbox: isolated,
    });
    expect(response.status).toBeLessThan(400);
    expect(host.created).toHaveLength(1);
    expect(host.created[0]?.network).toBe(true);
    expect(host.disconnected).toEqual([]);
  });
});
