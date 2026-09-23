import { describe, expect, test } from 'bun:test';
import type { SnapshotAgent, Step } from '@factory/shared';
import type { ContainerHost, ContainerSpec, ExecResult } from '../../src/container/host';
import { isolatingHost, mountSource, needsIsolation } from '../../src/container/isolate';
import { runClaudeStep } from '../../src/engines/claude-cli';
import { LogSink } from '../../src/stream/logs';
import { FakeHost, snapshot } from '../fake-host';

/**
 * A container around the steps that need one.
 *
 * The three steps that read files and write Markdown stay as processes, which
 * is what made a developer machine bearable. A step whose agent may run
 * commands gets a container over the same workspace, which is what stops a
 * command reaching the machine — the failure that ended a run four steps in.
 */

const agentWith = (tools: string[]): SnapshotAgent => ({
  ...(snapshot.agents[0] as SnapshotAgent),
  allowed_tools: tools,
});

const spec: ContainerSpec = {
  image: 'unused',
  cpu: 2,
  memoryMb: 4096,
  wallClockMinutes: 90,
  network: true,
  env: { CLAUDE_CODE_OAUTH_TOKEN: 'sk-test', GIT_TOKEN: 'glpat-test' },
  workdir: '/work',
};

describe('which steps get a wall', () => {
  test('an agent that may run commands does', () => {
    // The default Implement agent, and the default Plan agent, which is
    // permitted a shell to read the repository with.
    expect(needsIsolation(agentWith(['Read', 'Write', 'Edit', 'Bash']))).toBe(true);
    expect(needsIsolation(agentWith(['Read', 'Write', 'Bash']))).toBe(true);
  });

  test('an agent named for the other shell does too', () => {
    // The same permission under the name Windows gives it. Isolation must not
    // depend on which machine the person configuring the agent was using.
    expect(needsIsolation(agentWith(['Read', 'PowerShell']))).toBe(true);
  });

  test('an agent that only reads and writes files does not', () => {
    // Specification and Tasks. A path is confined by the working directory;
    // this is the speed that made taking Docker out worth doing.
    expect(needsIsolation(agentWith(['Read', 'Write']))).toBe(false);
  });

  test('the design agent, whose tools are emptied, does not', () => {
    expect(needsIsolation(agentWith([]))).toBe(false);
  });
});

describe('the workspace the container is given', () => {
  test('is the run’s own directory, in the form the daemon reads', () => {
    expect(mountSource('C:\\Users\\dev\\.code-factory\\runs', 'ws-3b1e760b')).toBe(
      'C:/Users/dev/.code-factory/runs/ws-3b1e760b',
    );
  });

  test('a trailing separator does not produce a doubled one', () => {
    expect(mountSource('/home/dev/runs/', 'ws-1')).toBe('/home/dev/runs/ws-1');
  });
});

describe('running a step behind a wall', () => {
  function spy() {
    const calls: { command: string; argv: string[] }[] = [];
    let result: ExecResult = { exitCode: 0, stdout: '', stderr: '' };
    const exec = async (command: string, argv: string[]): Promise<ExecResult> => {
      calls.push({ command, argv });
      return argv[0] === 'rm' ? { exitCode: 0, stdout: '', stderr: '' } : result;
    };
    return {
      calls,
      exec: exec as never,
      set(next: ExecResult) {
        result = next;
      },
    };
  }

  async function hostWith(exec: ReturnType<typeof spy>) {
    const base = Object.assign(new FakeHost(), { root: '/runs' }) as FakeHost & { root: string };
    const host = isolatingHost({ base, image: 'code-factory/sandbox:latest', exec: exec.exec });
    const id = await host.create(spec);
    return { host, id };
  }

  test('the run’s workspace is mounted, and the command runs in it', async () => {
    const exec = spy();
    const { host, id } = await hostWith(exec);
    await host.execIsolated?.(id, ['claude', '-p', 'do the work'], { cwd: '/work' });

    const argv = exec.calls[0]?.argv as string[];
    expect(exec.calls[0]?.command).toBe('docker');
    expect(argv).toContain('run');
    expect(argv).toContain('--rm');
    expect(argv.join(' ')).toContain(`/runs/${id}:/work`);
    expect(argv[argv.indexOf('--workdir') + 1]).toBe('/work');
    expect(argv).toContain('code-factory/sandbox:latest');
  });

  test('it runs as the unprivileged user, inside the run’s ceilings', async () => {
    const exec = spy();
    const { host, id } = await hostWith(exec);
    await host.execIsolated?.(id, ['claude', '-p', 'x']);

    const argv = exec.calls[0]?.argv as string[];
    expect(argv[argv.indexOf('--user') + 1]).toBe('1000:1000');
    expect(argv[argv.indexOf('--cpus') + 1]).toBe('2');
    expect(argv[argv.indexOf('--memory') + 1]).toBe('4096m');
  });

  test('the run’s credentials are named to the container, never written down', async () => {
    const exec = spy();
    const { host, id } = await hostWith(exec);
    await host.execIsolated?.(id, ['claude', '-p', 'x']);

    const argv = exec.calls[0]?.argv as string[];
    // `--env KEY`, not `--env KEY=value`: the value travels in the process
    // environment and never appears in an argument list (FR-083).
    expect(argv).toContain('CLAUDE_CODE_OAUTH_TOKEN');
    expect(argv.join(' ')).not.toContain('sk-test');
  });

  test('git is allowed to touch a repository it does not own', async () => {
    // Bind-mounted files belong to nobody the container knows, and without
    // this every `git status` inside a step fails with "dubious ownership".
    const exec = spy();
    const { host, id } = await hostWith(exec);
    await host.execIsolated?.(id, ['claude', '-p', 'x']);

    const argv = exec.calls[0]?.argv as string[];
    const script = argv.at(-1) as string;
    expect(script).toContain('safe.directory /work');
    expect(script).toContain('claude');
  });

  test('a command stopped at its deadline does not leave a container working', async () => {
    // `--rm` removes a container that exits. A deadline kills the client, and
    // the container carries on running, and spending, unless it is removed.
    const exec = spy();
    exec.set({ exitCode: 124, stdout: '', stderr: 'stopped' });
    const { host, id } = await hostWith(exec);
    await host.execIsolated?.(id, ['claude', '-p', 'x'], { timeoutMs: 1000 });

    const removal = exec.calls.find((call) => call.argv[0] === 'rm');
    expect(removal).toBeDefined();
    expect(removal?.argv).toContain('--force');
    // By the same name the run was given, not by a guess.
    expect(removal?.argv.at(-1)).toBe(
      exec.calls[0]?.argv[exec.calls[0].argv.indexOf('--name') + 1],
    );
  });

  test('a finished command leaves nothing to remove', async () => {
    const exec = spy();
    const { host, id } = await hostWith(exec);
    await host.execIsolated?.(id, ['claude', '-p', 'x']);
    expect(exec.calls.filter((call) => call.argv[0] === 'rm')).toHaveLength(0);
  });

  test('a run picked up after a restart can still be isolated', async () => {
    // `adopt` is how a run survives the runner stopping. Without the spec
    // being recorded there, the first isolated step after a restart would
    // have no credentials and no ceilings to run with.
    const exec = spy();
    const base = Object.assign(new FakeHost(), { root: '/runs' }) as FakeHost & { root: string };
    const host = isolatingHost({ base, image: 'img', exec: exec.exec });
    await host.adopt?.('ws-old', spec);
    const result = await host.execIsolated?.('ws-old', ['claude', '-p', 'x']);
    expect(result?.exitCode).toBe(0);
    expect(exec.calls[0]?.argv.join(' ')).toContain('/runs/ws-old:/work');
  });

  test('a sandbox nobody registered is refused rather than run unwalled', async () => {
    const exec = spy();
    const { host } = await hostWith(exec);
    const result = await host.execIsolated?.('ws-unknown', ['claude', '-p', 'x']);
    expect(result?.exitCode).not.toBe(0);
    expect(result?.stderr).toContain('could not be isolated');
    expect(exec.calls).toHaveLength(0);
  });

  test('destroying the run forgets it', async () => {
    const exec = spy();
    const { host, id } = await hostWith(exec);
    await host.destroy(id);
    const result = await host.execIsolated?.(id, ['claude', '-p', 'x']);
    expect(result?.stderr).toContain('could not be isolated');
  });
});

describe('what an isolated step is told it may use', () => {
  function sink() {
    return new LogSink({ send: () => {} });
  }

  /** A host that isolates, recording what it was asked to run. */
  function watched(shell: 'posix' | 'windows') {
    const host = new FakeHost();
    host.files.set('/work/docs/spec.md', '# Spec');
    host.responses = [{ match: 'claude', result: { stdout: '{"total_cost_usd":0.1}' } }];
    const isolatedCalls: string[][] = [];
    const plainCalls: string[][] = [];
    const inner = host.exec.bind(host);
    const wrapper: ContainerHost = Object.assign(Object.create(Object.getPrototypeOf(host)), host, {
      shell,
      exec: async (id: string, argv: string[], options?: Parameters<typeof inner>[2]) => {
        plainCalls.push(argv);
        return inner(id, argv, options);
      },
      execIsolated: async (id: string, argv: string[], options?: Parameters<typeof inner>[2]) => {
        isolatedCalls.push(argv);
        return inner(id, argv, options);
      },
    });
    return { host: wrapper, isolatedCalls, plainCalls };
  }

  const step = snapshot.pipeline.steps[0] as Step;

  test('an agent with a shell is run behind the wall, and told the container’s shell', async () => {
    // The container is Linux whatever this machine is, so the CLI inside it
    // offers `Bash`. Passing `PowerShell` there permits a tool that does not
    // exist, and in `-p` mode that refusal is silent.
    const { host, isolatedCalls, plainCalls } = watched('windows');
    await runClaudeStep(host, {
      step,
      snapshot,
      agent: agentWith(['Read', 'Write', 'Bash']),
      containerId: 'c1',
      logs: sink(),
    });
    expect(isolatedCalls).toHaveLength(1);
    expect(plainCalls).toHaveLength(0);
    const tools = toolsIn(isolatedCalls[0] as string[]);
    expect(tools).toContain('Bash');
    expect(tools).not.toContain('PowerShell');
  });

  test('an agent without one stays a process, and keeps this machine’s shell', async () => {
    const { host, isolatedCalls, plainCalls } = watched('windows');
    await runClaudeStep(host, {
      step,
      snapshot,
      agent: agentWith(['Read', 'Write']),
      containerId: 'c1',
      logs: sink(),
    });
    expect(isolatedCalls).toHaveLength(0);
    expect(plainCalls).toHaveLength(1);
  });
});

function toolsIn(argv: string[]): string[] {
  const at = argv.indexOf('--allowedTools');
  return at === -1 ? [] : (argv[at + 1]?.split(',') ?? []);
}

describe('who a step’s container runs as', () => {
  test('the image’s user when this service is that user, or root, or on a platform without uids', async () => {
    const { stepUser, SANDBOX_UID } = await import('../../src/container/isolate');
    expect(stepUser({ uid: 1000, gid: 1000 })).toEqual({ user: `${SANDBOX_UID}:${SANDBOX_UID}` });
    // Root never: a service running as root keeps the unprivileged image user.
    expect(stepUser({ uid: 0, gid: 0 })).toEqual({ user: '1000:1000' });
    expect(stepUser(undefined)).toEqual({ user: '1000:1000' });
  });

  test('this service’s own user otherwise, with a home it can write', async () => {
    const { stepUser } = await import('../../src/container/isolate');
    expect(stepUser({ uid: 1001, gid: 1001 })).toEqual({
      user: '1001:1001',
      home: '/tmp/factory-home-1001',
    });
  });

  test('a service running as root is warned that its steps cannot write; others are not', async () => {
    const { uidWarning } = await import('../../src/container/isolate');
    expect(uidWarning({ uid: 0, gid: 0 })).toMatch(/runs as root/);
    expect(uidWarning({ uid: 1000, gid: 1000 })).toBeNull();
    expect(uidWarning({ uid: 1001, gid: 1001 })).toBeNull();
    expect(uidWarning(undefined)).toBeNull();
  });

  test('the container is told that user and that home', async () => {
    const calls: string[][] = [];
    const exec = async (_command: string, argv: string[]): Promise<ExecResult> => {
      calls.push(argv);
      return { exitCode: 0, stdout: '', stderr: '' };
    };
    const base = Object.assign(new FakeHost(), { root: '/runs' }) as FakeHost & { root: string };
    const host = isolatingHost({
      base,
      image: 'code-factory/sandbox:latest',
      exec: exec as never,
      user: { uid: 1001, gid: 1002 },
    });
    const id = await host.create(spec);
    await host.execIsolated?.(id, ['claude', '-p', 'x']);
    const argv = calls[0] as string[];
    expect(argv[argv.indexOf('--user') + 1]).toBe('1001:1002');
    expect(argv).toContain('HOME=/tmp/factory-home-1001');
  });
});

describe('the step containers a workspace has alive', () => {
  /** An exec whose `docker run` does not return until the test says. */
  function hanging() {
    const calls: string[][] = [];
    let release: ((r: ExecResult) => void) | null = null;
    const exec = async (_command: string, argv: string[]): Promise<ExecResult> => {
      calls.push(argv);
      if (argv[0] === 'run') {
        return new Promise<ExecResult>((resolve) => {
          release = resolve;
        });
      }
      return { exitCode: 0, stdout: '', stderr: '' };
    };
    return {
      calls,
      exec: exec as never,
      release: () => release?.({ exitCode: 137, stdout: '', stderr: '' }),
    };
  }

  test('destroying the workspace removes a step container still running over it', async () => {
    const spy = hanging();
    const base = Object.assign(new FakeHost(), { root: '/runs' }) as FakeHost & { root: string };
    const host = isolatingHost({ base, image: 'img', exec: spy.exec });
    const id = await host.create(spec);
    const step = host.execIsolated?.(id, ['claude', '-p', 'x']);
    await new Promise((resolve) => setTimeout(resolve, 5));

    await host.destroy(id);
    // The container was named before `docker run`, so destroy could find it.
    const removed = spy.calls.find((argv) => argv[0] === 'rm');
    expect(removed).toEqual(['rm', '--force', `factory-${id}-1`]);
    expect(base.destroyed).toEqual([id]);
    spy.release();
    await step;
  });

  test('quiescing the workspace stops the step container first, and counts it', async () => {
    const spy = hanging();
    const base = Object.assign(new FakeHost(), { root: '/runs' }) as FakeHost & { root: string };
    base.leftover = 2;
    const host = isolatingHost({ base, image: 'img', exec: spy.exec });
    const id = await host.create(spec);
    const step = host.execIsolated?.(id, ['claude', '-p', 'x']);
    await new Promise((resolve) => setTimeout(resolve, 5));

    const { stopped } = (await host.quiesce?.(id)) ?? { stopped: 0 };
    expect(stopped).toBe(3);
    expect(spy.calls.some((argv) => argv[0] === 'rm' && argv.at(-1) === `factory-${id}-1`)).toBe(
      true,
    );
    expect(base.quiesced).toEqual([id]);
    spy.release();
    await step;
  });

  test('a step that finished is not removed again later', async () => {
    const calls: string[][] = [];
    const exec = async (_c: string, argv: string[]): Promise<ExecResult> => {
      calls.push(argv);
      return { exitCode: 0, stdout: '', stderr: '' };
    };
    const base = Object.assign(new FakeHost(), { root: '/runs' }) as FakeHost & { root: string };
    const host = isolatingHost({ base, image: 'img', exec: exec as never });
    const id = await host.create(spec);
    await host.execIsolated?.(id, ['claude', '-p', 'x']);
    await host.destroy(id);
    expect(calls.filter((argv) => argv[0] === 'rm')).toEqual([]);
  });
});
