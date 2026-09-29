/**
 * How long a git command that crosses the network may take.
 *
 * None of them had a deadline. `git clone`, `git push`, `git fetch` and
 * `git ls-remote` were run with no limit, so a repository host that accepted
 * the connection and then said nothing held the run with it — at the start,
 * or after every step, since each one pushes its work — until the sandbox's
 * own lifetime ended it, ninety minutes later by default. The application saw
 * a run that was simply still going.
 *
 * Two bounds, because they catch different things. The deadline is the most a
 * command may take in all, sized for a large repository over a slow link. The
 * stall setting is what makes a transfer that has STOPPED fail in two minutes
 * rather than at the deadline: git gives up on one that has moved less than a
 * kilobyte a second for that long, while a slow transfer that is still moving
 * is left alone.
 */

/** A clone of a large repository over a slow link. */
export const GIT_CLONE_TIMEOUT_MS = 15 * 60_000;

/** The push that ends a run, which is the one that matters. */
export const GIT_PUSH_TIMEOUT_MS = 10 * 60_000;

/**
 * The push after each step. It is best effort — the branch is pushed again at
 * the end — so a remote that has stalled should cost each step minutes, not
 * a quarter of an hour.
 */
export const GIT_STEP_PUSH_TIMEOUT_MS = 3 * 60_000;

/** A fetch, or a look at what the remote has. */
export const GIT_READ_TIMEOUT_MS = 5 * 60_000;

/** Passed to a git command that crosses the network; see above. */
export const GIT_STALL_ENV: Record<string, string> = {
  GIT_HTTP_LOW_SPEED_LIMIT: '1000',
  GIT_HTTP_LOW_SPEED_TIME: '120',
};

/** "15 minutes", for a sentence a person reads. */
export function minutesOf(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  return `${minutes} minute${minutes === 1 ? '' : 's'}`;
}
