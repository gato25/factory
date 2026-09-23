import { describe, expect, test } from 'bun:test';
import { HARDENING_ARGS, SANDBOX_PIDS_LIMIT } from '../../src/container/hardening';
import type { ContainerSpec, ExecResult } from '../../src/container/host';
import { isolatingHost } from '../../src/container/isolate';
import { FakeHost } from '../fake-host';

/**
 * What a sandbox is denied beyond running as an unprivileged user: every
 * capability, any privilege a setuid binary could grant, and an unbounded
 * process table. Held on both containers a run can get — its sandbox and an
 * isolated step's — so changing one and not the other fails here.
 */

describe('the hardening arguments', () => {
  test('drop every capability, forbid new privileges, and bound the process table', () => {
    const joined = HARDENING_ARGS.join(' ');
    expect(joined).toContain('--cap-drop ALL');
    expect(joined).toContain('--security-opt no-new-privileges');
    expect(joined).toContain(`--pids-limit ${SANDBOX_PIDS_LIMIT}`);
  });

  test('the process table bound counts threads, so it is well above a real build', () => {
    // A browser under Playwright is dozens of threads and a test runner with
    // workers a few hundred; a fork bomb is tens of thousands.
    expect(SANDBOX_PIDS_LIMIT).toBeGreaterThanOrEqual(1024);
    expect(SANDBOX_PIDS_LIMIT).toBeLessThanOrEqual(8192);
  });
});

describe('where they are applied', () => {
  test('a run’s sandbox is created with them, after its user', async () => {
    const source = await Bun.file('apps/runner/src/container/host.ts').text();
    const creation = source.slice(source.indexOf("'run',"), source.indexOf("'sleep',"));
    expect(creation).toContain("'1000:1000'");
    expect(creation).toContain('...HARDENING_ARGS');
    expect(creation.indexOf('...HARDENING_ARGS')).toBeGreaterThan(creation.indexOf("'1000:1000'"));
  });

  test('an isolated step’s container gets the same', async () => {
    const calls: string[][] = [];
    const exec = async (_command: string, argv: string[]): Promise<ExecResult> => {
      calls.push(argv);
      return { exitCode: 0, stdout: '', stderr: '' };
    };
    const base = Object.assign(new FakeHost(), { root: '/runs' }) as FakeHost & { root: string };
    const host = isolatingHost({ base, image: 'code-factory/sandbox:latest', exec: exec as never });
    const spec: ContainerSpec = {
      image: 'unused',
      cpu: 2,
      memoryMb: 4096,
      wallClockMinutes: 90,
      network: true,
      env: {},
      workdir: '/work',
    };
    const id = await host.create(spec);
    await host.execIsolated?.(id, ['claude', '-p', 'x']);
    const argv = calls[0] as string[];
    expect(argv[argv.indexOf('--cap-drop') + 1]).toBe('ALL');
    expect(argv[argv.indexOf('--security-opt') + 1]).toBe('no-new-privileges');
    expect(argv[argv.indexOf('--pids-limit') + 1]).toBe(String(SANDBOX_PIDS_LIMIT));
  });
});
