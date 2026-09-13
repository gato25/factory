/** Shared failure vocabulary so the app and the Runner classify alike. */
export type FailureReason =
  | 'missing_output'
  | 'budget_exceeded'
  | 'time_exceeded'
  | 'engine_unavailable'
  | 'credential_invalid'
  | 'credential_missing'
  | 'sandbox_lost'
  /**
   * The execution service could not get something it needs FROM THE
   * APPLICATION — a ticket's requirement documents, so far.
   *
   * Distinct from `credential_missing`, which the credentials fetch reuses
   * for the same situation and which sends an administrator to Settings to
   * fix a credential that is not the problem. Since the execution service
   * moved off the application's machine, an unreachable application is an
   * ordinary and separately fixable failure: an address, a firewall, or an
   * application that is down.
   */
  | 'app_unreachable'
  /** The application could not reach the execution service (003). */
  | 'runner_unreachable'
  | 'command_failed'
  | 'not_authorised'
  | 'conflict'
  | 'not_found'
  | 'invalid_input';

/**
 * Carries a reason a person can act on without reading raw output
 * (FR-087, SC-008). `detail` is for the log; `message` is for the human.
 */
export class FactoryError extends Error {
  readonly reason: FailureReason;
  readonly detail?: string;
  readonly status: number;

  constructor(
    reason: FailureReason,
    message: string,
    options?: { detail?: string; status?: number },
  ) {
    super(message);
    this.name = 'FactoryError';
    this.reason = reason;
    this.detail = options?.detail;
    this.status = options?.status ?? statusFor(reason);
  }
}

function statusFor(reason: FailureReason): number {
  switch (reason) {
    case 'not_authorised':
      return 403;
    case 'not_found':
      return 404;
    case 'conflict':
      return 409;
    case 'invalid_input':
      return 400;
    default:
      return 500;
  }
}

export const notAuthorised = (message: string) => new FactoryError('not_authorised', message);
export const notFound = (message: string) => new FactoryError('not_found', message);
export const conflict = (message: string) => new FactoryError('conflict', message);
export const invalidInput = (message: string, detail?: string) =>
  new FactoryError('invalid_input', message, { detail });
