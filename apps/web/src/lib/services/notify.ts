import type { Database } from '@factory/db';
import { sql } from 'drizzle-orm';

/**
 * When a write changes a run, it emits a Postgres NOTIFY on a run-scoped
 * channel (research.md D4). Cost then scales with events rather than with
 * viewers × runs, which is what makes SC-004's five-second budget affordable.
 */

/**
 * A channel name is text, but Postgres caps it at 63 bytes, so the run's uuid
 * goes in without its dashes.
 */
export function runChannel(runId: string): string {
  return `run_${runId.replace(/-/g, '')}`;
}

/**
 * NOTIFY payloads are capped at just under 8000 bytes. A small log chunk
 * therefore rides the stream as a payload; a large one is announced as a
 * signal and the viewer fetches it. Either way the viewer sees it — this is
 * about the transport, not about what is visible.
 */
const MAX_INLINE_PAYLOAD = 4000;

export type RunEvent =
  | { event: 'run_changed' }
  | { event: 'step_changed'; stepIndex: number }
  | { event: 'log_chunk'; stepIndex: number; seq: number; stream: string; text: string }
  | { event: 'log_available'; stepIndex: number; seq: number }
  | { event: 'artifact_added'; stepIndex: number; path: string }
  | { event: 'finished'; status: string };

export async function notifyRun(
  database: Database,
  runId: string,
  message: RunEvent,
): Promise<void> {
  let payload = JSON.stringify(message);
  if (payload.length > MAX_INLINE_PAYLOAD && message.event === 'log_chunk') {
    payload = JSON.stringify({
      event: 'log_available',
      stepIndex: message.stepIndex,
      seq: message.seq,
    } satisfies RunEvent);
  }
  await database.execute(sql`select pg_notify(${runChannel(runId)}, ${payload})`);
}

/** The dashboard watches one channel for anything that changes any run. */
export const DASHBOARD_CHANNEL = 'factory_dashboard';

export async function notifyDashboard(database: Database, message: RunEvent): Promise<void> {
  await database.execute(sql`select pg_notify(${DASHBOARD_CHANNEL}, ${JSON.stringify(message)})`);
}
