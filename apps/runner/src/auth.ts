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
export function authenticate(request: Request, expectedToken: string): void {
  const header = request.headers.get('authorization') ?? '';
  const presented = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!constantTimeEqual(presented, expectedToken)) {
    throw new FactoryError('not_authorised', 'unauthorised');
  }
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
