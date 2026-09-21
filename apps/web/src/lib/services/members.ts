import type { Database } from '@factory/db';
import { tickets, users } from '@factory/db/schema';
import { conflict, invalidInput, notFound } from '@factory/shared';
import { eq, sql } from 'drizzle-orm';
import type { SessionUser } from './auth';
import { requireAdmin } from './authz';
import { m } from '$lib/i18n';

/**
 * Membership: administrators invite people and change roles (FR-005). Two
 * roles, no more (FR-003), and the role gates workspace credentials,
 * connections, ceilings and membership only — not pipelines, agents or
 * skills, which go by ownership (FR-004, FR-006).
 */

export interface Member {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'member';
  /** How much of the workspace's work is theirs, before anyone removes them. */
  ticketsCreated: number;
  createdAt: Date;
}

export async function listMembers(database: Database, user: SessionUser | null) {
  requireAdmin(user);
  const rows = await database.select().from(users).orderBy(users.name);
  const counts = await database
    .select({ createdBy: tickets.createdBy, count: sql<number>`count(*)::int` })
    .from(tickets)
    .groupBy(tickets.createdBy);

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    ticketsCreated: counts.find((c) => c.createdBy === row.id)?.count ?? 0,
    createdAt: row.createdAt,
  }));
}

/**
 * Inviting somebody. They arrive with no password: signing in through a
 * provider is the intended path, and an invited account nobody has used is
 * not a credential anyone could guess.
 */
export async function invite(
  database: Database,
  input: { name: string; email: string; role?: 'admin' | 'member' },
  user: SessionUser | null,
): Promise<{ id: string }> {
  requireAdmin(user);
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  if (!name) throw invalidInput(m.form.personName);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw invalidInput(`${input.email} does not look like an email address.`);
  }

  try {
    const [created] = await database
      .insert(users)
      .values({ name, email, role: input.role ?? 'member' })
      .returning();
    if (!created) throw conflict(m.error.couldNotInvite);
    return { id: created.id };
  } catch (error) {
    if (flatten(error).includes('users_email_unique')) {
      throw conflict(`${email} is already in this workspace.`);
    }
    throw error;
  }
}

/**
 * Changing a role. The last administrator cannot be demoted: a workspace
 * with no administrator has no way back, because changing a role is itself
 * administrator-only.
 */
export async function setRole(
  database: Database,
  userId: string,
  role: 'admin' | 'member',
  user: SessionUser | null,
): Promise<{ role: 'admin' | 'member' }> {
  requireAdmin(user);
  const [target] = await database.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!target) throw notFound(m.error.noSuchPerson);

  if (target.role === 'admin' && role === 'member') {
    const [remaining] = await database
      .select({ count: sql<number>`count(*)::int` })
      .from(users)
      .where(eq(users.role, 'admin'));
    if ((remaining?.count ?? 0) <= 1) {
      throw conflict(
        'This is the only administrator. Make somebody else an administrator first, or the ' +
          'workspace would have nobody who could change that.',
      );
    }
  }

  await database.update(users).set({ role, updatedAt: new Date() }).where(eq(users.id, userId));
  return { role };
}

/**
 * Removing somebody. Their tickets and runs stay: they are the record of
 * what happened, and deleting them would erase work rather than a person's
 * access. What they own is handed to the administrator doing the removing,
 * so nothing becomes unchangeable.
 *
 * There is no separate last-administrator check here, and none is needed:
 * removing requires being an administrator, the role comes from the database
 * on every request, and you cannot remove yourself — so an administrator
 * target always implies a second administrator doing the removing. A check
 * for it would be a branch nothing could ever reach.
 */
export async function remove(
  database: Database,
  userId: string,
  user: SessionUser | null,
): Promise<{ removed: true; ticketsKept: number; ownedTransferred: number }> {
  const admin = requireAdmin(user);
  if (userId === admin.id) {
    throw conflict(m.error.cannotRemoveYourself);
  }

  const [target] = await database.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!target) throw notFound(m.error.noSuchPerson);

  const { agents, pipelines, skills } = await import('@factory/db/schema');
  let ownedTransferred = 0;
  for (const table of [pipelines, agents, skills]) {
    const moved = await database
      .update(table)
      .set({ ownerId: admin.id })
      .where(eq(table.ownerId, userId))
      .returning({ id: table.id });
    ownedTransferred += moved.length;
  }

  const [kept] = await database
    .select({ count: sql<number>`count(*)::int` })
    .from(tickets)
    .where(eq(tickets.createdBy, userId));

  // A person with tickets cannot be deleted outright — the foreign keys are
  // what keep the record intact — so their access is revoked instead.
  await database
    .update(users)
    .set({ passwordHash: null, provider: null, providerUserId: null, updatedAt: new Date() })
    .where(eq(users.id, userId));

  // Somebody who never created a ticket leaves no record to preserve, so the
  // row goes rather than lingering as a revoked account. Anyone who did is
  // kept: their tickets and runs are what happened, and a run's `decided_by`
  // or `created_by` pointing at nothing would make the record unreadable.
  if ((kept?.count ?? 0) === 0) {
    await database.delete(users).where(eq(users.id, userId));
  }

  return { removed: true, ticketsKept: kept?.count ?? 0, ownedTransferred };
}

function flatten(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  while (current instanceof Error) {
    parts.push(current.message);
    const constraint = (current as { constraint_name?: string }).constraint_name;
    if (constraint) parts.push(constraint);
    current = current.cause;
  }
  return parts.join(' | ');
}
