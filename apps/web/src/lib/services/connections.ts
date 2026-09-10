import type { Database } from '@factory/db';
import { createLogger } from '@factory/shared';
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
  what: 'orchestrator' | 'runner' | 'design';
  state: ConnectionState;
  /** One sentence naming what to do about it. */
  detail: string;
  /** Absent when nothing answered. */
  status?: number;
  ms?: number;
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
}

/**
 * One probe, three outcomes. A 401 or 403 is NOT the same as a timeout, and
 * conflating them is what makes a settings screen useless.
 */
async function probe(
  what: ConnectionResult['what'],
  url: string | null,
  options: { headers?: Record<string, string>; expect?: (body: string) => boolean } = {},
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
    if (options.expect) {
      const body = await response.text();
      if (!options.expect(body)) {
        return { what, state: 'wrong_shape', detail: STATE_TEXT.wrong_shape, status: 200, ms };
      }
    }
    return { what, state: 'reachable', detail: STATE_TEXT.reachable, status: response.status, ms };
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

export async function testOrchestrator(
  database: Database,
  user: SessionUser | null,
  deps: ProbeDeps = {},
): Promise<ConnectionResult> {
  requireAdmin(user);
  const workspace = await getWorkspace(database);
  const base = workspace.orchestratorBaseUrl;
  return probe('orchestrator', base ? `${base.replace(/\/+$/, '')}/healthz` : null, {}, deps);
}

export async function testRunner(
  database: Database,
  user: SessionUser | null,
  deps: ProbeDeps = {},
): Promise<ConnectionResult> {
  requireAdmin(user);
  const workspace = await getWorkspace(database);
  const base = workspace.runnerBaseUrl;
  return probe(
    'runner',
    base ? `${base.replace(/\/+$/, '')}/health` : null,
    // The Runner's own health route answers this shape and nothing else does.
    { expect: (body) => body.includes('"service":"runner"') },
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
    testOrchestrator(database, user, deps),
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

/** Whether the workspace can start a run at all, and what is missing if not. */
export async function readiness(database: Database) {
  const workspace = await getWorkspace(database);
  const missing: string[] = [];
  if (!workspace.orchestratorBaseUrl) missing.push('the orchestration service address');
  if (!workspace.runnerBaseUrl) missing.push('the runner address');
  if (!workspace.hasModelCredential) missing.push('a model credential');
  return { ready: missing.length === 0, missing };
}
