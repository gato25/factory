import { describe, expect, test } from 'bun:test';
import { FactoryError } from '@factory/shared';
import {
  CAPACITY_RETRY_MS,
  isDeploymentLimit,
  withCapacityRetry,
} from '../../src/container/capacity';

/**
 * Waiting out a capacity refusal, and knowing when not to (T053, FR-024,
 * FR-024a, FR-024b, C8, D13).
 *
 * This is where the spike changed what needed building. The documentation
 * describes one capacity failure; the deploy produced two, and they read alike:
 *
 * - "There is no container instance that can be provided to this Durable
 *   Object, try again later" — the platform is momentarily full. It clears in
 *   seconds. Waiting is exactly right.
 * - "Maximum number of running container instances exceeded … consider
 *   configuring a higher value for max_instances" — the deployment's own
 *   declared limit. It never clears, and the SDK already burns about 140
 *   seconds retrying it internally before handing it over.
 *
 * Treating the second as the first costs a run minutes of waiting for something
 * only a deploy can fix, and then fails it with advice to retry. Telling them
 * apart is the whole value of this code.
 *
 * Time is injected here rather than really slept: the window is 30 seconds, and
 * a test that took 30 seconds to assert a timeout is a test that gets skipped.
 */

/** A stand-in for the SDK's own predicate, which cannot be imported here. */
const transient = (error: unknown) =>
  error instanceof Error && /no container instance|try again later/i.test(error.message);

/** A clock and a sleep that advance together, so backoff is real but instant. */
function fakeTime(startAt = 1_000_000) {
  let current = startAt;
  return {
    now: () => current,
    sleep: async (ms: number) => {
      current += ms;
    },
    slept: [] as number[],
    elapsed: () => current - startAt,
  };
}

describe('a refusal that clears within the window', () => {
  test('costs only latency, not the run', async () => {
    const time = fakeTime();
    let attempts = 0;
    const result = await withCapacityRetry(
      async () => {
        attempts += 1;
        if (attempts < 3) throw new Error('There is no container instance that can be provided');
        return 'a sandbox';
      },
      { isTransient: transient, now: time.now, sleep: time.sleep },
    );

    expect(result).toBe('a sandbox');
    expect(attempts).toBe(3);
    // And it really waited, rather than hammering the platform while it was
    // busy — which is what would turn a brief shortage into a longer one.
    expect(time.elapsed()).toBeGreaterThan(0);
  });

  test('the wait grows, so a longer shortage is not hammered', async () => {
    const waited: number[] = [];
    const time = fakeTime();
    let attempts = 0;
    await withCapacityRetry(
      async () => {
        attempts += 1;
        if (attempts < 4) throw new Error('try again later');
        return true;
      },
      {
        isTransient: transient,
        now: time.now,
        sleep: async (ms) => {
          waited.push(ms);
          await time.sleep(ms);
        },
      },
    );
    expect(waited).toEqual([1_000, 2_000, 4_000]);
  });

  test('a first attempt that succeeds waits not at all', async () => {
    const time = fakeTime();
    const result = await withCapacityRetry(async () => 'immediate', {
      isTransient: transient,
      now: time.now,
      sleep: time.sleep,
    });
    expect(result).toBe('immediate');
    expect(time.elapsed()).toBe(0);
  });
});

describe('a refusal that outlasts the window', () => {
  test('fails naming capacity, not as a step failure (FR-024a)', async () => {
    const time = fakeTime();
    let thrown: unknown;
    try {
      await withCapacityRetry(
        async () => {
          throw new Error('There is no container instance that can be provided, try again later');
        },
        { isTransient: transient, now: time.now, sleep: time.sleep },
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(FactoryError);
    const failure = thrown as FactoryError;
    // `sandbox_lost` deliberately, per the execution-host contract: from the
    // run's point of view no sandbox exists, and recovery's single rebuild is
    // the right response. What distinguishes it is the message.
    expect(failure.reason).toBe('sandbox_lost');
    expect(failure.message).toContain('no capacity');
    // The platform's own words are kept for whoever is diagnosing it.
    expect(failure.detail).toContain('no container instance');
  });

  test('gives up inside the window rather than overrunning it (FR-024)', async () => {
    // Bounded, and bounded from the outside: a run that waits indefinitely is
    // worse than one that fails, because the waiting also holds a place in the
    // workspace's concurrency limit that a queued run could have used
    // (FR-024b).
    const failing = fakeTime();
    await withCapacityRetry(
      async () => {
        throw new Error('try again later');
      },
      { isTransient: transient, now: failing.now, sleep: failing.sleep },
    ).catch(() => undefined);
    expect(failing.elapsed()).toBeLessThan(CAPACITY_RETRY_MS);
  });
});

describe('the deployment’s own instance limit is refused at once', () => {
  test('it is recognised by the words the provider uses', () => {
    expect(
      isDeploymentLimit(
        'Maximum number of running container instances exceeded, consider configuring a ' +
          'higher value for max_instances',
      ),
    ).toBe(true);
    // And a momentary shortage is not mistaken for it. A false positive here
    // refuses a run that would have succeeded, so the match is narrow on
    // purpose and anything unrecognised is waited out instead.
    expect(isDeploymentLimit('There is no container instance that can be provided')).toBe(false);
    expect(isDeploymentLimit('connection reset')).toBe(false);
  });

  test('it is not retried, and says a deploy is what fixes it', async () => {
    const time = fakeTime();
    let attempts = 0;
    let thrown: unknown;
    try {
      await withCapacityRetry(
        async () => {
          attempts += 1;
          throw new Error('Maximum number of running container instances exceeded (max_instances)');
        },
        { isTransient: () => true, now: time.now, sleep: time.sleep },
      );
    } catch (error) {
      thrown = error;
    }

    // Once. Retrying would spend a run's patience on something no amount of
    // waiting changes — and the SDK has already spent ~140 seconds on it.
    expect(attempts).toBe(1);
    expect(time.elapsed()).toBe(0);
    expect((thrown as FactoryError).message).toContain('will not clear on its own');
    expect((thrown as FactoryError).message).toContain('deployment setting');
    // Even with a predicate that calls everything transient, which is the case
    // where the SDK's own view and ours disagree.
  });
});

describe('a refusal that is not about capacity at all', () => {
  test('fails immediately rather than being waited out', async () => {
    // A credential rejected, a malformed request, an image that does not
    // exist. Waiting 30 seconds for one of those to fix itself delays a
    // failure the operator could already have been reading.
    const time = fakeTime();
    let attempts = 0;
    await withCapacityRetry(
      async () => {
        attempts += 1;
        throw new Error('unauthorized');
      },
      { isTransient: transient, now: time.now, sleep: time.sleep },
    ).catch(() => undefined);

    expect(attempts).toBe(1);
    expect(time.elapsed()).toBe(0);
  });

  test('a thrown non-Error is still handled rather than crashing the retry', async () => {
    // The SDK throws what it throws. A retry wrapper that assumed `Error`
    // would fail with a TypeError and bury the real cause.
    const time = fakeTime();
    let thrown: unknown;
    try {
      await withCapacityRetry(
        async () => {
          throw 'a string, because someone threw one';
        },
        { isTransient: transient, now: time.now, sleep: time.sleep },
      );
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(FactoryError);
    expect((thrown as FactoryError).detail).toContain('someone threw one');
  });
});
