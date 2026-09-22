import { describe, expect, test } from 'bun:test';
import type { ExecResult } from '../../src/container/host';
import { OWNED_FILTER } from '../../src/container/labels';
import { parseListing, reapStoppedContainers } from '../../src/container/reap';

/**
 * Stopped containers this service made, and nothing else, are removed.
 */

function daemon(listing: string, failRm: string[] = []) {
  const calls: string[][] = [];
  const exec = async (_command: string, argv: string[]): Promise<ExecResult> => {
    calls.push(argv);
    if (argv[0] === 'ps') return { exitCode: 0, stdout: listing, stderr: '' };
    if (argv[0] === 'rm') {
      const id = argv.at(-1) as string;
      return failRm.includes(id)
        ? { exitCode: 1, stdout: '', stderr: `Error: container ${id} is in use` }
        : { exitCode: 0, stdout: id, stderr: '' };
    }
    throw new Error(`unexpected docker ${argv.join(' ')}`);
  };
  const lines: { level: string; fields?: Record<string, unknown> }[] = [];
  const log = {
    info: (_m: string, fields?: Record<string, unknown>) => lines.push({ level: 'info', fields }),
    warn: (_m: string, fields?: Record<string, unknown>) => lines.push({ level: 'warn', fields }),
  };
  return { exec, calls, lines, log };
}

const LISTING = [
  'aaa111\trun\t11111111-1111-1111-1111-111111111111\tExited (0) 3 hours ago',
  'bbb222\tlaunch\tlaunch-4\tExited (137) 20 minutes ago',
  'ccc333\t\t\tDead',
  '',
].join('\n');

describe('the listing', () => {
  test('is read one container per line, unknowns named as such', () => {
    expect(parseListing(LISTING)).toEqual([
      {
        id: 'aaa111',
        kind: 'run',
        of: '11111111-1111-1111-1111-111111111111',
        status: 'Exited (0) 3 hours ago',
      },
      { id: 'bbb222', kind: 'launch', of: 'launch-4', status: 'Exited (137) 20 minutes ago' },
      { id: 'ccc333', kind: 'unknown', of: 'unknown', status: 'Dead' },
    ]);
    expect(parseListing('')).toEqual([]);
    expect(parseListing('garbage')).toEqual([]);
  });
});

describe('reaping', () => {
  test('asks only for this service’s stopped containers, and removes each one', async () => {
    const d = daemon(LISTING);
    const result = await reapStoppedContainers({ exec: d.exec, log: d.log });

    const ps = d.calls[0] as string[];
    expect(ps.slice(0, 2)).toEqual(['ps', '--all']);
    expect(ps).toContain(OWNED_FILTER);
    expect(ps).toContain('status=exited');
    expect(ps).toContain('status=dead');
    // Running containers are never asked for: a retained failed sandbox, or a
    // run this restarted service has not adopted yet, is not this sweep's.
    expect(ps).not.toContain('status=running');

    expect(d.calls.slice(1)).toEqual([
      ['rm', '--force', '--volumes', 'aaa111'],
      ['rm', '--force', '--volumes', 'bbb222'],
      ['rm', '--force', '--volumes', 'ccc333'],
    ]);
    expect(result.removed.map((c) => c.id)).toEqual(['aaa111', 'bbb222', 'ccc333']);
    expect(result.failed).toEqual([]);
    expect(d.lines).toHaveLength(1);
    expect(d.lines[0]?.fields).toMatchObject({ count: 3 });
  });

  test('one that cannot be removed is reported, and the rest are still removed', async () => {
    const d = daemon(LISTING, ['bbb222']);
    const result = await reapStoppedContainers({ exec: d.exec, log: d.log });
    expect(result.removed.map((c) => c.id)).toEqual(['aaa111', 'ccc333']);
    expect(result.failed.map((c) => c.id)).toEqual(['bbb222']);
    expect(d.lines.map((l) => l.level)).toEqual(['info', 'warn']);
  });

  test('nothing to remove is nothing to say', async () => {
    const d = daemon('');
    const result = await reapStoppedContainers({ exec: d.exec, log: d.log });
    expect(result).toEqual({ removed: [], failed: [] });
    expect(d.calls).toHaveLength(1);
    expect(d.lines).toEqual([]);
  });

  test('a daemon that does not answer is left alone, quietly', async () => {
    const exec = async (): Promise<ExecResult> => {
      throw new Error('spawn docker ENOENT');
    };
    const lines: string[] = [];
    const result = await reapStoppedContainers({
      exec,
      log: { info: (m) => lines.push(m), warn: (m) => lines.push(m) },
    });
    expect(result).toEqual({ removed: [], failed: [] });
    expect(lines).toEqual([]);
  });
});
