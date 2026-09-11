import { FactoryError } from '@factory/shared';

/**
 * The execution service authenticates every operation that creates, inspects,
 * uses or releases a sandbox (002 FR-018), and a refused request reveals
 * nothing about whether the run it names exists (002 FR-019).
 *
 * That used to be defence in depth behind a private network. Once the service
 * is hosted it has a public address by construction, so this is the whole
 * boundary — which is why the constitution's Principle V now states
 * authentication, non-disclosure on refusal, and credential replaceability as
 * obligations rather than leaving them to a feature to remember.
 */
export function authenticate(
  request: Request,
  expectedToken: string,
  previousToken?: string,
): void {
  const header = request.headers.get('authorization') ?? '';
  const presented = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!accepts(presented, expectedToken, previousToken)) {
    throw new FactoryError('not_authorised', 'unauthorised');
  }
}

/**
 * Whether a presented credential is one this deployment currently accepts
 * (002 FR-018a).
 *
 * The problem this solves: replacing the credential is a two-sided change — the
 * service is told the new one and every caller is told the new one — and those
 * two cannot happen in the same instant. With one accepted credential, the gap
 * between them fails every request, which means failing runs in flight for a
 * routine rotation. So a deployment may name the outgoing credential as well,
 * and BOTH are accepted until it is removed.
 *
 * The window is closed by configuration, not by a timer here, because only the
 * operator knows when the last caller has been updated. Removing the variable
 * is what refuses the replaced credential — one deploy, and immediate.
 *
 * Both comparisons always run. Returning as soon as the current credential
 * matches would make a request carrying it measurably faster than one carrying
 * the previous, which tells an attacker which of the two they hold.
 */
export function accepts(presented: string, current: string, previous?: string): boolean {
  const matchesCurrent = constantTimeEqual(presented, current);
  // An empty or absent previous credential must never match, including when the
  // presented credential is itself empty — which is what a request with no
  // authorization header at all presents.
  const matchesPrevious = previous ? constantTimeEqual(presented, previous) : false;
  return matchesCurrent || matchesPrevious;
}

/**
 * Whether two strings are equal, in time that does not depend on where they
 * first differ.
 *
 * Written here rather than taken from `node:crypto`, which was this module's
 * only Node import and the only thing standing between the service and a
 * runtime that does not provide one (002 D12).
 *
 * The loop runs a fixed number of iterations for a given pair of lengths and
 * accumulates differences instead of returning at the first one, so a
 * credential that is wrong in its first character takes as long to reject as
 * one wrong in its last. The iteration count varies with the PRESENTED
 * string's length, which the caller already knows; it never varies with the
 * secret's, which is what would leak. `charCodeAt` past the end yields NaN,
 * which coerces to 0 in a bitwise operation — harmless, because a length
 * mismatch has already made the accumulator non-zero.
 */
export function constantTimeEqual(presented: string, expected: string): boolean {
  let difference = presented.length ^ expected.length;
  const length = Math.max(presented.length, expected.length);
  for (let index = 0; index < length; index += 1) {
    difference |= presented.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return difference === 0;
}
