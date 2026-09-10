import { timingSafeEqual } from 'node:crypto';
import { FactoryError } from '@factory/shared';

/**
 * The Runner is never reachable from the public internet and authenticates
 * every call per run (contracts/runner.md). A rejected call must not reveal
 * whether the run exists.
 */
export function authenticate(request: Request, expectedToken: string): void {
  const header = request.headers.get('authorization') ?? '';
  const presented = header.startsWith('Bearer ') ? header.slice(7) : '';
  const a = Buffer.from(presented);
  const b = Buffer.from(expectedToken);
  const ok = a.length === b.length && timingSafeEqual(a, b);
  if (!ok) {
    throw new FactoryError('not_authorised', 'unauthorised');
  }
}

/** Uniform response for any rejection: the same body whatever went wrong. */
export function unauthorisedResponse(): Response {
  return Response.json({ error: 'unauthorised' }, { status: 401 });
}
