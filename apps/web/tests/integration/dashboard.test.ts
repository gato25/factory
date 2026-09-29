import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { runs, stepResults, tickets, workspaces } from '@factory/db/schema';
import type { PipelineSnapshot, Step } from '@factory/shared';
import { eq } from 'drizzle-orm';
import {
  dashboardFigures,
  dashboardTickets,
  GROUP_ROWS,
  localDate,
  startOfDay,
} from '../../src/lib/services/dashboard';
import { connect, pipelineVersions, type Scenario, seed } from '../fixtures';

/**
 * specs/004-bento-redesign FR-009 to FR-013: what the dashboard reads.
 *
 * The four groups — in progress, needs attention, queued, done this week —
 * each with its count and at most six rows; a step bar per row drawn from the
 * pipeline its run pinned; a queued run saying where it is in the queue; the
 * running step's start, so its time can tick; and the two figures beside the
 * first-attempt one (tested in first-attempt.test.ts): merge requests per day
 * for seven days and today's recorded cost.
 */

const { db, sql: raw } = connect();
let scenario: Scenario;
const DAY = 24 * 60 * 60 * 1000;

beforeEach(async () => {
  scenario = await seed(db);
  // seed()'s own ticket is queued without a run; most tests want a clean list.
  await db.delete(tickets).where(eq(tickets.id, scenario.ticketId));
});
afterAll(async () => {
  await raw.end();
});

/** A pipeline of `n` agent steps, optionally with one step of another kind at `at`. */
function stepsOf(n: number, other?: { at: number; type: Step['type'] }): Step[] {
  return Array.from({ length: n }, (_, i): Step => {
    if (other && other.at === i) {
      return other.type === 'checkpoint'
        ? { type: 'checkpoint', condition: 'always', approvers: 'anyone', on_timeout: 'wait' }
        : { type: other.type, condition: 'always', agent_id: scenario.specAgentId };
    }
    return {
      type: 'agent',
      condition: 'always',
      agent_id: i === n - 1 ? scenario.implementAgentId : scenario.specAgentId,
      output_files: [],
    };
  });
}

function snapshotOf(steps: Step[], name = 'Standard'): PipelineSnapshot {
  return {
    run_id: crypto.randomUUID(),
    attempt: 1,
    ticket: { reference: '#0', title: 't', description: null, acceptance_criteria: [] },
    repo: {
      clone_url: 'https://gitlab.com/x.git',
      default_branch: 'main',
      branch: 'b',
      provider: 'gitlab',
      credential_ref: 'c',
    },
    pipeline: { id: scenario.pipelineId, version: 1, name, steps },
    limits: { cost_ceiling_usd: '5.0000', time_ceiling_minutes: 45 },
    agents: [
      { id: scenario.specAgentId, name: 'Spec' },
      { id: scenario.implementAgentId, name: 'Implement' },
    ],
  } as unknown as PipelineSnapshot;
}

let counter = 700;
async function ticket(input: {
  status: 'draft' | 'queued' | 'running' | 'waiting_approval' | 'done' | 'failed' | 'cancelled';
  run?: {
    status: 'queued' | 'running' | 'waiting_approval' | 'opening_mr' | 'done' | 'failed';
    steps: Step[];
    current?: number | null;
    failureReason?: string;
    finishedDaysAgo?: number;
    createdAt?: Date;
  };
  updatedMinutesAgo?: number;
  mergeRequest?: boolean;
}) {
  counter += 1;
  const updatedAt = new Date(Date.now() - (input.updatedMinutesAgo ?? 0) * 60_000);
  const [row] = await db
    .insert(tickets)
    .values({
      repositoryId: scenario.repositoryId,
      createdBy: scenario.userId,
      reference: `#${counter}`,
      title: `Ticket ${counter}`,
      acceptanceCriteria: ['it works'],
      pipelineId: scenario.pipelineId,
      pipelineVersion: 1,
      status: input.status,
      mergeRequestUrl: input.mergeRequest
        ? `https://gitlab.com/x/-/merge_requests/${counter}`
        : null,
      updatedAt,
    })
    .returning();
  if (!input.run) return { ticketId: row!.id, reference: row!.reference, runId: null };
  const finishedAt =
    input.run.finishedDaysAgo === undefined
      ? null
      : new Date(Date.now() - input.run.finishedDaysAgo * DAY);
  const [run] = await db
    .insert(runs)
    .values({
      ticketId: row!.id,
      attempt: 1,
      snapshot: snapshotOf(input.run.steps),
      status: input.run.status,
      currentStepIndex: input.run.current ?? null,
      failureReason: input.run.failureReason ?? null,
      failureStepIndex: input.run.status === 'failed' ? (input.run.current ?? null) : null,
      costCeilingUsd: '5.0000',
      timeCeilingMinutes: 45,
      finishedAt,
      updatedAt,
      createdAt: input.run.createdAt ?? new Date(),
    })
    .returning();
  await db.update(tickets).set({ currentRunId: run!.id }).where(eq(tickets.id, row!.id));
  return { ticketId: row!.id, reference: row!.reference, runId: run!.id };
}

describe('the four groups (FR-009)', () => {
  test('each ticket is under the heading its state belongs to, with a count', async () => {
    const running = await ticket({
      status: 'running',
      run: { status: 'running', steps: stepsOf(2), current: 0 },
    });
    const waiting = await ticket({
      status: 'waiting_approval',
      run: {
        status: 'waiting_approval',
        steps: stepsOf(3, { at: 1, type: 'checkpoint' }),
        current: 1,
      },
    });
    const opening = await ticket({
      status: 'running',
      run: { status: 'opening_mr', steps: stepsOf(2), current: 1 },
    });
    const failed = await ticket({
      status: 'failed',
      run: { status: 'failed', steps: stepsOf(2), current: 1, failureReason: 'Tests failed.' },
    });
    const queued = await ticket({
      status: 'queued',
      run: { status: 'queued', steps: stepsOf(2) },
    });
    const unstarted = await ticket({ status: 'queued' });
    const done = await ticket({
      status: 'done',
      mergeRequest: true,
      run: { status: 'done', steps: stepsOf(2), current: 1, finishedDaysAgo: 2 },
    });
    // Outside every group: finished too long ago, a draft, and a cancelled one.
    await ticket({
      status: 'done',
      mergeRequest: true,
      run: { status: 'done', steps: stepsOf(2), current: 1, finishedDaysAgo: 8 },
    });
    await ticket({ status: 'draft' });
    await ticket({ status: 'cancelled' });

    const groups = await dashboardTickets(db);
    const ids = (group: keyof typeof groups) => groups[group].rows.map((row) => row.ticketId);

    expect(ids('inProgress').sort()).toEqual(
      [running.ticketId, waiting.ticketId, opening.ticketId].sort(),
    );
    expect(ids('needsAttention')).toEqual([failed.ticketId]);
    expect(ids('queued').sort()).toEqual([queued.ticketId, unstarted.ticketId].sort());
    expect(ids('done')).toEqual([done.ticketId]);
    expect([
      groups.inProgress.count,
      groups.needsAttention.count,
      groups.queued.count,
      groups.done.count,
    ]).toEqual([3, 1, 2, 1]);
    expect(groups.inProgress.more).toBe(0);

    const statusOf = (id: string) =>
      Object.values(groups)
        .flatMap((group) => group.rows)
        .find((row) => row.ticketId === id)!.status;
    expect(statusOf(waiting.ticketId).kind).toBe('waiting');
    // A checkpoint is named by what it gates.
    expect(statusOf(waiting.ticketId).step).toEqual({ name: 'Spec', type: 'agent' });
    expect(statusOf(opening.ticketId)).toMatchObject({ kind: 'running', step: null });
    expect(statusOf(failed.ticketId)).toMatchObject({
      kind: 'failed',
      failureReason: 'Tests failed.',
      step: { name: 'Implement', type: 'agent' },
    });
    expect(statusOf(done.ticketId).mergeRequestUrl).toContain('/merge_requests/');
  });

  test('a group shows at most six rows, most recently changed first, and counts the rest', async () => {
    const made: string[] = [];
    for (let i = 0; i < GROUP_ROWS + 2; i += 1) {
      const row = await ticket({
        status: 'running',
        updatedMinutesAgo: i * 10,
        run: { status: 'running', steps: stepsOf(2), current: 0 },
      });
      made.push(row.ticketId);
    }
    const { inProgress } = await dashboardTickets(db);
    expect(inProgress.count).toBe(GROUP_ROWS + 2);
    expect(inProgress.rows).toHaveLength(GROUP_ROWS);
    expect(inProgress.more).toBe(2);
    expect(inProgress.rows.map((row) => row.ticketId)).toEqual(made.slice(0, GROUP_ROWS));
  });
});

describe('each row (FR-010)', () => {
  test('bars of three and six segments come from the pinned snapshot', async () => {
    const short = await ticket({
      status: 'running',
      run: { status: 'running', steps: stepsOf(2), current: 1 },
    });
    const long = await ticket({
      status: 'running',
      run: { status: 'running', steps: stepsOf(5, { at: 2, type: 'design' }), current: 2 },
    });
    // The pipeline changes after the runs pinned it; the bars do not.
    await db
      .update(pipelineVersions)
      .set({ steps: stepsOf(7) })
      .where(eq(pipelineVersions.pipelineId, scenario.pipelineId));

    const { inProgress } = await dashboardTickets(db);
    const row = (id: string) => inProgress.rows.find((r) => r.ticketId === id)!;
    expect(row(short.ticketId).steps).toMatchObject({ count: 3, current: 1, state: 'running' });
    expect(row(long.ticketId).steps).toMatchObject({ count: 6, current: 2, state: 'running' });
    expect(row(long.ticketId).steps.kinds[2]).toBe('design');
    expect(row(long.ticketId).status.step).toEqual({ name: 'Spec', type: 'design' });
    expect(row(short.ticketId).pipeline).toBe('Standard');
    expect(row(short.ticketId).repository).toBe('shop-frontend');
  });

  test('a queued ticket without a run is drawn from its pinned version, nothing current', async () => {
    const unstarted = await ticket({ status: 'queued' });
    const { queued } = await dashboardTickets(db);
    const row = queued.rows.find((r) => r.ticketId === unstarted.ticketId)!;
    // seed()'s pipeline version has two steps, plus the merge request.
    expect(row.steps).toMatchObject({ count: 3, current: null, state: 'queued' });
    expect(row.status).toMatchObject({ kind: 'queued', queuePosition: null });
  });

  test('a queued run behind a full workspace carries its place in the queue', async () => {
    await db.update(workspaces).set({ maxConcurrentRuns: 1 });
    await ticket({
      status: 'running',
      run: {
        status: 'running',
        steps: stepsOf(2),
        current: 0,
        createdAt: new Date(Date.now() - 3 * 60_000),
      },
    });
    const first = await ticket({
      status: 'queued',
      run: { status: 'queued', steps: stepsOf(2), createdAt: new Date(Date.now() - 2 * 60_000) },
    });
    const second = await ticket({
      status: 'queued',
      run: { status: 'queued', steps: stepsOf(2), createdAt: new Date(Date.now() - 60_000) },
    });

    const { queued } = await dashboardTickets(db);
    const position = (id: string) =>
      queued.rows.find((r) => r.ticketId === id)!.status.queuePosition;
    expect(position(first.ticketId)).toBe(1);
    expect(position(second.ticketId)).toBe(2);
  });

  test("a running step's start is carried; nothing else has one", async () => {
    const started = new Date(Date.now() - 4 * 60_000);
    const running = await ticket({
      status: 'running',
      run: { status: 'running', steps: stepsOf(2), current: 1 },
    });
    await db.insert(stepResults).values([
      {
        runId: running.runId!,
        stepIndex: 0,
        status: 'done',
        startedAt: new Date(Date.now() - 9 * 60_000),
        finishedAt: started,
      },
      { runId: running.runId!, stepIndex: 1, status: 'running', startedAt: started },
    ]);
    const waiting = await ticket({
      status: 'waiting_approval',
      run: {
        status: 'waiting_approval',
        steps: stepsOf(3, { at: 1, type: 'checkpoint' }),
        current: 1,
      },
    });

    const { inProgress } = await dashboardTickets(db);
    const row = (id: string) => inProgress.rows.find((r) => r.ticketId === id)!;
    expect(row(running.ticketId).status.since).toBe(started.toISOString());
    expect(row(running.ticketId).status.step).toEqual({ name: 'Implement', type: 'agent' });
    expect(row(waiting.ticketId).status.since).toBeNull();
  });
});

describe('the figures beside the list (FR-013)', () => {
  test('merge requests per day: seven days, oldest first, zero days present, today marked', async () => {
    const now = new Date();
    const noonDaysAgo = (n: number) => {
      const day = startOfDay(now);
      day.setDate(day.getDate() - n);
      day.setHours(12);
      return day;
    };
    const finish = async (daysAgo: number, status: 'done' | 'failed' = 'done') => {
      const row = await ticket({
        status: status === 'done' ? 'done' : 'failed',
        mergeRequest: status === 'done',
        run: { status, steps: stepsOf(2), current: 1 },
      });
      const at =
        daysAgo === 0
          ? new Date(Math.max(startOfDay(now).getTime(), now.getTime() - 60_000))
          : noonDaysAgo(daysAgo);
      await db.update(runs).set({ finishedAt: at }).where(eq(runs.id, row.runId!));
    };
    await finish(0);
    await finish(1);
    await finish(1);
    await finish(4);
    await finish(6);
    await finish(7); // eight days back counting today: outside the week
    await finish(2, 'failed'); // failed runs opened nothing

    const figures = await dashboardFigures(db, now);
    const days = figures.mergeRequestsByDay;
    expect(days).toHaveLength(7);
    expect(days.map((day) => day.count)).toEqual([1, 0, 1, 0, 0, 2, 1]);
    expect(days.map((day) => day.today)).toEqual([false, false, false, false, false, false, true]);
    expect(days[6]!.date).toBe(localDate(now));
    expect(days[0]!.date).toBe(localDate(noonDaysAgo(6)));
    expect(figures.mergeRequestsTotal).toBe(5);
  });

  test('a week with nothing opened is seven zero days, not an empty chart', async () => {
    const figures = await dashboardFigures(db);
    expect(figures.mergeRequestsByDay.map((day) => day.count)).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(figures.mergeRequestsTotal).toBe(0);
    expect(figures.tokensToday).toBe(0);
  });

  test("today's tokens are the sum of every count on the steps finished since midnight", async () => {
    const now = new Date();
    const midnight = startOfDay(now);
    const row = await ticket({
      status: 'running',
      run: { status: 'running', steps: stepsOf(4), current: 3 },
    });
    const todayAt = new Date(Math.max(midnight.getTime(), now.getTime() - 60_000));
    await db.insert(stepResults).values([
      // Two steps finished today. Every one of the four counts is part of the
      // figure: the cache reads are usually most of it.
      {
        runId: row.runId!,
        stepIndex: 0,
        status: 'done',
        finishedAt: todayAt,
        inputTokens: 100,
        outputTokens: 2_000,
        cacheReadTokens: 30_000,
        cacheCreationTokens: 400,
      },
      {
        runId: row.runId!,
        stepIndex: 1,
        status: 'done',
        finishedAt: todayAt,
        inputTokens: 5,
        outputTokens: 60,
        cacheReadTokens: 700,
        cacheCreationTokens: 0,
      },
      // Killed before its engine reported usage: nothing to add.
      { runId: row.runId!, stepIndex: 2, status: 'failed', finishedAt: todayAt },
      // Finished yesterday, and the one still running: neither is today's.
      {
        runId: row.runId!,
        stepIndex: 3,
        status: 'running',
        startedAt: new Date(midnight.getTime() - 60_000),
        inputTokens: 9_000,
        outputTokens: 9_000,
      },
    ]);
    const other = await ticket({
      status: 'done',
      mergeRequest: true,
      run: { status: 'done', steps: stepsOf(1), current: 0 },
    });
    await db.insert(stepResults).values({
      runId: other.runId!,
      stepIndex: 0,
      status: 'done',
      finishedAt: new Date(midnight.getTime() - 60_000),
      inputTokens: 4_000,
      outputTokens: 4_000,
    });

    const figures = await dashboardFigures(db, now);
    expect(figures.tokensToday).toBe(100 + 2_000 + 30_000 + 400 + (5 + 60 + 700));
  });

  test('a day of very large runs is summed without overflowing a 32-bit count', async () => {
    const now = new Date();
    const midnight = startOfDay(now);
    const row = await ticket({
      status: 'running',
      run: { status: 'running', steps: stepsOf(3), current: 2 },
    });
    const todayAt = new Date(Math.max(midnight.getTime(), now.getTime() - 60_000));
    // Each column is a 32-bit integer and each of these is near its ceiling;
    // three of them add to far more than one can hold.
    const big = 2_000_000_000;
    const runId = row.runId as string;
    await db.insert(stepResults).values(
      [0, 1, 2].map((stepIndex) => ({
        runId,
        stepIndex,
        status: 'done' as const,
        finishedAt: todayAt,
        cacheReadTokens: big,
      })),
    );
    const figures = await dashboardFigures(db, now);
    expect(figures.tokensToday).toBe(3 * big);
  });

  test('the first-attempt figure is the shared function over thirty days', async () => {
    const figures = await dashboardFigures(db);
    // Nothing decided in the window: nothing to measure, which is not 0%.
    expect(figures.firstAttempt).toEqual({ counted: 0, successes: 0, rate: null });
  });
});
