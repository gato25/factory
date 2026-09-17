import type { Database } from '@factory/db';
import { runs } from '@factory/db/schema';
import { createLogger, type PipelineSnapshot } from '@factory/shared';
import { eq } from 'drizzle-orm';

/**
 * Delivering the trigger. If the orchestrator cannot be reached the ticket
 * STAYS queued and the author is told the run has not begun (FR-094) — it is
 * never left looking as though it started.
 */

const log = createLogger('web');

/** Increasing delays, as FR-094 requires. */
const BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 16_000];

export interface TriggerDeps {
  baseUrl: string;
  apiKey?: string;
  workflowPath?: string;
  /** Narrowed to the call we actually make, so a test double is a plain
   *  function rather than the whole platform fetch. */
  fetch?: (url: string, init?: RequestInit) => Promise<Response>;
  sleep?: (ms: number) => Promise<void>;
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
  const path = deps.workflowPath ?? '/webhook/run-ticket-pipeline';
  const url = new URL(path, deps.baseUrl).toString();

  let lastError = 'not attempted';
  for (let attempt = 0; attempt <= BACKOFF_MS.length; attempt++) {
    if (attempt > 0) await sleep(BACKOFF_MS[attempt - 1] as number);
    try {
      const response = await doFetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(deps.apiKey ? { 'X-N8N-API-KEY': deps.apiKey } : {}),
        },
        body: JSON.stringify(snapshot),
      });
      if (response.ok) {
        const body = (await response.json().catch(() => ({}))) as { executionId?: string };
        return { delivered: true, executionId: body.executionId, attempts: attempt + 1 };
      }
      lastError = `orchestrator answered ${response.status}`;
      // A 4xx will not fix itself by waiting — except the two that are about
      // time rather than about the request: 408 is what a server that has
      // stopped processing sends when a request sits unread, and 429 is a
      // request to come back later. Both were seen from an n8n that had hung
      // and was then restarted; giving up on them left the run queued for ever.
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
      failureReason: `not started yet: the orchestrator could not be reached (${lastError})`,
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
  deps: Pick<TriggerDeps, 'baseUrl' | 'apiKey' | 'fetch' | 'sleep' | 'workflowPath'>,
): Promise<{ delivered: boolean; detail?: string }> {
  const delivery = await deliverTrigger(input.snapshot, deps);
  if (!delivery.delivered) {
    await recordDeliveryFailure(database, input.runId, delivery.lastError);
    return { delivered: false, detail: delivery.lastError };
  }
  await recordExecutionId(database, input.runId, delivery.executionId);
  return { delivered: true };
}
