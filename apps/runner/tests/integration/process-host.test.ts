import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FactoryError } from '@factory/shared';
import type { ContainerHost } from '../../src/container/host';
import { defaultWorkRoot, processHost } from '../../src/container/process-host';
import { TIMEOUT_EXIT_CODE } from '../../src/engines/limits';

/**
 * The process host, against the real filesystem and the real shell.
 *
 * This is the host a development machine runs on, so what it is held to here
 * is what a run actually depends on: that `/work` means this sandbox's own
 * directory wherever a path or a command says it, that the run's environment
 * reaches a command and the runner's own credentials do not, that a deadline
 * ends what it started, and that a sandbox past its ceiling or destroyed is
 * reported lost rather than empty.
 */

let root: string;
let clock: number;
let host: ContainerHost & { root: string };

const spec = {
  image: 'unused-by-this-host',
  cpu: 2,
  memoryMb: 4096,
  wallClockMinutes: 60,
  network: true,
  env: { GIT_TOKEN: 'glpat-from-the-run', CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat01-from-the-run' },
  workdir: '/work',
};

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'factory-process-host-'));
  clock = Date.parse('2026-09-17T09:00:00Z');
  host = processHost({
    root,
    now: () => clock,
    // The runner's own shell, with a credential in it that must not leak.
    env: { ...process.env, ANTHROPIC_API_KEY: 'sk-ant-the-developers-own-key', CLAUDECODE: '1' },
  });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true }).catch(() => {});
});

describe('a sandbox is a fresh directory', () => {
  test('created under the root, and removed by destroy', async () => {
    const id = await host.create(spec);
    expect(existsSync(join(root, id))).toBe(true);
    await host.destroy(id);
    expect(existsSync(join(root, id))).toBe(false);
  });

  test('the default root is under the home directory unless FACTORY_WORK_DIR says otherwise', () => {
    expect(defaultWorkRoot({})).toContain('.code-factory');
    expect(defaultWorkRoot({ FACTORY_WORK_DIR: 'D:/runs' })).toBe('D:/runs');
  });

  test('/work in a path is this sandbox’s directory', async () => {
    const id = await host.create(spec);
    await host.writeFile(id, '/work/docs/spec.md', '# spec');
    expect(await readFile(join(root, id, 'docs', 'spec.md'), 'utf8')).toBe('# spec');
    expect(await host.readFile(id, '/work/docs/spec.md')).toBe('# spec');
    expect(await host.stat(id, '/work/docs/spec.md')).toEqual({ size: 6 });
    expect(await host.readFile(id, '/work/docs/absent.md')).toBeNull();
    // A directory is not a document.
    expect(await host.stat(id, '/work/docs')).toBeNull();
    await host.destroy(id);
  });

  test('/work in a command is this sandbox’s directory too, and cwd follows it', async () => {
    const id = await host.create(spec);
    // The two shapes the modules above use: a path in argv, and a script.
    await host.exec(id, ['mkdir', '-p', '/work/.claude/agents']);
    const made = await host.exec(id, ['sh', '-c', 'echo made > /work/.claude/agents/spec.md'], {
      cwd: '/work',
    });
    expect(made.exitCode).toBe(0);
    expect(existsSync(join(root, id, '.claude', 'agents', 'spec.md'))).toBe(true);
    // Relative to the workspace, the way a step's own commands are.
    const here = await host.exec(id, ['sh', '-c', 'cat .claude/agents/spec.md'], { cwd: '/work' });
    expect(here.stdout.trim()).toBe('made');
    await host.destroy(id);
  });
});

describe('the environment a command sees', () => {
  test('carries the run’s credentials and not the runner’s own', async () => {
    const id = await host.create(spec);
    const seen = await host.exec(id, [
      'sh',
      '-c',
      'echo "git=$GIT_TOKEN oauth=$CLAUDE_CODE_OAUTH_TOKEN api=$ANTHROPIC_API_KEY cc=$CLAUDECODE"',
    ]);
    expect(seen.stdout.trim()).toBe(
      'git=glpat-from-the-run oauth=sk-ant-oat01-from-the-run api= cc=',
    );
    await host.destroy(id);
  });

  test('a command’s own env applies to that command only', async () => {
    const id = await host.create(spec);
    const first = await host.exec(id, ['sh', '-c', 'echo $STEP_ONLY'], {
      env: { STEP_ONLY: 'first' },
    });
    const second = await host.exec(id, ['sh', '-c', 'echo "[$STEP_ONLY]"']);
    expect(first.stdout.trim()).toBe('first');
    expect(second.stdout.trim()).toBe('[]');
    await host.destroy(id);
  });

  test('every argv element arrives as exactly one argument', async () => {
    const id = await host.create(spec);
    const awkward = ['a b', "it's", '$HOME', '`whoami`', 'x"; echo pwned; echo "'];
    const result = await host.exec(id, ['printf', '%s\n', ...awkward]);
    expect(result.stdout.split('\n').slice(0, -1)).toEqual(awkward);
    await host.destroy(id);
  });
});

describe('ceilings', () => {
  test('a command past its deadline is stopped and reports the timeout code', async () => {
    const id = await host.create(spec);
    const started = Date.now();
    const result = await host.exec(id, ['sleep', '30'], { timeoutMs: 800 });
    expect(result.exitCode).toBe(TIMEOUT_EXIT_CODE);
    expect(Date.now() - started).toBeLessThan(15_000);
    await host.destroy(id);
  });

  test('a sandbox past its wall-clock ceiling is lost, not empty', async () => {
    const id = await host.create({ ...spec, wallClockMinutes: 1 });
    await host.writeFile(id, '/work/present.md', 'x');
    clock += 61_000;
    let thrown: unknown;
    try {
      await host.readFile(id, '/work/present.md');
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(FactoryError);
    expect((thrown as FactoryError).reason).toBe('sandbox_lost');
    expect((thrown as FactoryError).message).toContain('lifetime ceiling');
  });

  test('a destroyed sandbox is lost, and destroying it again is fine', async () => {
    const id = await host.create(spec);
    await host.destroy(id);
    await host.destroy(id);
    await host.destroy('never-existed');
    await expect(host.exec(id, ['true'])).rejects.toMatchObject({ reason: 'sandbox_lost' });
  });
});

describe('what this host cannot do, it refuses', () => {
  test('a sandbox that must be off the network is refused before anything is made', async () => {
    let thrown: unknown;
    try {
      await host.create({ ...spec, network: false });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(FactoryError);
    expect((thrown as FactoryError).reason).toBe('invalid_input');
    expect((thrown as FactoryError).message).toContain('Settings');
  });

  test('nothing is published, so a launch would not find an address here', async () => {
    const id = await host.create({ ...spec, publish: [3000] });
    expect(await host.address(id, 3000)).toBeNull();
    await host.destroy(id);
  });
});

describe('what a step is allowed to see of the runner’s environment', () => {
  test('the runner’s own secrets never reach a step, whatever their names', async () => {
    const { inheritable } = await import('../../src/container/process-host');
    for (const name of [
      'SESSION_SECRET',
      'SECRET_ENCRYPTION_KEY',
      'RUNNER_AUTH_TOKEN',
      'RUNNER_AUTH_TOKEN_PREVIOUS',
      'DATABASE_URL',
      'GITHUB_CLIENT_SECRET',
      'GITLAB_CLIENT_SECRET',
      'ANTHROPIC_API_KEY',
      'SOME_FUTURE_SECRET',
    ]) {
      expect(inheritable(name)).toBe(false);
    }
  });

  test('what a process needs does: tools, home, locale, proxies, trust', async () => {
    const { inheritable } = await import('../../src/container/process-host');
    for (const name of [
      'PATH',
      'HOME',
      'LANG',
      'LC_ALL',
      'TMPDIR',
      'HTTPS_PROXY',
      'NODE_EXTRA_CA_CERTS',
      'XDG_CONFIG_HOME',
      'SystemRoot',
    ]) {
      expect(inheritable(name)).toBe(true);
    }
  });

  test('an operator may name more, and the denylist still wins', async () => {
    const { extraInheritable, inheritable } = await import('../../src/container/process-host');
    const extra = extraInheritable({
      FACTORY_STEP_ENV_ALLOW: 'NPM_CONFIG_REGISTRY, CI ,GIT_TOKEN',
    });
    expect(inheritable('NPM_CONFIG_REGISTRY', extra)).toBe(true);
    expect(inheritable('CI', extra)).toBe(true);
    // A credential the run supplies is the run's, never the runner's shell's.
    expect(inheritable('GIT_TOKEN', extra)).toBe(false);
  });

  test('a step sees the allowlisted variables and the run’s own, and none of the runner’s secrets', async () => {
    const leaky = processHost({
      root,
      now: () => clock,
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        SESSION_SECRET: 'the-web-apps-session-secret',
        SECRET_ENCRYPTION_KEY: 'the-key-that-seals-every-credential',
        RUNNER_AUTH_TOKEN: 'the-runners-own-token',
      },
    });
    const id = await leaky.create(spec);
    const printed = await leaky.exec(id, ['sh', '-c', 'env']);
    expect(printed.stdout).toContain('GIT_TOKEN=glpat-from-the-run');
    expect(printed.stdout).toMatch(/^PATH=/m);
    expect(printed.stdout).not.toContain('SESSION_SECRET');
    expect(printed.stdout).not.toContain('SECRET_ENCRYPTION_KEY');
    expect(printed.stdout).not.toContain('RUNNER_AUTH_TOKEN');
    await leaky.destroy(id);
  });
});

describe('a workspace path that leaves the workspace', () => {
  test('is refused before it touches the machine', async () => {
    const id = await host.create(spec);
    await expect(host.writeFile(id, '/work/../../escaped.txt', 'x')).rejects.toThrow(
      /leaves the workspace/,
    );
    await expect(host.readFile(id, '/work/../../../etc/hostname')).rejects.toThrow(
      /leaves the workspace/,
    );
    expect(existsSync(join(root, 'escaped.txt'))).toBe(false);
    // A path that stays inside, however it is spelt, is fine.
    await host.writeFile(id, '/work/docs/../notes.md', 'ok');
    expect(await host.readFile(id, '/work/notes.md')).toBe('ok');
    await host.destroy(id);
  });
});
