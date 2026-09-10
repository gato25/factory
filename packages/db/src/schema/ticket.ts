import { boolean, integer, pgEnum, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { idColumn, timestamps } from './_shared';
import { pipelines } from './pipeline';
import { repositories } from './repository';
import { users } from './workspace';

export const ticketStatus = pgEnum('ticket_status', [
  'draft',
  'queued',
  'running',
  'waiting_approval',
  'done',
  'failed',
  'cancelled',
]);

export const tickets = pgTable('tickets', {
  id: idColumn(),
  repositoryId: uuid('repository_id')
    .notNull()
    .references(() => repositories.id),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id),
  // Human-readable and unique — shown as #142 (FR-021).
  reference: text('reference').notNull().unique(),
  title: text('title').notNull(),
  description: text('description'),
  acceptanceCriteria: text('acceptance_criteria').array().notNull().default([]),
  pipelineId: uuid('pipeline_id').references(() => pipelines.id),
  pipelineVersion: integer('pipeline_version'),
  status: ticketStatus('status').notNull().default('draft'),
  currentRunId: uuid('current_run_id'),
  branchName: text('branch_name'),
  mergeRequestUrl: text('merge_request_url'),
  /** Null until the specification step decides (FR-099). Nobody sets it at
   *  creation time — FR-101 forbids asking. */
  hasUi: boolean('has_ui'),
  uiRationale: text('ui_rationale'),
  /** What FR-102's warning hangs on: set when no usable decision arrived, so
   *  the warning is a field on the run rather than a log line. */
  classificationMissing: boolean('classification_missing').notNull().default(false),
  ...timestamps(),
});
