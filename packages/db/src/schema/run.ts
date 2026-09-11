import type { PipelineSnapshot } from '@factory/shared';
import { sql } from 'drizzle-orm';
import {
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { idColumn, money, timestamps } from './_shared';
import { tickets } from './ticket';
import { users } from './workspace';

export const runStatus = pgEnum('run_status', [
  'queued',
  'running',
  'waiting_approval',
  'opening_mr',
  'done',
  'failed',
  'cancelled',
]);

/**
 * Five distinguishable values (FR-112). `skipped` is neither a kind of `done`
 * nor a flag on it: it is terminal for its step alone and never fails the run
 * (FR-110, FR-111).
 */
export const stepStatus = pgEnum('step_status', [
  'pending',
  'running',
  'done',
  'failed',
  'skipped',
]);

export const runs = pgTable(
  'runs',
  {
    id: idColumn(),
    ticketId: uuid('ticket_id')
      .notNull()
      .references(() => tickets.id),
    attempt: integer('attempt').notNull(),
    /** The whole resolved pipeline, consulted once and never re-read (FR-044). */
    snapshot: jsonb('snapshot').$type<PipelineSnapshot>().notNull(),
    status: runStatus('status').notNull().default('queued'),
    currentStepIndex: integer('current_step_index'),
    orchestratorExecutionId: text('orchestrator_execution_id'),
    /** Stored so a gate stays drivable even if the execution is lost. */
    resumeUrl: text('resume_url'),
    containerId: text('container_id'),
    runnerImage: text('runner_image'),
    costUsd: money('cost_usd').notNull().default('0.0000'),
    costCeilingUsd: money('cost_ceiling_usd').notNull(),
    timeCeilingMinutes: integer('time_ceiling_minutes').notNull(),
    /**
     * A pause is a request, not a state: the current step concludes and no
     * further step begins (FR-096). Keeping it separate from `status` means
     * the run stays exactly as legible as it was while its step finishes.
     */
    pauseRequestedAt: timestamp('pause_requested_at', { withTimezone: true }),
    pauseRequestedBy: uuid('pause_requested_by').references(() => users.id),
    failureReason: text('failure_reason'),
    failureStepIndex: integer('failure_step_index'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    // Attempts are sequential per ticket (FR-045).
    uniqueIndex('runs_ticket_attempt_key').on(t.ticketId, t.attempt),
    // T020 — at most one active run per ticket (FR-020).
    uniqueIndex('runs_one_active_per_ticket')
      .on(t.ticketId)
      .where(sql`${t.status} in ('queued', 'running', 'waiting_approval', 'opening_mr')`),
  ],
);

export const stepResults = pgTable(
  'step_results',
  {
    id: idColumn(),
    runId: uuid('run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    stepIndex: integer('step_index').notNull(),
    status: stepStatus('status').notNull().default('pending'),
    /** The condition that was false — what FR-110 requires be stated and
     *  FR-075a requires be shown. Null unless skipped. */
    conditionNotMet: text('condition_not_met'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    durationS: integer('duration_s'),
    costUsd: money('cost_usd').notNull().default('0.0000'),
    engineSessionId: text('engine_session_id'),
    summary: text('summary'),
    logRef: text('log_ref'),
    errorDetail: text('error_detail'),
    ...timestamps(),
  },
  (t) => [
    // The idempotency key: a repeated callback is a no-op (FR-095).
    uniqueIndex('step_results_run_step_key').on(t.runId, t.stepIndex),
  ],
);
