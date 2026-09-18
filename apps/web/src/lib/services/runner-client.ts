import type { Database } from '@factory/db';
import { FactoryError } from '@factory/shared';
import { theWorkspace } from './workspace';

/**
 * The application calling the execution service directly.
 *
 * Runs go through the orchestrator; launches do not, because a launch is a
 * person pressing a button and looking at the answer, not a pipeline being
 * driven step by step. So the application talks to the execution service the
 * way the connection test already does: the address from Settings, the
 * credential from the environment — never from the database, which
 * `getWorkspace` deliberately never returns it from (FR-011).
 */

export interface RunnerClient {
  request(path: string, init?: RequestInit): Promise<Response>;
  /** The host a launch's loopback address is reachable on, for building URLs. */
  hostname(): string;
}

export async function runnerClient(
  database: Database,
  deps: { fetch?: typeof fetch; authToken?: string; timeoutMs?: number } = {},
): Promise<RunnerClient> {
  const workspace = await theWorkspace(database);
  const base = workspace?.runnerBaseUrl?.replace(/\/+$/, '');
  if (!base) {
    throw new FactoryError('invalid_input', 'Ажиллуулагчийн хаяг Тохиргоонд заагдаагүй байна.');
  }
  const token = deps.authToken ?? process.env.RUNNER_AUTH_TOKEN ?? '';
  const doFetch = deps.fetch ?? fetch;
  const origin = new URL(base);

  return {
    hostname: () => origin.hostname,
    async request(path, init = {}) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? 15_000);
      try {
        return await doFetch(`${base}${path}`, {
          ...init,
          headers: {
            'content-type': 'application/json',
            ...(init.headers as Record<string, string> | undefined),
            authorization: `Bearer ${token}`,
          },
          signal: controller.signal,
        });
      } catch (error) {
        // The origin and not the path: a path can carry an identifier, and an
        // error message travels further than a log line does.
        throw new FactoryError(
          'runner_unreachable',
          `The execution service at ${origin.origin} did not answer.`,
          { detail: error instanceof Error ? error.message : String(error) },
        );
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
