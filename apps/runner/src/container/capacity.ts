import { FactoryError } from '@factory/shared';

/**
 * Waiting out a capacity refusal, and knowing when not to (002 FR-024,
 * FR-024a, C8, D13).
 *
 * Extracted from `hosted.ts` for the reason recorded there: that file imports
 * the sandbox SDK, which reaches `cloudflare:workers`, so nothing in it can be
 * reached from a test. This is logic worth testing — it decides how long a run
 * waits before giving up, and getting it wrong is either a run that fails on a
 * refusal that would have cleared in two seconds, or a run that spends minutes
 * waiting for something only a deploy can fix.
 *
 * **Two failures that read alike and are not.** Both arrive as an error from
 * the same call, and the spike produced both:
 *
 * - *"There is no container instance that can be provided to this Durable
 *   Object, try again later"* — the platform is momentarily out of room. It
 *   clears in seconds, and waiting is exactly right.
 * - *"Maximum number of running container instances exceeded … consider
 *   configuring a higher value for max_instances"* — the deployment's own
 *   declared limit. It will never clear on its own, and the SDK already burns
 *   about 140 seconds retrying it internally before handing it over. Waiting
 *   again spends a run's patience on something no amount of waiting fixes.
 *
 * So the second is refused immediately, with a message saying it is a
 * deployment setting. Telling them apart is the whole value of this file.
 */

/** How long a transient refusal is waited out before the run fails (FR-024). */
export const CAPACITY_RETRY_MS = 30_000;

/** The first pause. Doubles each time, so the window holds ~4 attempts. */
const FIRST_DELAY_MS = 1_000;

/**
 * Whether an error is the deployment's own instance limit rather than the
 * platform being momentarily full.
 *
 * Matched on `max_instances`, which is the words the provider uses and the
 * words a person would have to search for. Deliberately narrow: a false
 * positive here refuses a run that would have succeeded, so anything it does
 * not recognise falls through to being treated as transient and waited out.
 */
export function isDeploymentLimit(message: string): boolean {
  return /max_instances/i.test(message);
}

export interface CapacityOptions {
  /**
   * Whether the platform considers this refusal transient. Injected because
   * the SDK's own predicate knows shapes we would otherwise be guessing at,
   * and because passing it in is what makes this file testable.
   */
  isTransient: (error: unknown) => boolean;
  /** Overridden only by a test, which has no patience for real backoff. */
  windowMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/**
 * Runs `work`, waiting out a transient capacity refusal over a bounded window.
 *
 * Bounded rather than indefinite because a run that waits for ever is worse
 * than a run that fails: the failure is visible and retryable, and the waiting
 * holds a place in the workspace's concurrency limit that a queued run could
 * have used (FR-024b).
 */
export async function withCapacityRetry<T>(
  work: () => Promise<T>,
  options: CapacityOptions,
): Promise<T> {
  const now = options.now ?? Date.now;
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const deadline = now() + (options.windowMs ?? CAPACITY_RETRY_MS);
  let delay = FIRST_DELAY_MS;

  for (;;) {
    try {
      return await work();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (isDeploymentLimit(message)) {
        throw new FactoryError(
          'sandbox_lost',
          'the execution host refused a sandbox because its per-class instance limit is ' +
            'reached — this is a deployment setting and will not clear on its own',
          { detail: message },
        );
      }

      // Not transient, or no time left to wait. Either way the run fails now,
      // with a reason naming capacity so it is distinguishable from a step
      // that failed on its own (FR-024a). `sandbox_lost` is deliberate rather
      // than a new reason: from the run's point of view no sandbox exists, and
      // a single rebuild is the right response.
      if (!options.isTransient(error) || now() + delay >= deadline) {
        throw new FactoryError('sandbox_lost', 'the execution host had no capacity for a sandbox', {
          detail: message,
        });
      }

      await sleep(delay);
      delay *= 2;
    }
  }
}
