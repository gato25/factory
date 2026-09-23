import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  acquireInstanceLock,
  assertWritable,
  LOCK_FILE,
  LOCK_STALE_MS,
} from '../../src/orchestrate/lock';

/**
 * What the runner checks before it takes a request: that it can write where
 * every run's position goes, and that it is the only one writing there.
 */

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'factory-lock-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const quiet = { warn: () => {} };

describe('the state directory', () => {
  test('one that can be written to passes, and is left as it was', async () => {
    await assertWritable(dir);
    expect((await stat(dir)).isDirectory()).toBe(true);
    const { readdir } = await import('node:fs/promises');
    expect(await readdir(dir)).toEqual([]);
  });

  test('one that cannot be written to is named, so the failure is about disk and not about a run', async () => {
    // A path under a regular file cannot be created by anyone, root included.
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(dir, 'a-file'), 'x');
    await expect(assertWritable(join(dir, 'a-file', 'state'))).rejects.toThrow(
      /state directory .*a-file\/state is not writable/,
    );
  });
});

describe('one runner per state directory', () => {
  test('the first runner takes the lock and writes who it is', async () => {
    const lock = await acquireInstanceLock(dir, { pid: 100, host: 'alpha', log: quiet });
    const written = JSON.parse(await readFile(join(dir, LOCK_FILE), 'utf8')) as {
      pid: number;
      hostname: string;
    };
    expect(written).toMatchObject({ pid: 100, hostname: 'alpha' });
    await lock.release();
  });

  test('a second runner is refused while the first is alive, and told who holds it', async () => {
    const first = await acquireInstanceLock(dir, { pid: 100, host: 'alpha', log: quiet });
    await expect(acquireInstanceLock(dir, { pid: 200, host: 'beta', log: quiet })).rejects.toThrow(
      /another runner holds .* pid 100 on alpha/,
    );
    await first.release();
  });

  test('a lock whose heartbeat is stale is taken over, with a warning', async () => {
    let clock = Date.parse('2026-09-23T10:00:00.000Z');
    const now = () => clock;
    const first = await acquireInstanceLock(dir, {
      pid: 100,
      host: 'alpha',
      now,
      heartbeatMs: 3_600_000,
      log: quiet,
    });
    // The first runner dies without releasing; time passes.
    clock += LOCK_STALE_MS + 1_000;
    const warnings: string[] = [];
    const second = await acquireInstanceLock(dir, {
      pid: 200,
      host: 'beta',
      now,
      log: { warn: (message) => warnings.push(message) },
    });
    expect(warnings).toEqual(['taking over a state directory whose runner is gone']);
    const written = JSON.parse(await readFile(join(dir, LOCK_FILE), 'utf8')) as { pid: number };
    expect(written.pid).toBe(200);
    await second.release();
    // The corpse's release must not remove the living runner's lock.
    await first.release();
  });

  test('the same runner may take its own lock again', async () => {
    const a = await acquireInstanceLock(dir, { pid: 100, host: 'alpha', log: quiet });
    const b = await acquireInstanceLock(dir, { pid: 100, host: 'alpha', log: quiet });
    await a.release();
    await b.release();
  });

  test('releasing removes the file; releasing somebody else’s lock does not', async () => {
    const first = await acquireInstanceLock(dir, { pid: 100, host: 'alpha', log: quiet });
    await first.release();
    await expect(stat(join(dir, LOCK_FILE))).rejects.toThrow();

    const second = await acquireInstanceLock(dir, { pid: 200, host: 'beta', log: quiet });
    // `first` was released already; releasing it again is a no-op and must
    // not touch what `second` holds.
    await first.release();
    expect((await stat(join(dir, LOCK_FILE))).isFile()).toBe(true);
    await second.release();
  });

  test('the heartbeat is refreshed while the lock is held', async () => {
    let clock = Date.parse('2026-09-23T10:00:00.000Z');
    const lock = await acquireInstanceLock(dir, {
      pid: 100,
      host: 'alpha',
      now: () => clock,
      heartbeatMs: 5,
      log: quiet,
    });
    clock += 60_000;
    await new Promise((resolve) => setTimeout(resolve, 30));
    const written = JSON.parse(await readFile(join(dir, LOCK_FILE), 'utf8')) as {
      heartbeatAt: string;
    };
    expect(written.heartbeatAt).toBe('2026-09-23T10:01:00.000Z');
    await lock.release();
  });
});

describe('a lock on the same machine', () => {
  test('held by a live process refuses a second runner, however old the heartbeat', async () => {
    let clock = Date.parse('2026-09-23T10:00:00.000Z');
    const first = await acquireInstanceLock(dir, {
      pid: 100,
      host: 'alpha',
      now: () => clock,
      heartbeatMs: 3_600_000,
      log: quiet,
    });
    clock += LOCK_STALE_MS * 10;
    await expect(
      acquireInstanceLock(dir, {
        pid: 200,
        host: 'alpha',
        now: () => clock,
        isAlive: () => true,
        log: quiet,
      }),
    ).rejects.toThrow(/another runner holds .* pid 100 on alpha/);
    await first.release();
  });

  test('left by a dead process is taken over at once, however fresh the heartbeat', async () => {
    // A crash and a supervisor's restart, seconds apart: the heartbeat is
    // fresh, the process is gone, and the restart must not wait two minutes.
    await acquireInstanceLock(dir, { pid: 100, host: 'alpha', log: quiet });
    const warnings: string[] = [];
    const second = await acquireInstanceLock(dir, {
      pid: 200,
      host: 'alpha',
      isAlive: (pid) => pid !== 100,
      log: { warn: (message) => warnings.push(message) },
    });
    expect(warnings).toEqual(['taking over a state directory whose runner is gone']);
    const written = JSON.parse(await readFile(join(dir, LOCK_FILE), 'utf8')) as { pid: number };
    expect(written.pid).toBe(200);
    await second.release();
  });

  test('the process check answers for this process, and for one that does not exist', async () => {
    const { processIsAlive } = await import('../../src/orchestrate/lock');
    expect(processIsAlive(process.pid)).toBe(true);
    // A pid no process has, with room to spare on any machine.
    expect(processIsAlive(2 ** 22 - 7)).toBe(false);
  });
});
