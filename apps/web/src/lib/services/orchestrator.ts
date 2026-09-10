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
  fetch?: typeof globalThis.fetch;
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
      // A 4xx will not fix itself by waiting.
      if (response.status >= 400 && response.status < 500) {
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
