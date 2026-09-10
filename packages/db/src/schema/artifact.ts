import {
  boolean,
  customType,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { idColumn, timestamps } from './_shared';
import { runs } from './run';
import { users } from './workspace';

const bytea = customType<{ data: Uint8Array; driverData: Buffer }>({
  dataType: () => 'bytea',
});

/**
 * Screen images are the only kind shown as pictures; the rest are text or
 * links (spec Key Entities, FR-077).
 */
export const artifactKind = pgEnum('artifact_kind', [
  'document',
  'design_file',
  'screen',
  'commits',
  'merge_request',
]);

export const approvalDecision = pgEnum('approval_decision', [
  'approved',
  'changes_requested',
  'edited',
  'cancelled',
]);

export const logStream = pgEnum('log_stream', ['stdout', 'stderr']);

/**
 * Versions are additive — a human editing a document at a gate writes a new
 * version and the previous one is retained (FR-054, FR-062).
 */
export const artifacts = pgTable(
  'artifacts',
  {
    id: idColumn(),
    runId: uuid('run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    stepIndex: integer('step_index').notNull(),
    kind: artifactKind('kind').notNull(),
    path: text('path').notNull(),
    version: integer('version').notNull().default(1),
    content: text('content'),
    bytes: bytea('bytes'),
    /** Null unless kind = 'screen' (data-model.md). */
    screenName: text('screen_name'),
    /** Null unless a human edited it at a gate. */
    createdBy: uuid('created_by').references(() => users.id),
    ...timestamps(),
  },
  (t) => [uniqueIndex('artifacts_run_path_version_key').on(t.runId, t.path, t.version)],
);

export const approvals = pgTable(
  'approvals',
  {
    id: idColumn(),
    runId: uuid('run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    stepIndex: integer('step_index').notNull(),
    decidedBy: uuid('decided_by').references(() => users.id),
    decision: approvalDecision('decision').notNull(),
    feedback: text('feedback'),
    decidedAt: timestamp('decided_at', { withTimezone: true }).notNull().defaultNow(),
    /** A gate that continued or failed without a human (FR-064b). */
    timedOut: boolean('timed_out').notNull().default(false),
    ...timestamps(),
  },
  (t) => [
    // One decision per gate, enforced in the database rather than in
    // application logic: the second decider's insert fails (FR-064a).
    uniqueIndex('approvals_run_step_key').on(t.runId, t.stepIndex),
  ],
);

/**
 * Credentials are redacted at ingest, never at display (Principle V), so a
 * later change to the viewer cannot un-redact them.
 */
export const logChunks = pgTable(
  'log_chunks',
  {
    id: idColumn(),
    runId: uuid('run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    stepIndex: integer('step_index').notNull(),
    seq: integer('seq').notNull(),
    stream: logStream('stream').notNull().default('stdout'),
    text: text('text').notNull(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('log_chunks_run_step_seq_key').on(t.runId, t.stepIndex, t.seq)],
);
