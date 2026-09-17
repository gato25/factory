import type { Database } from '@factory/db';
import { runs } from '@factory/db/schema';
import { createLogger, type PipelineSnapshot } from '@factory/shared';
import { eq } from 'drizzle-orm';
import { loadWebConfig } from '$lib/config';
import { theWorkspace } from './workspace';

/**
 * Handing a run to the orchestrator, which is the execution service: it
 * drives the run from this snapshot to its merge request and reports back
 * through the callbacks (contracts/orchestrator.md). If it cannot be reached
 * the ticket STAYS queued and the author is told the run has not begun
 * (FR-094) — it is never left looking as though it started.
 */

const log = createLogger('web');

/** Increasing delays, as FR-094 requires. */
const BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 16_000];

export interface TriggerDeps {
  /** The execution service's address. */
  baseUrl: string;
  /** Its credential — deployment configuration, never a workspace setting (FR-011). */
  token: string;
  /** Narrowed to the call we actually make, so a test double is a plain
   *  function rather than the whole platform fetch. */
  fetch?: (url: string, init?: RequestInit) => Promise<Response>;
  sleep?: (ms: number) => Promise<void>;
  /** How long one attempt may wait for the answer. */
  timeoutMs?: number;
}

/**
 * Where the execution service is and how to be believed by it.
 *
 * The address from the workspace, because that is what the settings screen
 * configures and its connection test probes — the environment is only where
 * it was seeded from. The credential from the environment, because
 * `getWorkspace` deliberately never returns it (FR-011).
 */
export async function orchestratorAccess(database: Database): Promise<TriggerDeps> {
  const config = loadWebConfig();
  const workspace = await theWorkspace(database);
  return {
    baseUrl: workspace?.runnerBaseUrl?.trim() || config.runnerBaseUrl,
    token: config.runnerAuthToken,
  };
}

export type TriggerResult =
  | { delivered: true; executionId?: string; attempts: number }
  | { delivered: false; attempts: number; lastError: string };

export async function deliverTrigger(
  snapshot: PipelineSnapshot,
  deps: TriggerDeps,
): Promise<TriggerResult> {
  const doFetch = deps.fetch ?? globalThis.fetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const url = `${deps.baseUrl.replace(/\/+$/, '')}/runs/${encodeURIComponent(snapshot.run_id)}/execute`;

  let lastError = 'not attempted';
  for (let attempt = 0; attempt <= BACKOFF_MS.length; attempt++) {
    if (attempt > 0) await sleep(BACKOFF_MS[attempt - 1] as number);
    try {
      const response = await doFetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${deps.token}`,
        },
        body: JSON.stringify(snapshot),
        // The service answers as soon as it has the body. One that does not
        // answer at all is a failed attempt, not a request to wait on.
        signal: AbortSignal.timeout(deps.timeoutMs ?? 30_000),
      });
      if (response.ok) {
        const body = (await response.json().catch(() => ({}))) as { execution_id?: string };
        return { delivered: true, executionId: body.execution_id, attempts: attempt + 1 };
      }
      const text = await response.text().catch(() => '');
      lastError = `the execution service answered ${response.status}${text ? `: ${text.slice(0, 200)}` : ''}`;
      // A 4xx will not fix itself by waiting — except the two that are about
      // time rather than about the request: 408 is what a server that has
      // stopped processing sends when a request sits unread, and 429 is a
      // request to come back later.
      if (
        response.status >= 400 &&
        response.status < 500 &&
        response.status !== 408 &&
        response.status !== 429
      ) {
        return { delivered: false, attempts: attempt + 1, lastError };
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      // A timeout is not a refusal: the body may well have arrived and the
      // run may already be executing. Posting it again would start the same
      // run a second time. So one attempt, and the run is left queued with
      // the reason for a person to decide.
      if (
        error instanceof Error &&
        (error.name === 'TimeoutError' || error.name === 'AbortError')
      ) {
        return {
          delivered: false,
          attempts: attempt + 1,
          lastError:
            'the execution service did not answer in time — it may still have started the run; check it before starting again',
        };
      }
    }
    log.warn('trigger delivery failed, will retry', {
      run_id: snapshot.run_id,
      attempt: attempt + 1,
      lastError,
    });
  }
  return { delivered: false, attempts: BACKOFF_MS.length + 1, lastError };
}

/**
 * What the author sees while a queued ticket has not started. The ticket is
 * deliberately left `queued` rather than failed: delivery is still retriable.
 */
export async function recordDeliveryFailure(database: Database, runId: string, lastError: string) {
  await database
    .update(runs)
    .set({
      failureReason: `not started yet: the execution service could not be reached (${lastError})`,
      updatedAt: new Date(),
    })
    .where(eq(runs.id, runId));
}

export async function recordExecutionId(
  database: Database,
  runId: string,
  executionId: string | undefined,
) {
  await database
    .update(runs)
    .set({
      orchestratorExecutionId: executionId,
      failureReason: null,
      updatedAt: new Date(),
    })
    .where(eq(runs.id, runId));
}

/**
 * Handing a started run to the orchestrator and recording what came of it.
 * Every caller that starts a run needs the same three steps in the same
 * order, and getting the order wrong would leave a run looking failed when it
 * is merely queued (FR-094).
 */
export async function handOver(
  database: Database,
  input: { runId: string; snapshot: PipelineSnapshot },
  deps: Pick<TriggerDeps, 'baseUrl' | 'token' | 'fetch' | 'sleep' | 'timeoutMs'>,
): Promise<{ delivered: boolean; detail?: string }> {
  const delivery = await deliverTrigger(input.snapshot, deps);
  if (!delivery.delivered) {
    await recordDeliveryFailure(database, input.runId, delivery.lastError);
    return { delivered: false, detail: delivery.lastError };
  }
  await recordExecutionId(database, input.runId, delivery.executionId);
  return { delivered: true };
}
