import type { Database } from '@factory/db';
import { repositories } from '@factory/db/schema';
import { createLogger } from '@factory/shared';
import { eq } from 'drizzle-orm';
import type { SessionUser } from './auth';
import { requireAdmin } from './authz';
import { getWorkspace } from './workspace';

/**
 * FR-005a — a connection test that distinguishes reachable-and-authorised
 * from unreachable from unauthorised. Those three call for different actions:
 * fix the address, start the service, or replace the credential. A single
 * "failed" would leave an administrator guessing which.
 */

const log = createLogger('web');

export type ConnectionState =
  | 'unconfigured'
  | 'reachable'
  | 'unreachable'
  | 'unauthorised'
  | 'wrong_shape';

export interface ConnectionResult {
  what: 'runner' | 'design';
  state: ConnectionState;
  /** One sentence naming what to do about it. */
  detail: string;
  /** Absent when nothing answered. */
  status?: number;
  ms?: number;
  /**
   * Which execution host the Runner reports it is configured for (002 FR-012).
   *
   * Read from the probe rather than from this application's own environment,
   * because the Runner is the only thing that knows: it is a separate
   * deployment with its own configuration, and two copies of the answer would
   * eventually disagree — at which point the settings screen would describe
   * limits that the service does not apply. Absent until something answers.
   */
}

const STATE_TEXT: Record<ConnectionState, string> = {
  unconfigured: 'Not configured yet.',
  reachable: 'Reachable, and it accepted our credential.',
  unreachable: 'Nothing answered at that address. Check the address, and that it is running.',
  unauthorised: 'It answered but refused our credential. Replace the credential.',
  wrong_shape: 'Something answered, but not this service. Check the address.',
};

export interface ProbeDeps {
  fetch?: (url: string, init?: RequestInit) => Promise<Response>;
  timeoutMs?: number;
  /**
   * The Runner's token. Read from the environment when absent; passed only
   * where the environment is not the source, which is a test.
   */
  authToken?: string;
}

/**
 * One probe, three outcomes. A 401 or 403 is NOT the same as a timeout, and
 * conflating them is what makes a settings screen useless.
 */
async function probe(
  what: ConnectionResult['what'],
  url: string | null,
  options: {
    headers?: Record<string, string>;
    expect?: (body: string) => boolean;
    /** Anything else worth keeping from a body we are already reading. */
    read?: (body: string) => Partial<ConnectionResult>;
  } = {},
  deps: ProbeDeps = {},
): Promise<ConnectionResult> {
  if (!url) return { what, state: 'unconfigured', detail: STATE_TEXT.unconfigured };

  const doFetch = deps.fetch ?? ((u: string, init?: RequestInit) => fetch(u, init));
  const started = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), deps.timeoutMs ?? 5000);

  try {
    const response = await doFetch(url, {
      method: 'GET',
      headers: options.headers,
      signal: controller.signal,
    });
    const ms = Date.now() - started;

    if (response.status === 401 || response.status === 403) {
      return { what, state: 'unauthorised', detail: STATE_TEXT.unauthorised, status: 401, ms };
    }
    if (!response.ok) {
      return {
        what,
        state: 'unreachable',
        detail: `It answered ${response.status}. ${STATE_TEXT.unreachable}`,
        status: response.status,
        ms,
      };
    }

    // Reachable and authorised is not enough: something else could be
    // listening on that port and answering 200 to everything.
    let extra: Partial<ConnectionResult> = {};
    if (options.expect || options.read) {
      const body = await response.text();
      if (options.expect && !options.expect(body)) {
        return { what, state: 'wrong_shape', detail: STATE_TEXT.wrong_shape, status: 200, ms };
      }
      extra = options.read?.(body) ?? {};
    }
    return {
      what,
      state: 'reachable',
      detail: STATE_TEXT.reachable,
      status: response.status,
      ms,
      ...extra,
    };
  } catch (error) {
    const ms = Date.now() - started;
    const aborted = error instanceof Error && error.name === 'AbortError';
    return {
      what,
      state: 'unreachable',
      detail: aborted
        ? `Nothing answered within ${deps.timeoutMs ?? 5000}ms. ${STATE_TEXT.unreachable}`
        : STATE_TEXT.unreachable,
      ms,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function testRunner(
  database: Database,
  user: SessionUser | null,
  deps: ProbeDeps = {},
): Promise<ConnectionResult> {
  requireAdmin(user);
  const workspace = await getWorkspace(database);
  const base = workspace.runnerBaseUrl;
  // The Runner's token is deployment configuration, not a workspace setting:
  // it comes from the environment, and `getWorkspace` deliberately never
  // returns it (FR-011). Read directly rather than through `loadWebConfig`,
  // whose job is to fail at startup over the WHOLE environment — going
  // through it here would report a missing session secret as a Runner
  // connection fault.
  const token = deps.authToken ?? process.env.RUNNER_AUTH_TOKEN ?? '';
  return probe(
    'runner',
    // `/ready`, not `/health`: health is unauthenticated by design, so
    // probing it can only ever report "reachable" — a wrong token would be
    // reported as accepted, which is the one fault an operator most needs to
    // see (FR-005a).
    base ? `${base.replace(/\/+$/, '')}/ready` : null,
    {
      headers: token ? { authorization: `Bearer ${token}` } : undefined,
      // Reachable and authorised is still not enough: something else could
      // be listening on that port and answering 200 to everything.
      expect: (body) => body.includes('"service":"runner"'),
    },
    deps,
  );
}

/**
 * The design service. Required only where a pipeline contains a design step
 * (FR-005a, FR-083a), so an unconfigured one is not a problem until then —
 * which the result says rather than presenting it as a fault.
 */
export async function testDesign(
  database: Database,
  user: SessionUser | null,
  deps: ProbeDeps & { baseUrl?: string } = {},
): Promise<ConnectionResult> {
  requireAdmin(user);
  const workspace = await getWorkspace(database);
  if (!workspace.hasDesignCredential) {
    return {
      what: 'design',
      state: 'unconfigured',
      detail:
        'No design credential yet. That is only a problem for a pipeline containing a design ' +
        'step, which would fail at that step and say so.',
    };
  }
  const base = deps.baseUrl ?? 'https://api.pen.dev';
  return probe('design', `${base.replace(/\/+$/, '')}/v1/ping`, {}, deps);
}

export async function testEverything(
  database: Database,
  user: SessionUser | null,
  deps: ProbeDeps = {},
): Promise<ConnectionResult[]> {
  requireAdmin(user);
  const results = await Promise.all([
    testRunner(database, user, deps),
    testDesign(database, user, deps),
  ]);
  for (const result of results) {
    if (result.state !== 'reachable' && result.state !== 'unconfigured') {
      log.warn('a workspace connection is not usable', {
        what: result.what,
        state: result.state,
      });
    }
  }
  return results;
}

/**
 * Whether the workspace can start a run at all, and what is missing if not.
 *
 * A connected repository is on the list because no ticket exists without one
 * (FR-012), so a deployment without one cannot start a run however well
 * configured it is. It is also the one item on the list a member can fix
 * themselves.
 */
export async function readiness(database: Database) {
  const workspace = await getWorkspace(database);
  const missing: string[] = [];
  if (!workspace.runnerBaseUrl) missing.push('the runner address');
  if (!workspace.hasModelCredential) missing.push('a model credential');

  const [repository] = await database
    .select({ id: repositories.id })
    .from(repositories)
    .where(eq(repositories.status, 'connected'))
    .limit(1);
  if (!repository) missing.push('a connected repository');

  return { ready: missing.length === 0, missing };
}
