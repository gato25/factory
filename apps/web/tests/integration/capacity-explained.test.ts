import { describe, expect, test } from 'bun:test';
import { explain } from '$lib/services/failure';

/**
 * That a person reading a failed run can tell the two capacity failures apart
 * (T057, FR-024a, FR-024b).
 *
 * They arrive as the same `FailureReason`, and that is deliberate: the
 * execution-host contract makes a capacity refusal `sandbox_lost` because from
 * the run's point of view no sandbox exists either way, and recovery's single
 * rebuild is the right response to both. What differs is the ADVICE, which is
 * the whole reason a person opens this screen.
 *
 * - The platform was momentarily full. Retry; it clears in about a minute.
 * - The deployment reached its own configured instance limit. Retrying will
 *   never help, and saying "retry" sends somebody round a loop that cannot
 *   terminate.
 */

describe('the two capacity failures give different advice', () => {
  test('a momentary shortage says retry, and that nothing needs changing', () => {
    const explanation = explain('the execution host had no capacity for a sandbox');
    expect(explanation.needsAChange).toBe(false);
    expect(explanation.next).toContain('Retry');
    expect(explanation.what).toContain('no room');
  });

  test('the deployment’s own limit says retrying will not help', () => {
    const explanation = explain(
      'the execution host refused a sandbox because its per-class instance limit is reached — ' +
        'this is a deployment setting and will not clear on its own',
    );
    // The assertion that matters. Telling somebody to retry here sends them
    // round a loop that cannot terminate.
    expect(explanation.needsAChange).toBe(true);
    expect(explanation.next).toContain('Retrying will not help');
    expect(explanation.next).toContain('where the execution service is deployed');
  });

  test('the provider’s own wording is recognised too', () => {
    // The message may arrive as the platform wrote it rather than as we
    // rephrased it, depending on where it was caught.
    expect(
      explain('Maximum number of running container instances exceeded (max_instances)')
        .needsAChange,
    ).toBe(true);
    expect(
      explain('There is no container instance that can be provided, try again later').needsAChange,
    ).toBe(false);
  });
});

describe('an ordinary lost sandbox still reads as it did', () => {
  test('the plain code keeps its own explanation', () => {
    // The capacity checks must not swallow the case they sit in front of: a
    // sandbox that disappeared mid-run is a different thing entirely.
    const explanation = explain('sandbox_lost');
    expect(explanation.what).toContain('disappeared');
    expect(explanation.needsAChange).toBe(false);
  });

  test('an unrelated failure is untouched by them', () => {
    expect(explain('command_failed').what).toContain('exited with an error');
    expect(explain('missing_output').needsAChange).toBe(true);
  });
});
