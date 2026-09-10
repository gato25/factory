import type { Step } from '@factory/shared';
import { integer, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { idColumn, timestamps } from './_shared';
import { users } from './workspace';

export const pipelines = pgTable('pipelines', {
  id: idColumn(),
  name: text('name').notNull(),
  description: text('description'),
  // Owner: any member may create and change their own (FR-006a, FR-006c).
  ownerId: uuid('owner_id').references(() => users.id),
  currentVersion: integer('current_version').notNull().default(1),
  ...timestamps(),
});

/**
 * Immutable once written — a save writes a new row and advances
 * pipelines.current_version (FR-027). Runs reference a version row, never the
 * pipeline, which is what makes SC-010 achievable. Insert-only: no update path.
 */
export const pipelineVersions = pgTable(
  'pipeline_versions',
  {
    id: idColumn(),
    pipelineId: uuid('pipeline_id')
      .notNull()
      .references(() => pipelines.id),
    version: integer('version').notNull(),
    steps: jsonb('steps').$type<Step[]>().notNull(),
    createdBy: uuid('created_by').references(() => users.id),
    ...timestamps(),
  },
  (t) => [uniqueIndex('pipeline_versions_pipeline_version_key').on(t.pipelineId, t.version)],
);
