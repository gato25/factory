import { createLogger, FactoryError } from '@factory/shared';

export const log = createLogger('runner');

/** Every rejection looks the same from outside (contracts/runner.md). */
export function toResponse(error: unknown): Response {
  if (error instanceof FactoryError) {
    if (error.reason === 'not_authorised') {
      log.warn('rejected an unauthorised call');
      return Response.json({ error: 'unauthorised' }, { status: 401 });
    }
    log.error(error.message, { reason: error.reason, detail: error.detail });
    return Response.json({ error: error.message, reason: error.reason }, { status: error.status });
  }
  log.error('unhandled failure', {
    detail: error instanceof Error ? error.message : String(error),
  });
  return Response.json({ error: 'internal error' }, { status: 500 });
}
