import { describe, expect, test } from 'bun:test';
import { descendants, stopTree } from '../lib/process-tree';

/**
 * The one thing `bun run dev` promises that it cannot deliver by simply
 * calling `kill`: one Ctrl-C stops both services.
 *
 * This is the test that would have caught the defect in the first version of
 * `scripts/dev.ts`. It called `proc.kill()` on `bun run dev:runner`, which
 * killed the wrapper and left the execution service running — port 8080 still
 * answered afterwards. Nothing on screen said so, and the cost landed on the
 * NEXT `bun run dev`.
 *
 * A shell wrapper standing in for `bun run` rather than the real services,
 * because the property under test is about process trees and not about either
 * service: this needs no port, no database and no container daemon.
 */

const onWindows = process.platform === 'win32';

/** A wrapper holding one long-lived child, which is the shape `bun run` makes. */
function wrapperWithChild() {
  return Bun.spawn(['sh', '-c', 'sleep 120 & wait'], { stdout: 'ignore', stderr: 'ignore' });
}

/**
 * Whether a process is still RUNNING, which is not the same as whether the pid
 * still exists.
 *
 * A process that has been killed stays in the table as a zombie until its
 * parent reaps it — here for about a second, because killing the wrapper
 * reparents the child and it waits for init. `process.kill(pid, 0)` succeeds
 * against a zombie, so the obvious liveness check reports a process that is
 * demonstrably dead as alive. The first version of this test did exactly that
 * and failed against correct code, which is the expensive kind of wrong: it
 * argues for changing the thing that works.
 *
 * A zombie holds no port and runs no code, so "not running" is also the
 * property actually being asked about.
 */
function running(pid: number): boolean {
  const listed = Bun.spawnSync(['ps', '-o', 'stat=', '-p', String(pid)]);
  const state = new TextDecoder().decode(listed.stdout).trim();
  return state.length > 0 && !state.startsWith('Z');
}

const settle = () => Bun.sleep(300);

/** Waits for a process to stop running, so a slow reap is not a failure. */
async function waitGone(pid: number, seconds = 5): Promise<boolean> {
  for (let waited = 0; waited < seconds * 1000; waited += 100) {
    if (!running(pid)) return true;
    await Bun.sleep(100);
  }
  return false;
}

describe.skipIf(onWindows)('stopping a service stops what it started', () => {
  test('the child of a wrapper is found, not just the wrapper', async () => {
    const wrapper = wrapperWithChild();
    await settle();
    const children = descendants(wrapper.pid);
    expect(children.length).toBeGreaterThan(0);
    expect(children).not.toContain(wrapper.pid);
    stopTree(wrapper);
    await wrapper.exited;
  });

  test('killing the wrapper alone leaves the child running — the defect itself', async () => {
    // Stated as a test so that the reason `stopTree` exists cannot quietly
    // stop being true. If a future Bun makes `proc.kill()` signal the group,
    // this fails and `stopTree` can be deleted rather than carried for ever.
    const wrapper = wrapperWithChild();
    await settle();
    const child = descendants(wrapper.pid)[0] as number;

    wrapper.kill();
    await wrapper.exited;
    await settle();

    expect(running(child)).toBe(true);
    process.kill(child, 'SIGTERM');
  });

  test('stopTree stops the wrapper AND the child', async () => {
    const wrapper = wrapperWithChild();
    await settle();
    const child = descendants(wrapper.pid)[0] as number;

    stopTree(wrapper);
    await wrapper.exited;

    expect(await waitGone(wrapper.pid)).toBe(true);
    expect(await waitGone(child)).toBe(true);
  });

  test('a process with no children is not an error', () => {
    // The ordinary case once a service has already exited on its own.
    const lonely = Bun.spawn(['sleep', '30'], { stdout: 'ignore', stderr: 'ignore' });
    expect(descendants(lonely.pid)).toEqual([]);
    stopTree(lonely);
  });

  test('a pid that is already gone is not an error', async () => {
    // Ctrl-C arriving just after a service died on its own. Throwing here
    // would mean the SECOND service never gets stopped.
    const gone = Bun.spawn(['sh', '-c', 'exit 0'], { stdout: 'ignore', stderr: 'ignore' });
    await gone.exited;
    expect(() => stopTree(gone)).not.toThrow();
  });
});
