import { sql } from 'drizzle-orm';
import {
  boolean,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
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

/**
 * Requirement documents attached to a ticket (text, Markdown, CSV).
 *
 * Separate from `artifacts`, which look similar and are not the same thing.
 * An artifact is something a RUN produced and belongs to that run: it dies
 * with it and is versioned by the gate that edited it. These are an INPUT a
 * person supplied, they belong to the ticket, and they outlive every attempt —
 * a retry must hand the agent the same brief the first attempt had.
 *
 * The content is stored as text rather than bytes because only text is
 * accepted (see `requirement-files.ts` in `shared` for why). That also makes
 * a requirement greppable in the database, which bytea would not be.
 */
export const ticketFiles = pgTable(
  'ticket_files',
  {
    id: idColumn(),
    ticketId: uuid('ticket_id')
      .notNull()
      .references(() => tickets.id, { onDelete: 'cascade' }),
    /** Already made safe for a filesystem path — `safeFileName` decides it. */
    name: text('name').notNull(),
    contentType: text('content_type').notNull(),
    /** The size of `content` in UTF-8, stored so a total needs no sum over text. */
    bytes: integer('bytes').notNull(),
    content: text('content').notNull(),
    uploadedBy: uuid('uploaded_by').references(() => users.id),
    ...timestamps(),
  },
  // One name per ticket, in the database rather than in application logic:
  // two files of the same name would write over each other in the sandbox,
  // and the one an agent read would be decided by insertion order.
  (t) => [uniqueIndex('ticket_files_ticket_name_key').on(t.ticketId, t.name)],
);

export const launchStatus = pgEnum('launch_status', ['starting', 'running', 'failed', 'stopped']);

/**
 * A ticket's branch, running on a real port (003 FR-001).
 *
 * The container itself lives in the execution service and dies with it; this
 * row is what lets the ticket page find a launch again after a reload, show
 * how it ended, and stop it. `stoppedAt` set means the row is history: a
 * ticket has at most one launch that is not stopped, enforced below rather
 * than in application logic, because two would both hold a port and one of
 * them would be forgotten.
 */
export const launches = pgTable(
  'launches',
  {
    id: idColumn(),
    ticketId: uuid('ticket_id')
      .notNull()
      .references(() => tickets.id, { onDelete: 'cascade' }),
    repositoryId: uuid('repository_id')
      .notNull()
      .references(() => repositories.id),
    /** The execution service's own identifier for the running container. */
    runnerLaunchId: text('runner_launch_id').notNull(),
    branch: text('branch').notNull(),
    /** What was actually run, whether detected or set on the repository. */
    command: text('command').notNull(),
    /** `http://127.0.0.1:<port>` on the machine the execution service runs on. */
    url: text('url'),
    status: launchStatus('status').notNull().default('starting'),
    /** Why it failed, or the last lines of output — for the screen. */
    detail: text('detail'),
    startedBy: uuid('started_by').references(() => users.id),
    stoppedAt: timestamp('stopped_at', { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('launches_one_live_per_ticket').on(t.ticketId).where(sql`${t.stoppedAt} is null`),
  ],
);
