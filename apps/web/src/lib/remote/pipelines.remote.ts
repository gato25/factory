import { pipelines as pipelinesTable } from '@factory/db/schema';
import { query } from '$app/server';
import { db } from '$lib/db';

/**
 * The list a ticket form needs. The builder's own remote functions — reorder,
 * insert, save — arrive with user story 6 (T179).
 */
export const pipelines = query(async () =>
  db()
    .select({
      id: pipelinesTable.id,
      name: pipelinesTable.name,
      description: pipelinesTable.description,
      currentVersion: pipelinesTable.currentVersion,
      ownerId: pipelinesTable.ownerId,
    })
    .from(pipelinesTable),
);
