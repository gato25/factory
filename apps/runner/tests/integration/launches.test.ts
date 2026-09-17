import { beforeEach, describe, expect, test } from 'bun:test';
import type { RunnerConfig } from '../../src/config';
import { memoryLaunchStore, sweepLaunches } from '../../src/launch/launches';
import { handlerFor } from '../../src/router';
import { memoryStore } from '../../src/runs';
import { FakeHost } from '../fake-host';

/**
 * A ticket's branch, running (003 FR-001..FR-012), driven through the routes
 * against the fake host and a fake project that answers — or does not — on
 * its port.
 *
 * Time is injected. The start period, the idle period and the readiness poll
 * are all clocks, and a test that really waited two minutes to prove a
 * timeout would not be run.
 */

const TOKEN = 'a-token';
const config: RunnerConfig = {
  port: 8080,
  sandboxImage: 'factory/runner:1',
  executionHost: 'process',
  workDir: '/tmp/factory-tests',
  authToken: TOKEN,
};

let host: FakeHost;
let launches: ReturnType<typeof memoryLaunchStore>;
let handle: (request: Request) => Promise<Response>;
let clock: number;
/** Whether the fake project is listening. */
let listening: boolean;
let probes: string[];

const call = (method: string, path: string, body?: unknown) =>
  handle(
    new Request(`http://runner.internal${path}`, {
      method,
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
  );

const start = (extra: Record<string, unknown> = {}) =>
  call('POST', '/launches', {
    clone_url: 'https://gitlab.com/netgroup/shop-frontend.git',
    branch: 'factory/142-add-oauth',
    git_token: 'glpat-secret',
    sandbox: { image: 'factory/runner:1', cpu: 2, memory_mb: 4096, wall_clock_minutes: 90 },
    ...extra,
  });

/** The project's files, as the clone would leave them. */
function workspace(files: Record<string, string>) {
  for (const [path, content] of Object.entries(files)) host.files.set(`/work/${path}`, content);
}

beforeEach(() => {
  host = new FakeHost();
  launches = memoryLaunchStore();
  clock = Date.parse('2026-09-13T10:00:00Z');
  listening = true;
  probes = [];
  handle = handlerFor({
    config,
    host,
    store: memoryStore(),
    probeHost: async () => ({ reachable: true, detail: 'fake' }),
    launches,
    launchDeps: {
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
      fetch: async (url) => {
        probes.push(url);
        if (!listening) throw new Error('ECONNREFUSED');
        return new Response('hi', { status: 200 });
      },
      pollMs: 1000,
      startTimeoutMs: 120_000,
      idleMs: 30 * 60_000,
    },
  });
});

const finished = async (id: string) => {
  await launches.settled(id);
  const response = await call('GET', `/launches/${id}`);
  return (await response.json()) as {
    status: string;
    address: string | null;
    command: string | null;
    port: number | null;
    from: string | null;
    detail: string | null;
    log: string[];
  };
};

describe('starting', () => {
  test('answers at once with `starting`, and the work continues (D1)', async () => {
    workspace({
      'package.json': JSON.stringify({ scripts: { dev: 'vite' }, devDependencies: { vite: '6' } }),
    });
    const response = await start();
    expect(response.status).toBe(202);
    const body = (await response.json()) as { launch_id: string; status: string };
    expect(body.status).toBe('starting');
    expect(body.launch_id).toBeTruthy();

    const done = await finished(body.launch_id);
    expect(done.status).toBe('running');
  });

  test('detects the command from the workspace and publishes its port on loopback (FR-004, FR-006)', async () => {
    workspace({
      'package.json': JSON.stringify({ scripts: { dev: 'vite' }, devDependencies: { vite: '6' } }),
      'package-lock.json': '{}',
    });
    const { launch_id } = (await (await start()).json()) as { launch_id: string };
    const done = await finished(launch_id);

    expect(done.command).toBe('npm run dev -- --host 0.0.0.0 --port $PORT');
    expect(done.port).toBe(5173);
    expect(done.from).toContain('Vite');
    // The probe container read the files; the real one published the port.
    const real = host.created.at(-1);
    expect(real?.publish).toEqual([5173]);
    expect(real?.network).toBe(true);
    expect(done.address).toMatch(/^127\.0\.0\.1:\d+$/);
  });

  test('a command set on the repository runs as given, with no detection (FR-005)', async () => {
    workspace({ 'package.json': JSON.stringify({ scripts: { dev: 'vite' } }) });
    const { launch_id } = (await (
      await start({ command: 'node server.js', port: 8000 })
    ).json()) as {
      launch_id: string;
    };
    const done = await finished(launch_id);
    expect(done.command).toBe('node server.js');
    expect(done.port).toBe(8000);
    expect(done.from).toBe('set on the repository');
    // Exactly one container: nothing was created just to read files.
    expect(host.created).toHaveLength(1);
  });

  test('the credential reaches the clone as environment, never a file (FR-017)', async () => {
    workspace({ 'package.json': JSON.stringify({ scripts: { dev: 'x' } }) });
    const { launch_id } = (await (await start()).json()) as { launch_id: string };
    await finished(launch_id);
    const clone = host.calls.find((c) => c.argv.join(' ').includes('git clone'));
    expect(clone?.options?.env?.GIT_TOKEN).toBe('glpat-secret');
    expect(clone?.argv.join(' ')).not.toContain('glpat-secret');
    for (const content of host.files.values()) expect(content).not.toContain('glpat-secret');
  });

  test('the project is started detached, told where to listen', async () => {
    workspace({ 'package.json': JSON.stringify({ scripts: { dev: 'x' } }) });
    const { launch_id } = (await (await start({ command: 'npm run dev', port: 3000 })).json()) as {
      launch_id: string;
    };
    await finished(launch_id);
    const started = host.calls.find((c) => c.argv.join(' ').includes('nohup'));
    expect(started?.options?.env).toEqual({ PORT: '3000', HOST: '0.0.0.0' });
    expect(started?.argv.join(' ')).toContain("'npm run dev'");
    // The exit sentinel is what turns a crash on boot into a fast failure (D4).
    expect(started?.argv.join(' ')).toContain('launch.exit');
  });
});

describe('failing, with a reason a person can act on (FR-007, SC-002)', () => {
  test('a workspace this cannot run is refused before any port is published (FR-016)', async () => {
    workspace({ 'requirements.txt': 'flask' });
    const { launch_id } = (await (await start()).json()) as { launch_id: string };
    const done = await finished(launch_id);
    expect(done.status).toBe('failed');
    expect(done.detail).toContain('Python');
    expect(done.detail).toContain('Set a start command');
    // Only the probe container was made, and it was destroyed.
    expect(host.created).toHaveLength(1);
    expect(host.destroyed).toEqual(['container-1']);
  });

  test('nothing listening within the start period fails naming the port (FR-010)', async () => {
    workspace({ 'package.json': JSON.stringify({ scripts: { dev: 'x' } }) });
    listening = false;
    const { launch_id } = (await (await start({ command: 'npm run dev', port: 3000 })).json()) as {
      launch_id: string;
    };
    const done = await finished(launch_id);
    expect(done.status).toBe('failed');
    expect(done.detail).toContain('port 3000');
    expect(done.detail).toContain('0.0.0.0');
    // And the sandbox was released — a failed launch holds nothing (FR-002).
    expect(host.destroyed).toContain('container-1');
  });

  test('a project that exits before listening fails fast with its output (FR-009)', async () => {
    workspace({ 'package.json': JSON.stringify({ scripts: { dev: 'x' } }) });
    listening = false;
    // The start script wrote the sentinel and the log, as a crash would.
    host.files.set('/work/.factory/launch.exit', '1\n');
    host.files.set('/work/.factory/launch.log', 'Error: Cannot find module ./config\n');
    const { launch_id } = (await (await start({ command: 'node app.js', port: 3000 })).json()) as {
      launch_id: string;
    };
    const before = clock;
    const done = await finished(launch_id);
    expect(done.status).toBe('failed');
    expect(done.detail).toContain('exited with code 1');
    expect(done.detail).toContain('Cannot find module');
    // Seconds, not the whole start period.
    expect(clock - before).toBeLessThan(120_000);
  });

  test('a failed install is reported with the installer’s output', async () => {
    workspace({
      'package.json': JSON.stringify({ scripts: { dev: 'x' } }),
      'package-lock.json': '{}',
    });
    host.responses = [{ match: 'npm ci', result: { exitCode: 1 } }];
    host.files.set('/work/.factory/install.log', 'npm ERR! ERESOLVE unable to resolve\n');
    const { launch_id } = (await (await start()).json()) as { launch_id: string };
    const done = await finished(launch_id);
    expect(done.status).toBe('failed');
    expect(done.detail).toContain('npm ci');
    expect(done.detail).toContain('ERESOLVE');
  });

  test('a rejected credential is a credential problem, and says which repository', async () => {
    host.responses = [
      { match: 'git clone', result: { exitCode: 128, stderr: 'fatal: Authentication failed' } },
    ];
    const { launch_id } = (await (await start({ command: 'x', port: 3000 })).json()) as {
      launch_id: string;
    };
    const done = await finished(launch_id);
    expect(done.status).toBe('failed');
    expect(done.detail).toContain('access token was rejected');
  });

  test('a branch that was never pushed says so', async () => {
    host.responses = [
      {
        match: 'git clone',
        result: { exitCode: 128, stderr: 'fatal: Remote branch factory/142-add-oauth not found' },
      },
    ];
    const { launch_id } = (await (await start({ command: 'x', port: 3000 })).json()) as {
      launch_id: string;
    };
    const done = await finished(launch_id);
    expect(done.detail).toContain('is not on');
  });
});

describe('stopping and forgetting', () => {
  test('Stop destroys the container and answers idempotently (FR-002)', async () => {
    workspace({ 'package.json': JSON.stringify({ scripts: { dev: 'x' } }) });
    const { launch_id } = (await (await start({ command: 'x', port: 3000 })).json()) as {
      launch_id: string;
    };
    await finished(launch_id);

    const first = await call('DELETE', `/launches/${launch_id}`);
    expect(await first.json()).toEqual({ stopped: true });
    expect(host.destroyed).toEqual(['container-1']);

    const again = await call('DELETE', `/launches/${launch_id}`);
    expect(await again.json()).toEqual({ stopped: false });

    const looked = (await (await call('GET', `/launches/${launch_id}`)).json()) as {
      status: string;
      address: string | null;
    };
    expect(looked.status).toBe('stopped');
    expect(looked.address).toBeNull();
  });

  test('a launch nobody looks at for the idle period is stopped by the sweep (FR-011)', async () => {
    workspace({ 'package.json': JSON.stringify({ scripts: { dev: 'x' } }) });
    const { launch_id } = (await (await start({ command: 'x', port: 3000 })).json()) as {
      launch_id: string;
    };
    await finished(launch_id);

    const deps = { host, store: launches, now: () => clock, idleMs: 30 * 60_000 };
    clock += 29 * 60_000;
    expect(await sweepLaunches(deps)).toEqual([]);
    clock += 2 * 60_000;
    expect(await sweepLaunches(deps)).toEqual([launch_id]);

    const looked = (await (await call('GET', `/launches/${launch_id}`)).json()) as {
      status: string;
      detail: string;
    };
    expect(looked.status).toBe('stopped');
    expect(looked.detail).toContain('nobody looking');
  });

  test('looking at a launch counts as activity', async () => {
    workspace({ 'package.json': JSON.stringify({ scripts: { dev: 'x' } }) });
    const { launch_id } = (await (await start({ command: 'x', port: 3000 })).json()) as {
      launch_id: string;
    };
    await finished(launch_id);
    const deps = { host, store: launches, now: () => clock, idleMs: 30 * 60_000 };
    clock += 25 * 60_000;
    await call('GET', `/launches/${launch_id}`);
    clock += 25 * 60_000;
    // 50 minutes since start, but only 25 since somebody looked.
    expect(await sweepLaunches(deps)).toEqual([]);
  });

  test('a running launch whose container has gone reads as stopped by the ceiling (FR-012)', async () => {
    workspace({ 'package.json': JSON.stringify({ scripts: { dev: 'x' } }) });
    const { launch_id } = (await (await start({ command: 'x', port: 3000 })).json()) as {
      launch_id: string;
    };
    await finished(launch_id);
    // The container's own `sleep` ran out and Docker removed it.
    host.readFile = async () => {
      const { FactoryError } = await import('@factory/shared');
      throw new FactoryError('sandbox_lost', 'the sandbox is gone');
    };
    const looked = (await (await call('GET', `/launches/${launch_id}`)).json()) as {
      status: string;
      detail: string;
    };
    expect(looked.status).toBe('stopped');
    expect(looked.detail).toContain('lifetime');
  });

  test('an unknown launch is not found, and a bad port is refused', async () => {
    expect((await call('GET', '/launches/nope')).status).toBe(404);
    expect((await start({ port: 70000 })).status).toBe(400);
    expect((await call('POST', '/launches', { branch: 'x' })).status).toBe(400);
  });
});
