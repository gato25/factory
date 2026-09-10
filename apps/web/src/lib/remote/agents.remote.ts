import { agents as agentsTable } from '@factory/db/schema';
import { notAuthorised } from '@factory/shared';
import { getRequestEvent, query } from '$app/server';
import { db } from '$lib/db';

/**
 * The agent list. Readable and usable by anyone; changeable only by its owner
 * or an administrator (FR-006c) — which is what the editing surface arriving
 * with user story 7 enforces. This is the read the pipeline builder needs to
 * offer a choice.
 */

function requireUser() {
  const user = getRequestEvent().locals.user;
  if (!user) throw notAuthorised('you must be signed in');
  return user;
}

export const agents = query(async () => {
  requireUser();
  return db()
    .select({
      id: agentsTable.id,
      name: agentsTable.name,
      description: agentsTable.description,
      icon: agentsTable.icon,
      kind: agentsTable.kind,
      ownerId: agentsTable.ownerId,
      // Which engine an agent runs on (FR-036b) — the builder offers only
      // agents whose engine matches the step.
      engine: agentsTable.engine,
      model: agentsTable.model,
    })
    .from(agentsTable)
    .orderBy(agentsTable.name);
});
