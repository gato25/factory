import type { Database } from '@factory/db';
import { pipelines, repositories, runs, stepResults, tickets } from '@factory/db/schema';
import type { PipelineSnapshot, Step, StepType } from '@factory/shared';
import { and, desc, eq, gte, inArray, or, sql } from 'drizzle-orm';
import type { RunStatus, StepShape } from '$lib/step-shape';
import { firstAttempt } from './first-attempt';
import { queueState } from './queue';
import { stepShapes } from './run-view';

/**
 * What the dashboard reads (specs/004-bento-redesign FR-009 to FR-013,
 * data-model DashboardTickets and the three figures).
 *
 * Everything here is derived from rows that already record what happened —
 * tickets, runs, step results — and nothing is written back. Each read is one
 * round trip whatever the number of tickets: the step bars, the queue and the
 * running times are each asked for once for the whole list, never per row.
 */

/** A group shows this many rows and counts the rest (spec edge case "many tickets"). */
export const GROUP_ROWS = 6;

export interface DashboardStatus {
  kind: 'running' | 'waiting' | 'failed' | 'queued' | 'done';
  /**
   * The step it is on, under the name the pipeline stored — the screen says
   * a shipped default's in the catalogue's words (FR-028). For a run waiting
   * at a checkpoint, the step the checkpoint gates. `null` while the merge
   * request is being opened, and before anything has started.
   */
  step: { name: string; type: StepType } | null;
  /** When the running step started, so its time can tick without a refetch. */
  since: string | null;
  /** Its place in the sandbox queue; `null` when it can start as soon as it is picked up. */
  queuePosition: number | null;
  failureReason: string | null;
  mergeRequestUrl: string | null;
}

export interface DashboardTicket {
  ticketId: string;
  reference: string;
  title: string;
  repository: string;
  /** The stored name: the run's pinned pipeline, or the one the ticket will use. */
  pipeline: string | null;
  steps: StepShape;
  status: DashboardStatus;
}

export interface DashboardGroup {
  count: number;
  /** How many beyond `rows`, for "N more — open the board". */
  more: number;
  rows: DashboardTicket[];
}

export interface DashboardTickets {
  inProgress: DashboardGroup;
  needsAttention: DashboardGroup;
  queued: DashboardGroup;
  done: DashboardGroup;
}

const DAY = 24 * 60 * 60 * 1000;
const IN_PROGRESS: RunStatus[] = ['running', 'waiting_approval', 'opening_mr'];

export async function dashboardTickets(
  database: Database,
  now: Date = new Date(),
): Promise<DashboardTickets> {
  const weekAgo = new Date(now.getTime() - 7 * DAY);
  const rows = await database
    .select({
      ticketId: tickets.id,
      reference: tickets.reference,
      title: tickets.title,
      ticketStatus: tickets.status,
      mergeRequestUrl: tickets.mergeRequestUrl,
      pipelineId: tickets.pipelineId,
      pipelineVersion: tickets.pipelineVersion,
      pipelineName: pipelines.name,
      repository: repositories.name,
      runId: runs.id,
      runStatus: runs.status,
      currentStepIndex: runs.currentStepIndex,
      failureStepIndex: runs.failureStepIndex,
      failureReason: runs.failureReason,
      finishedAt: runs.finishedAt,
      snapshot: runs.snapshot,
    })
    .from(tickets)
    .leftJoin(runs, eq(runs.id, tickets.currentRunId))
    .leftJoin(repositories, eq(repositories.id, tickets.repositoryId))
    .leftJoin(pipelines, eq(pipelines.id, tickets.pipelineId))
    .where(
      or(
        inArray(tickets.status, ['queued', 'running', 'waiting_approval', 'failed']),
        inArray(runs.status, ['queued', 'running', 'waiting_approval', 'opening_mr', 'failed']),
        and(eq(tickets.status, 'done'), gte(runs.finishedAt, weekAgo)),
      ),
    )
    // Most recently changed first: whichever of the ticket and its run moved last.
    .orderBy(
      desc(sql`greatest(${tickets.updatedAt}, coalesce(${runs.updatedAt}, ${tickets.updatedAt}))`),
      desc(tickets.createdAt),
    );

  const groupOf = (row: (typeof rows)[number]): keyof DashboardTickets | null => {
    const run = row.runStatus as RunStatus | null;
    if (run && IN_PROGRESS.includes(run)) return 'inProgress';
    if (run === 'failed' || (!run && row.ticketStatus === 'failed')) return 'needsAttention';
    if (run === 'queued' || row.ticketStatus === 'queued') return 'queued';
    if (row.ticketStatus === 'done' && row.finishedAt && row.finishedAt >= weekAgo) return 'done';
    return null;
  };
  const placed = rows.flatMap((row) => {
    const group = groupOf(row);
    return group ? [{ row, group }] : [];
  });

  const shapes = await stepShapes(
    database,
    placed.map(({ row }) => ({
      ticketId: row.ticketId,
      pipelineId: row.pipelineId,
      pipelineVersion: row.pipelineVersion,
      runId: row.runId,
      runStatus: row.runStatus as RunStatus | null,
      currentStepIndex: row.currentStepIndex,
      failureStepIndex: row.failureStepIndex,
      snapshot: row.snapshot as PipelineSnapshot | null,
    })),
  );

  // One pass over the queue answers "where is it?" for every queued run, as
  // the queue itself decides it (001 FR-082): "queued" alone says nothing a
  // reader can act on.
  const queue = placed.some(({ group }) => group === 'queued') ? await queueState(database) : null;
  const positions = new Map(queue?.entries.map((entry) => [entry.runId, entry.position]) ?? []);

  // When each running step started, for the time beside it.
  const runningIds = placed.flatMap(({ row }) =>
    row.runStatus === 'running' && row.runId ? [row.runId] : [],
  );
  const started =
    runningIds.length === 0
      ? []
      : await database
          .select({
            runId: stepResults.runId,
            stepIndex: stepResults.stepIndex,
            startedAt: stepResults.startedAt,
          })
          .from(stepResults)
          .where(and(inArray(stepResults.runId, runningIds), eq(stepResults.status, 'running')));
  const startedAt = new Map(started.map((r) => [`${r.runId}:${r.stepIndex}`, r.startedAt]));

  const groups: DashboardTickets = {
    inProgress: { count: 0, more: 0, rows: [] },
    needsAttention: { count: 0, more: 0, rows: [] },
    queued: { count: 0, more: 0, rows: [] },
    done: { count: 0, more: 0, rows: [] },
  };

  for (const { row, group } of placed) {
    const target = groups[group];
    target.count += 1;
    if (target.rows.length >= GROUP_ROWS) {
      target.more += 1;
      continue;
    }

    const snapshot = row.snapshot as PipelineSnapshot | null;
    const steps = snapshot?.pipeline.steps ?? [];
    const named = (index: number | null) => stepAt(snapshot, steps, index);
    const run = row.runStatus as RunStatus | null;

    let status: DashboardStatus;
    const base = {
      step: null,
      since: null,
      queuePosition: null,
      failureReason: null,
      mergeRequestUrl: null,
    };
    switch (group) {
      case 'inProgress':
        if (run === 'waiting_approval') {
          status = {
            ...base,
            kind: 'waiting',
            step: named(gatedIndex(steps, row.currentStepIndex)),
          };
        } else if (run === 'opening_mr') {
          status = { ...base, kind: 'running' };
        } else {
          const since = startedAt.get(`${row.runId}:${row.currentStepIndex}`);
          status = {
            ...base,
            kind: 'running',
            step: named(row.currentStepIndex),
            since: since ? since.toISOString() : null,
          };
        }
        break;
      case 'needsAttention':
        status = {
          ...base,
          kind: 'failed',
          step: named(row.failureStepIndex ?? row.currentStepIndex),
          failureReason: row.failureReason,
        };
        break;
      case 'queued':
        status = {
          ...base,
          kind: 'queued',
          queuePosition: row.runId ? (positions.get(row.runId) ?? null) : null,
        };
        break;
      case 'done':
        status = { ...base, kind: 'done', mergeRequestUrl: row.mergeRequestUrl };
        break;
    }

    target.rows.push({
      ticketId: row.ticketId,
      reference: row.reference,
      title: row.title,
      repository: row.repository ?? '',
      pipeline: snapshot?.pipeline.name ?? row.pipelineName,
      steps: shapes.get(row.ticketId) as StepShape,
      status,
    });
  }

  return groups;
}

/** A step as the pipeline names it: its agent's stored name, or what kind of step it is. */
function stepAt(
  snapshot: PipelineSnapshot | null,
  steps: Step[],
  index: number | null,
): DashboardStatus['step'] {
  if (index === null || !steps[index]) return null;
  const step = steps[index];
  const agent = snapshot?.agents.find((a) => a.id === step.agent_id);
  return { name: agent?.name ?? step.command ?? step.type, type: step.type };
}

/**
 * A checkpoint is named by what it gates — "Төлөвлөгөө" rather than
 * "checkpoint" — as the board's strip names it: the nearest step before it
 * that did work.
 */
function gatedIndex(steps: Step[], at: number | null): number | null {
  for (let index = (at ?? 0) - 1; index >= 0; index -= 1) {
    const type = steps[index]?.type;
    if (type !== 'checkpoint' && type !== 'notify') return index;
  }
  return at;
}

export interface DashboardFigures {
  firstAttempt: { counted: number; successes: number; rate: number | null };
  /** Exactly seven, oldest first, by the server's own calendar. */
  mergeRequestsByDay: { date: string; count: number; today: boolean }[];
  mergeRequestsTotal: number;
  /** Fixed-point dollars, as the ledger keeps them: "3.4200". */
  costToday: string;
}

/**
 * The dashboard's three figures (FR-012, FR-013).
 *
 * A merge request is counted on the day its run finished `done`: that is the
 * moment it was opened, and a ticket's own `updated_at` moves on every later
 * edit (research D4). Today's cost is the steps that finished today, so a run
 * that spans midnight is split across the two days it spent; a step whose
 * engine never reported usage is 0.0000 and adds nothing.
 */
export async function dashboardFigures(
  database: Database,
  now: Date = new Date(),
): Promise<DashboardFigures> {
  const today = startOfDay(now);
  const firstDay = new Date(today);
  firstDay.setDate(firstDay.getDate() - 6);

  const [figure, finished, [cost]] = await Promise.all([
    firstAttempt(database, { since: new Date(now.getTime() - 30 * DAY) }),
    database
      .select({ finishedAt: runs.finishedAt })
      .from(runs)
      .where(and(eq(runs.status, 'done'), gte(runs.finishedAt, firstDay))),
    database
      .select({
        total: sql<string>`coalesce(sum(${stepResults.costUsd}), 0)::numeric(12, 4)::text`,
      })
      .from(stepResults)
      .where(gte(stepResults.finishedAt, today)),
  ]);

  const days = Array.from({ length: 7 }, (_, i) => {
    const day = new Date(firstDay);
    day.setDate(firstDay.getDate() + i);
    return { date: localDate(day), count: 0, today: i === 6 };
  });
  for (const { finishedAt } of finished) {
    if (!finishedAt) continue;
    const entry = days.find((day) => day.date === localDate(finishedAt));
    if (entry) entry.count += 1;
  }

  return {
    firstAttempt: figure,
    mergeRequestsByDay: days,
    mergeRequestsTotal: days.reduce((sum, day) => sum + day.count, 0),
    costToday: cost?.total ?? '0.0000',
  };
}

/** Midnight of `at` in the server's time zone (spec assumption: "today" is the server's). */
export function startOfDay(at: Date): Date {
  return new Date(at.getFullYear(), at.getMonth(), at.getDate());
}

/** YYYY-MM-DD in the server's time zone. */
export function localDate(at: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}
