import { afterAll, beforeEach, expect, test } from 'bun:test';
import { runs } from '@factory/db/schema';
import type { Callback } from '@factory/shared';
import { eq } from 'drizzle-orm';
import { applyCallback } from '../../src/lib/services/callbacks';
import { runChannel } from '../../src/lib/services/notify';
import { startRun } from '../../src/lib/services/run';
import { connect, type Scenario, seed } from '../fixtures';

/**
 * SC-004 — what a viewer sees is never more than five seconds behind actual
 * state. The budget is measured here rather than assumed: the transport's own
 * latency is what has to fit inside it, and the margin is the point.
 */

const BUDGET_MS = 5_000;

const { db, sql: raw } = connect();
let scenario: Scenario;
let runId: string;

beforeEach(async () => {
  scenario = await seed(db);
  const started = await startRun(db, {
    ticketId: scenario.ticketId,
    callbackBaseUrl: 'https://factory.example',
  });
  runId = started.run.id;
});
afterAll(async () => {
  await raw.end();
});

/** Latency from the write committing to the notification arriving. */
async function measure(events: Callback[]): Promise<number[]> {
  const latencies: number[] = [];
  const sentAt = new Map<string, number>();

  const listener = await raw.listen(runChannel(runId), (payload) => {
    const parsed = JSON.parse(payload) as { event: string; stepIndex?: number };
    const key = `${parsed.event}:${parsed.stepIndex ?? ''}`;
    const started = sentAt.get(key);
    if (started !== undefined) latencies.push(Date.now() - started);
  });

  try {
    for (const event of events) {
      const key =
        event.event === 'step_started' || event.event === 'step_finished'
          ? `step_changed:${event.step_index}`
          : 'run_changed:';
      sentAt.set(key, Date.now());
      await applyCallback(db, event);
    }
    const deadline = Date.now() + BUDGET_MS;
    while (latencies.length < events.length && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 10));
    }
  } finally {
    await listener.unlisten();
  }
  return latencies;
}

test('every change reaches a viewer inside the five-second budget (SC-004)', async () => {
  const events: Callback[] = [
    { run_id: runId, attempt: 1, step_index: 0, event: 'started', container_id: 'c-1' } as Callback,
    { run_id: runId, attempt: 1, step_index: 0, event: 'step_started' } as Callback,
    {
      run_id: runId,
      attempt: 1,
      step_index: 0,
      event: 'step_finished',
      status: 'done',
      duration_s: 1,
      cost_usd: '0.0100',
      artifacts: [],
    } as Callback,
    { run_id: runId, attempt: 1, step_index: 1, event: 'step_started' } as Callback,
  ];

  const latencies = await measure(events);

  expect(latencies.length).toBe(events.length);
  const worst = Math.max(...latencies);
  expect(worst).toBeLessThan(BUDGET_MS);
  // Report the margin, so a regression is visible before it breaks the budget.
  console.log(
    `staleness: worst ${worst}ms of a ${BUDGET_MS}ms budget ` +
      `(${Math.round((worst / BUDGET_MS) * 100)}% used, ${latencies.length} events)`,
  );
});

test('the transport leaves the budget almost entirely unspent', async () => {
  // The point of LISTEN/NOTIFY over polling: the budget is for the interface
  // to spend, not the transport.
  const latencies = await measure([
    { run_id: runId, attempt: 1, step_index: 0, event: 'step_started' } as Callback,
  ]);
  expect(latencies[0]).toBeLessThan(BUDGET_MS / 10);
});

test('a viewer joining late still sees current state, because state lives in the database', async () => {
  // The stream carries changes; it is not the source of truth. A viewer that
  // subscribes after an event still renders correctly from its query.
  await applyCallback(db, {
    run_id: runId,
    attempt: 1,
    step_index: 0,
    event: 'started',
    container_id: 'c-9',
  } as Callback);

  const [row] = await db
    .select({ status: runs.status, containerId: runs.containerId })
    .from(runs)
    .where(eq(runs.id, runId))
    .limit(1);
  expect(row?.status).toBe('running');
  expect(row?.containerId).toBe('c-9');
});
