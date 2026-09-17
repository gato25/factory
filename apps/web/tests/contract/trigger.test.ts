import { afterAll, beforeEach, expect, test } from 'bun:test';
import { CALLBACK_EVENTS } from '@factory/shared';
import { deliverTrigger } from '../../src/lib/services/orchestrator';
import { startRun } from '../../src/lib/services/run';
import { connect, type Scenario, seed } from '../fixtures';

/** contracts/orchestrator.md §1 — the trigger body IS the resolved snapshot. */

const { db, sql: raw } = connect();
let scenario: Scenario;

beforeEach(async () => {
  scenario = await seed(db);
});
afterAll(async () => {
  await raw.end();
});

test('the body carries everything the orchestrator needs, and nothing to look up', async () => {
  const { snapshot } = await startRun(db, {
    ticketId: scenario.ticketId,
    callbackBaseUrl: 'https://factory.example',
  });

  // Every field contracts/orchestrator.md §1 names.
  expect(Object.keys(snapshot).sort()).toEqual(
    [
      'agents',
      'attempt',
      'callback_url',
      'limits',
      'pipeline',
      'repo',
      'resume_secret',
      'run_id',
      'sandbox',
      'ticket',
    ].sort(),
  );
  // The sandbox's limits are the administrator's, not the Runner's own
  // defaults: the Runner cannot read a workspace setting, so a snapshot
  // without them means nothing anybody configured applies (FR-085).
  expect(snapshot.sandbox).toEqual({
    image: 'code-factory/sandbox:latest',
    cpu: 2,
    memory_mb: 4096,
    wall_clock_minutes: 90,
    network_during_implement: false,
  });
  expect(snapshot.pipeline.steps.length).toBeGreaterThan(0);
  // Each step names its agent, and that agent travels in the same document.
  for (const step of snapshot.pipeline.steps) {
    if (!step.agent_id) continue;
    expect(snapshot.agents.some((a) => a.id === step.agent_id)).toBe(true);
  }
  // Every step carries a condition, defaulting to always (FR-032a).
  for (const step of snapshot.pipeline.steps) {
    expect(['always', 'ticket_has_ui', 'ticket_has_no_ui']).toContain(step.condition);
  }
});

test('the trigger is posted to the execution service with the snapshot as its body', async () => {
  const { snapshot } = await startRun(db, {
    ticketId: scenario.ticketId,
    callbackBaseUrl: 'https://factory.example',
  });

  let seenUrl = '';
  let seenBody: unknown;
  let seenAuth = '';
  const result = await deliverTrigger(snapshot, {
    baseUrl: 'https://runner.example',
    token: 'runner-token',
    fetch: async (url, init) => {
      seenUrl = String(url);
      seenBody = JSON.parse(String(init?.body));
      seenAuth = String(((init?.headers ?? {}) as Record<string, string>).authorization);
      return new Response(JSON.stringify({ execution_id: snapshot.run_id }), { status: 202 });
    },
  });

  expect(result).toMatchObject({ delivered: true, executionId: snapshot.run_id, attempts: 1 });
  expect(seenUrl).toBe(`https://runner.example/runs/${snapshot.run_id}/execute`);
  expect(seenAuth).toBe('Bearer runner-token');
  expect(seenBody).toEqual(snapshot);
});

test('delivery retries with increasing delays, then reports failure (FR-094)', async () => {
  const { snapshot } = await startRun(db, {
    ticketId: scenario.ticketId,
    callbackBaseUrl: 'https://factory.example',
  });
  const delays: number[] = [];
  const result = await deliverTrigger(snapshot, {
    baseUrl: 'https://runner.example',
    token: 'runner-token',
    fetch: async () => {
      throw new Error('connection refused');
    },
    sleep: async (ms) => {
      delays.push(ms);
    },
  });
  expect(result.delivered).toBe(false);
  expect(result.delivered === false && result.lastError).toContain('connection refused');
  // Increasing, not constant.
  expect(delays).toEqual([1000, 2000, 4000, 8000, 16000]);
});

test('a 4xx is not retried, because waiting will not fix it', async () => {
  const { snapshot } = await startRun(db, {
    ticketId: scenario.ticketId,
    callbackBaseUrl: 'https://factory.example',
  });
  let calls = 0;
  const result = await deliverTrigger(snapshot, {
    baseUrl: 'https://runner.example',
    token: 'runner-token',
    fetch: async () => {
      calls++;
      return new Response('bad path', { status: 404 });
    },
    sleep: async () => {},
  });
  expect(calls).toBe(1);
  expect(result.delivered).toBe(false);
});

test('a 408 IS retried: it is a timeout from a server that stopped reading, not a bad request', async () => {
  // Seen from an n8n that had hung and was then restarted. Giving up on the
  // first answer left the run queued with a stale reason and nothing to retry it.
  const { snapshot } = await startRun(db, {
    ticketId: scenario.ticketId,
    callbackBaseUrl: 'https://factory.example',
  });
  let calls = 0;
  const result = await deliverTrigger(snapshot, {
    baseUrl: 'https://runner.example',
    token: 'runner-token',
    fetch: async () => {
      calls++;
      return calls < 2
        ? new Response('Request Timeout', { status: 408 })
        : new Response(JSON.stringify({ executionId: 'exec_2' }), { status: 200 });
    },
    sleep: async () => {},
  });
  expect(result.delivered).toBe(true);
  expect(calls).toBe(2);
});

test('a 5xx IS retried, then succeeds', async () => {
  const { snapshot } = await startRun(db, {
    ticketId: scenario.ticketId,
    callbackBaseUrl: 'https://factory.example',
  });
  let calls = 0;
  const result = await deliverTrigger(snapshot, {
    baseUrl: 'https://runner.example',
    token: 'runner-token',
    fetch: async () => {
      calls++;
      return calls < 3
        ? new Response('down', { status: 503 })
        : new Response(JSON.stringify({}), { status: 200 });
    },
    sleep: async () => {},
  });
  expect(result.delivered).toBe(true);
  expect(calls).toBe(3);
});

/** contracts/orchestrator.md §3 — the twelve events. */
test('the callback vocabulary is exactly twelve events', () => {
  expect(CALLBACK_EVENTS).toHaveLength(12);
  expect([...CALLBACK_EVENTS]).toEqual([
    'started',
    'step_started',
    'step_finished',
    'step_skipped',
    'ticket_classified',
    'waiting_approval',
    'paused',
    'log_chunk',
    'mr_opened',
    'done',
    'failed',
    'cancelled',
  ]);
});

test('a timeout is NOT retried: the run may already have started', async () => {
  // Retrying after a timeout started the same run three times in parallel,
  // because the body had arrived and only the answer was late.
  const { snapshot } = await startRun(db, {
    ticketId: scenario.ticketId,
    callbackBaseUrl: 'https://factory.example',
  });
  let calls = 0;
  const result = await deliverTrigger(snapshot, {
    baseUrl: 'https://runner.example',
    token: 'runner-token',
    fetch: async () => {
      calls++;
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    },
    sleep: async () => {},
  });
  expect(calls).toBe(1);
  expect(result.delivered).toBe(false);
  expect(result.delivered === false && result.lastError).toContain('may still have started');
});
