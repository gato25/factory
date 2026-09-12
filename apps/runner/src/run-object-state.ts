import type { RunRecord } from './runs';

/**
 * What a run's Durable Object keeps, and the one calculation it does.
 *
 * Separate from `worker.ts` for the reason stated there: that file imports the
 * sandbox SDK and so cannot be reached from a test. The alarm time is the part
 * worth testing — it is the difference between a run stopping at the ceiling an
 * administrator configured and a run stopping an hour late, or immediately.
 */

export interface RunObjectState {
  record: RunRecord;
  /**
   * When the wall-clock ceiling falls due, as an absolute millisecond time.
   *
   * Absolute and set once. A duration re-derived on each write would be a
   * ceiling the run could extend indefinitely by taking more steps.
   */
  deadline: number;
}

/**
 * The shortest wall-clock ceiling worth acting on.
 *
 * A guard against a snapshot that carries no ceiling, or a zero. Without it,
 * `deadlineFor` would return a time already past and the alarm would release
 * the sandbox before the first step ran — a run killed instantly by a missing
 * field, which is a far worse failure than a run allowed a few extra minutes.
 */
const FLOOR_MINUTES = 5;

/**
 * When a run's wall-clock ceiling falls due (FR-009a, FR-010).
 *
 * Exactly the configured number of minutes from the moment the run started, not
 * rounded to anything. The ceiling is an administrator's figure and rounding it
 * up to some allocation the execution host happens to offer would hand runs
 * time nobody granted them; rounding it down would stop runs before their own
 * limit. So: multiply, and add.
 */
export function deadlineFor(record: RunRecord, now: number): number {
  const minutes = record.sandbox?.wallClockMinutes;
  const effective =
    Number.isFinite(minutes) && (minutes as number) > 0 ? (minutes as number) : FLOOR_MINUTES;
  return now + Math.max(effective, FLOOR_MINUTES) * 60_000;
}
