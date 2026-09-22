import { expect, test } from 'bun:test';
import { timerDelay } from '../../src/container/host';
import { processHost } from '../../src/container/process-host';
import { sandboxLifetime } from '../../src/router';

/**
 * A sandbox must not be destroyed the moment it is created.
 *
 * `setTimeout` does not saturate above a 32-bit signed integer of
 * milliseconds — it overflows, and the timer fires at once. Every sandbox on
 * this host is removed by such a timer, so a lifetime long enough to overflow
 * removed the workspace while the first step was still cloning into it. The
 * clone failed on a directory that had just been deleted underneath it, and
 * the run reported a repository it could not clone.
 */

const MAX = 2 ** 31 - 1;

test('a delay longer than a 32-bit millisecond count is clamped, not overflowed', () => {
  // 8 steps under a 4500-minute per-step ceiling: the run that found this.
  const overflowing = (8 * 4500 + 15) * 60_000;
  expect(overflowing).toBeGreaterThan(MAX);
  expect(timerDelay(overflowing)).toBe(MAX);
});

test('an ordinary delay is left exactly as it is', () => {
  expect(timerDelay(90 * 60_000)).toBe(90 * 60_000);
  expect(timerDelay(MAX)).toBe(MAX);
});

test('an unusable duration waits as long as it can, rather than firing at once', () => {
  // Both timers this guards are destructive — one deletes a workspace, the
  // other kills a running step — so a duration nothing can make sense of
  // must not be read as "now".
  expect(timerDelay(Number.NaN)).toBe(MAX);
  expect(timerDelay(Number.POSITIVE_INFINITY)).toBe(MAX);
  expect(timerDelay(-1)).toBe(0);
});

test('a sandbox with an overflowing lifetime still exists a moment later', async () => {
  const host = processHost({ root: `${import.meta.dir}/../.tmp-timer-${crypto.randomUUID()}` });
  // The lifetime the failing run asked for, in minutes.
  const minutes = sandboxLifetime({ pipeline: { steps: new Array(8) }, limits: {} }, 36_015);

  const id = await host.create({
    image: 'x',
    cpu: 2,
    memoryMb: 4096,
    wallClockMinutes: minutes,
    network: true,
    env: {},
    workdir: '/work',
  });

  // Long enough that an overflowed timer — which fired in about 20ms — would
  // have destroyed it, and far short of the lifetime actually asked for.
  await Bun.sleep(150);

  // Still usable: before the fix this threw `sandbox_lost`.
  const out = await host.exec(id, ['sh', '-c', 'echo alive'], { cwd: '/work' });
  expect(out.exitCode).toBe(0);
  expect(out.stdout.trim()).toBe('alive');

  await host.destroy(id);
});
