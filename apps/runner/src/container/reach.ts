/**
 * How long one request to the application or a provider may take.
 *
 * Every call the runner makes out of its own process — for a run's
 * credentials, for a ticket's requirement documents, for the merge request
 * body, to open the merge request — is one request answered by one lookup
 * or one write on the other side. None of them has a reason to take longer
 * than this; one that does has hung, and a hung request held the run with
 * it: the loop awaited it, the sandbox's `sleep` ran on, and nothing said so
 * until the wall-clock ceiling did. A timeout turns that into a failure the
 * caller can name, or retry.
 *
 * One number for all of them, so the question "how long does the runner
 * wait on the application?" has one answer.
 */
export const REACH_TIMEOUT_MS = 30_000;

/** A fresh signal for one request. */
export function reachSignal(timeoutMs = REACH_TIMEOUT_MS): AbortSignal {
  return AbortSignal.timeout(timeoutMs);
}
