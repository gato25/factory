import { users } from '@factory/db/schema';
import { notAuthorised } from '@factory/shared';
import { getRequestEvent, query } from '$app/server';
import { db } from '$lib/db';

/**
 * Who is in the workspace. Needed wherever a person is chosen — a gate's
 * named approvers, above all (FR-032). Membership management itself is
 * administrator-only and arrives with user story 8.
 */

function requireUser() {
  const user = getRequestEvent().locals.user;
  if (!user) throw notAuthorised('you must be signed in');
  return user;
}

export const members = query(async () => {
  requireUser();
  return db()
    .select({ id: users.id, name: users.name, email: users.email, role: users.role })
    .from(users)
    .orderBy(users.name);
});
