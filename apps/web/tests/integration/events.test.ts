import { afterAll, beforeEach, expect, test } from 'bun:test';
import type { Callback } from '@factory/shared';
import { applyCallback } from '../../src/lib/services/callbacks';
import {
  DASHBOARD_CHANNEL,
  notifyRun,
  type RunEvent,
  runChannel,
} from '../../src/lib/services/notify';
import { startRun } from '../../src/lib/services/run';
import { connect, type Scenario, seed } from '../fixtures';

/**
 * Proves the live-update transport against a real Postgres (T087). Cost
 * scales with events rather than with viewers × runs, which is what makes
 * SC-004's five-second budget affordable (D4).
 */

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

/** Collects notifications on a channel for the duration of one action. */
async function watch(channel: string, action: () => Promise<unknown>): Promise<RunEvent[]> {
  const received: RunEvent[] = [];
  const listener = await raw.listen(channel, (payload) => {
    received.push(JSON.parse(payload) as RunEvent);
  });
  try {
    await action();
    // NOTIFY is delivered on commit; give the driver a moment to dispatch.
    const deadline = Date.now() + 2_000;
    while (received.length === 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20));
    }
    await new Promise((r) => setTimeout(r, 50));
  } finally {
    await listener.unlisten();
  }
  return received;
}

test('a channel name fits Postgres, uuid dashes and all', () => {
  const channel = runChannel('11111111-2222-3333-4444-555555555555');
  expect(channel).toBe('run_11111111222233334444555555555555');
  expect(channel.length).toBeLessThan(64);
});

test('a callback write reaches a subscriber on the run channel', async () => {
  const events = await watch(runChannel(runId), () =>
    applyCallback(db, {
      run_id: runId,
      attempt: 1,
      step_index: 0,
      event: 'step_started',
    } as Callback),
  );
  expect(events).toContainEqual({ event: 'step_changed', stepIndex: 0 });
});

test('the dashboard channel sees the same change, so both views update (FR-072)', async () => {
  const events = await watch(DASHBOARD_CHANNEL, () =>
    applyCallback(db, {
      run_id: runId,
      attempt: 1,
      step_index: 0,
      event: 'started',
      container_id: 'c-1',
    } as Callback),
  );
  expect(events).toContainEqual({ event: 'run_changed' });
});

test('a log chunk rides the stream as a payload, not as a signal (D4)', async () => {
  const events = await watch(runChannel(runId), () =>
    applyCallback(db, {
      run_id: runId,
      attempt: 1,
      step_index: 0,
      event: 'log_chunk',
      seq: 1,
      stream: 'stdout',
      text: 'cloning shop-frontend…',
    } as Callback),
  );
  const chunk = events.find((e) => e.event === 'log_chunk');
  expect(chunk).toBeDefined();
  expect(chunk?.event === 'log_chunk' && chunk.text).toContain('cloning shop-frontend');
});

test('a log chunk too large for a NOTIFY degrades to a signal, never to silence', async () => {
  // Postgres caps a payload at just under 8000 bytes.
  const huge = 'x'.repeat(6_000);
  const events = await watch(runChannel(runId), () =>
    notifyRun(db, runId, {
      event: 'log_chunk',
      stepIndex: 0,
      seq: 9,
      stream: 'stdout',
      text: huge,
    }),
  );
  expect(events).toContainEqual({ event: 'log_available', stepIndex: 0, seq: 9 });
});

test('a finished run announces its outcome so a viewer stops waiting', async () => {
  const events = await watch(runChannel(runId), () =>
    applyCallback(db, {
      run_id: runId,
      attempt: 1,
      step_index: 0,
      event: 'failed',
      step_index_failed: 0,
      reason: 'the step produced no document',
    } as unknown as Callback),
  );
  expect(events.some((e) => e.event === 'finished')).toBe(true);
});

test('a duplicate callback announces nothing, so viewers do not flicker', async () => {
  const finished = {
    run_id: runId,
    attempt: 1,
    step_index: 0,
    event: 'step_finished',
    status: 'done',
    duration_s: 2,
    cost_usd: '0.1000',
    artifacts: [],
  } as Callback;

  const first = await watch(runChannel(runId), () => applyCallback(db, finished));
  expect(first.length).toBeGreaterThan(0);

  const second = await watch(runChannel(runId), () => applyCallback(db, finished));
  expect(second).toEqual([]);
});

test('an artifact announces its path, so a viewer can fetch just that one', async () => {
  const events = await watch(runChannel(runId), () =>
    applyCallback(db, {
      run_id: runId,
      attempt: 1,
      step_index: 0,
      event: 'step_finished',
      status: 'done',
      duration_s: 3,
      cost_usd: '0.2000',
      artifacts: [{ kind: 'document', path: 'docs/spec.md', version: 1 }],
    } as Callback),
  );
  expect(events).toContainEqual({
    event: 'artifact_added',
    stepIndex: 0,
    path: 'docs/spec.md',
  });
});
