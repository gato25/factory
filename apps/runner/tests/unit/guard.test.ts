import { describe, expect, test } from 'bun:test';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SnapshotAgent, Step } from '@factory/shared';
import {
  deniedReason,
  GUARD_SCRIPT_PATH,
  GUARD_SETTINGS_PATH,
  guardScript,
  guardSettings,
  installGuard,
  SELF_TEST,
} from '../../src/container/guard';
import { processHost } from '../../src/container/process-host';
import { WORKDIR } from '../../src/container/start';
import { buildArgv } from '../../src/engines/claude-cli';
import { LogSink } from '../../src/stream/logs';
import { FakeHost, snapshot } from '../fake-host';

/**
 * The command guard.
 *
 * A run on the process host shares a process table with the machine it runs
 * on. An agent tidying up after a dev server it started reached for
 * `Get-Process -Name bun | Stop-Process -Force`, which named the runner
 * supervising it; the run froze four steps in. These are the rules that
 * refuse that shape of command, and the evidence that the ordinary form of
 * the same intent still works.
 */

describe('ending processes by name', () => {
  test('the command from the incident is refused', () => {
    expect(deniedReason(SELF_TEST)).not.toBeNull();
  });

  test.each([
    'Stop-Process -Name bun -Force',
    'Get-Process -Name node | Stop-Process',
    'Get-Process bun | Stop-Process -Force',
    'taskkill /IM bun.exe /F',
    'pkill -f vite',
    'killall node',
    'kill $(pgrep -f "bun run dev")',
    'pgrep bun | xargs kill -9',
    "[System.Diagnostics.Process]::GetProcessesByName('bun') | ForEach-Object { $_.Kill() }",
    "wmic process where name='bun.exe' delete",
  ])('refused: %s', (command) => {
    expect(deniedReason(command)).not.toBeNull();
  });

  test('the refusal tells the agent what to do instead, because it reads it', () => {
    const reason = deniedReason('Stop-Process -Name bun') as string;
    expect(reason).toContain('process id');
    expect(reason).toContain('-PassThru');
  });
});

describe('ending what you started', () => {
  // The point of the guard is not to stop an agent cleaning up. It is to make
  // it name the one thing it started. These must keep working, or the agent
  // is left with no way to stop a server it was asked to run.
  test.each([
    'Stop-Process -Id 32780',
    '$p = Start-Process bun -ArgumentList "run","dev" -PassThru; Stop-Process -Id $p.Id',
    'Stop-Process -Id $server.Id -Force',
    'taskkill /PID 32780 /T /F',
    'kill 32780',
    'kill -9 $!',
  ])('allowed: %s', (command) => {
    expect(deniedReason(command)).toBeNull();
  });

  // A rule that fires on the word rather than the command teaches an agent
  // that the guard is arbitrary, and an agent that believes that works around
  // it. Each of these mentions a refused verb without running one.
  test.each([
    'npm test',
    'bun run dev',
    'git commit -m "feat: add the killall helper to docs"',
    'git commit -m "docs: explain when to net stop the service"',
    'echo "run shutdown only from the console"',
    'grep -r "Stop-Process" docs/',
    'Get-Process -Name bun',
    'Get-Process | Select-Object Id,ProcessName',
  ])('allowed: %s', (command) => {
    expect(deniedReason(command)).toBeNull();
  });

  test('looking is not killing', () => {
    // `Get-Process` alone is how an agent finds the id it is then required to
    // use. Refusing it would leave the permitted path unreachable.
    expect(deniedReason('Get-Process -Name bun | Select-Object -First 1')).toBeNull();
  });
});

describe('the rest of the machine', () => {
  test.each([
    'Stop-Service postgresql-x64-16',
    'net stop docker',
    'systemctl restart nginx',
    'Restart-Computer -Force',
    'shutdown /r /t 0',
  ])('refused: %s', (command) => {
    expect(deniedReason(command)).not.toBeNull();
  });
});

describe('the script the hook runs', () => {
  test('carries the same rules as this module, not a second copy of them', () => {
    // The script is generated from `RULES`, so a rule added here reaches the
    // sandbox without being written a second time in JavaScript.
    const script = guardScript();
    expect(script).toContain('Stop-Process');
    expect(script).toContain('GetProcessesByName');
    expect(script).toContain('function deniedReason');
  });

  test('exits 2, the only code the CLI treats as blocking', () => {
    const script = guardScript();
    expect(script).toContain('process.exit(2)');
  });

  test('judges a command the way this module does', async () => {
    // The generated script is run as the CLI would run it, with the hook's
    // own input shape on stdin, because a policy that only holds in
    // TypeScript protects nothing.
    const denied = await runScript(guardScript(), {
      hook_event_name: 'PreToolUse',
      tool_name: 'PowerShell',
      tool_input: { command: SELF_TEST },
    });
    expect(denied.exitCode).toBe(2);
    expect(denied.stderr).toContain('process id');

    const allowed = await runScript(guardScript(), {
      hook_event_name: 'PreToolUse',
      tool_name: 'PowerShell',
      tool_input: { command: 'Stop-Process -Id 32780' },
    });
    expect(allowed.exitCode).toBe(0);
    expect(allowed.stderr).toBe('');
  });

  test('reads the command under another key rather than letting it through', async () => {
    // If the CLI ever names the field something else, the guard must not
    // quietly become a no-op: every string it was given is checked.
    const result = await runScript(guardScript(), {
      tool_name: 'Bash',
      tool_input: { script: 'pkill -f bun' },
    });
    expect(result.exitCode).toBe(2);
  });

  test('a call it cannot parse is not treated as permission', async () => {
    const result = await runScript(guardScript(), 'not json at all');
    expect(result.exitCode).toBe(0);
  });

  test('answers the self-test with the blocking code', async () => {
    const result = await runScript(guardScript(), '', ['--self-test']);
    expect(result.exitCode).toBe(2);
  });
});

describe('what the CLI is told', () => {
  test('the hook is attached to the shell tools, on both platforms', () => {
    const settings = guardSettings() as {
      hooks: { PreToolUse: { matcher: string; hooks: { args: string[] }[] }[] };
    };
    const entry = settings.hooks.PreToolUse[0] as { matcher: string; hooks: { args: string[] }[] };
    expect(entry.matcher).toContain('Bash');
    expect(entry.matcher).toContain('PowerShell');
  });

  test('the script is named absolutely, since the hook’s directory is not promised', () => {
    const settings = JSON.stringify(guardSettings());
    expect(settings).toContain('CLAUDE_PROJECT_DIR');
    expect(settings).toContain(GUARD_SCRIPT_PATH);
  });
});

describe('reaching the CLI', () => {
  test('every agent step is started with the guard in force', () => {
    // Writing the files into the workspace does nothing on its own: the CLI
    // has to be told to read them, and it is told here rather than through
    // the repository's own settings, which it may or may not trust.
    const argv = buildArgv(
      {
        step: snapshot.pipeline.steps[0] as Step,
        snapshot,
        agent: snapshot.agents[0] as SnapshotAgent,
        containerId: 'c1',
        logs: new LogSink({ send: () => {} }),
      },
      'prompt',
    );
    expect(argv).toContain('--settings');
    expect(argv[argv.indexOf('--settings') + 1]).toBe(GUARD_SETTINGS_PATH);
  });
});

describe('installing it', () => {
  test('both files are written where the CLI will look', async () => {
    const host = new FakeHost();
    await installGuard(host, 'container-1', '/work');
    expect(host.files.get(`/work/${GUARD_SCRIPT_PATH}`)).toContain('deniedReason');
    expect(host.files.get(`/work/${GUARD_SETTINGS_PATH}`)).toContain('PreToolUse');
  });

  test('a guard that does not answer is said out loud, not assumed to be working', async () => {
    // The failure this is for: the CLI treats every exit code but 2 as a
    // non-blocking error, so a hook that cannot run lets every command
    // through and says nothing. Silence here would mean believing in a
    // protection that is not there.
    const host = new FakeHost();
    host.responses = [
      { match: '--self-test', result: { exitCode: 127, stderr: 'node: not found' } },
    ];
    const warnings: string[] = [];
    await installGuard(host, 'container-1', '/work', (line) => warnings.push(line));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('not being checked');
    expect(warnings[0]).toContain('node: not found');
  });

  test('a guard that answers correctly says nothing', async () => {
    const host = new FakeHost();
    host.responses = [{ match: '--self-test', result: { exitCode: 2 } }];
    const warnings: string[] = [];
    await installGuard(host, 'container-1', '/work', (line) => warnings.push(line));
    expect(warnings).toEqual([]);
  });

  test('a sandbox that cannot be reached warns rather than failing the step', async () => {
    const host = new FakeHost();
    host.exec = async () => {
      throw new Error('the sandbox is gone');
    };
    const warnings: string[] = [];
    await installGuard(host, 'container-1', '/work', (line) => warnings.push(line));
    expect(warnings[0]).toContain('the sandbox is gone');
  });
});

describe('on the host this actually runs on', () => {
  // The fake host proves the shape. This proves the path: a real directory,
  // the real `/work` alias, and on Windows the real POSIX shell wrapping that
  // every command goes through. The self-test failing here is the difference
  // between a guard and the belief in one.
  test('the guard installs into a real workspace and answers there', async () => {
    const root = join(tmpdir(), `factory-guard-host-${crypto.randomUUID().slice(0, 8)}`);
    const host = processHost({ root });
    const id = await host.create({
      image: 'unused',
      cpu: 1,
      memoryMb: 512,
      wallClockMinutes: 5,
      network: true,
      env: {},
      workdir: WORKDIR,
    });
    try {
      const warnings: string[] = [];
      await installGuard(host, id, WORKDIR, (line) => warnings.push(line));
      expect(warnings).toEqual([]);
      expect(await host.readFile(id, `${WORKDIR}/${GUARD_SCRIPT_PATH}`)).toContain('deniedReason');
    } finally {
      await host.destroy(id);
      await rm(root, { recursive: true, force: true }).catch(() => {});
    }
  });
});

/** Runs the generated hook the way the CLI runs it: node, JSON on stdin. */
async function runScript(
  source: string,
  input: unknown,
  argv: string[] = [],
): Promise<{ exitCode: number; stderr: string }> {
  const path = join(tmpdir(), `factory-guard-${crypto.randomUUID().slice(0, 8)}.mjs`);
  await Bun.write(path, source);
  try {
    const proc = Bun.spawn(['node', path, ...argv], {
      stdin: new TextEncoder().encode(typeof input === 'string' ? input : JSON.stringify(input)),
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const stderr = await new Response(proc.stderr).text();
    return { exitCode: await proc.exited, stderr };
  } finally {
    await rm(path, { force: true }).catch(() => {});
  }
}

describe('the hook as the CLI reads it', () => {
  test('is one shell command string naming the script, with no field the CLI does not know', async () => {
    const { guardSettings, GUARD_SCRIPT_PATH } = await import('../../src/container/guard');
    const settings = guardSettings() as {
      hooks: { PreToolUse: { matcher: string; hooks: Record<string, unknown>[] }[] };
    };
    const [entry] = settings.hooks.PreToolUse;
    expect(entry?.matcher).toBe('Bash|PowerShell');
    const [hook] = entry?.hooks ?? [];
    // The CLI's hook schema is `{ type, command, timeout? }`. An `args` key
    // was silently dropped, which left `command: 'node'` — a hook that read
    // its JSON input as a script, failed, and objected to nothing.
    expect(Object.keys(hook ?? {}).sort()).toEqual(['command', 'timeout', 'type']);
    expect(hook?.type).toBe('command');
    expect(hook?.command).toBe(`node "$CLAUDE_PROJECT_DIR/${GUARD_SCRIPT_PATH}"`);
    expect(hook).not.toHaveProperty('args');
  });

  test('the command, run as the CLI runs it, blocks the incident’s command with exit 2', async () => {
    // The whole path a real hook takes: the settings' command string through
    // a shell, with CLAUDE_PROJECT_DIR in the environment and the hook's
    // JSON on stdin.
    const { mkdtemp, rm, writeFile, mkdir } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { guardScript, guardSettings, GUARD_SCRIPT_PATH } = await import(
      '../../src/container/guard'
    );
    const dir = await mkdtemp(join(tmpdir(), 'factory-guard-'));
    try {
      await mkdir(join(dir, '.claude'), { recursive: true });
      await writeFile(join(dir, GUARD_SCRIPT_PATH), guardScript());
      const settings = guardSettings() as {
        hooks: { PreToolUse: { hooks: { command: string }[] }[] };
      };
      const command = settings.hooks.PreToolUse[0]?.hooks[0]?.command as string;
      const proc = Bun.spawn(['sh', '-c', command], {
        env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
        stdin: new TextEncoder().encode(
          JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'pkill -f bun' } }),
        ),
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const code = await proc.exited;
      expect(code).toBe(2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
