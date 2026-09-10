import type { Database } from '@factory/db';
import { agents, pipelines, skills } from '@factory/db/schema';
import { notAuthorised, notFound } from '@factory/shared';
import { eq } from 'drizzle-orm';
import type { SessionUser } from './auth';
import { canChangeOwned } from './authz';

/**
 * Pipelines, agents and skills all follow one ownership rule (FR-006a,
 * FR-006c): whoever creates one owns it and may change or delete it at will;
 * anyone may read and use it; only the owner or an administrator may change
 * it. A shipped default has no owner and is therefore administrator-only to
 * change, while remaining available to everyone (FR-006b).
 *
 * It is here once rather than three times so the three cannot drift apart.
 */

export type OwnedKind = 'pipeline' | 'agent' | 'skill';

const TABLE = { pipeline: pipelines, agent: agents, skill: skills } as const;

const WHAT: Record<OwnedKind, string> = {
  pipeline: 'this pipeline',
  agent: 'this agent',
  skill: 'this skill',
};

export interface Ownership {
  kind: OwnedKind;
  id: string;
  name: string;
  ownerId: string | null;
  /** Null when nobody owns it — a shipped default (FR-006b). */
  ownerName: string | null;
  /** True when it ships with the product rather than belonging to anyone. */
  isDefault: boolean;
  mayChange: boolean;
}

export async function ownershipOf(
  database: Database,
  kind: OwnedKind,
  id: string,
  user: SessionUser | null,
): Promise<Ownership> {
  const table = TABLE[kind];
  const [row] = await database.select().from(table).where(eq(table.id, id)).limit(1);
  if (!row) throw notFound(`no such ${kind}`);

  const ownerName = row.ownerId ? await nameOf(database, row.ownerId) : null;
  return {
    kind,
    id: row.id,
    name: row.name,
    ownerId: row.ownerId,
    ownerName,
    isDefault: row.ownerId === null,
    mayChange: canChangeOwned(user, row.ownerId),
  };
}

/**
 * Guards a change. The message says what the reader can still do, because
 * "not yours" without "but you can use it" reads as a wall rather than a
 * boundary (FR-006c).
 */
export async function requireChangeable(
  database: Database,
  kind: OwnedKind,
  id: string,
  user: SessionUser | null,
): Promise<Ownership> {
  const ownership = await ownershipOf(database, kind, id, user);
  if (ownership.mayChange) return ownership;
  if (!user) throw notAuthorised('you must be signed in');

  throw notAuthorised(
    ownership.isDefault
      ? `${WHAT[kind]} ships with Code Factory. You can use it and duplicate it; only an ` +
          'administrator can change it.'
      : `${WHAT[kind]} belongs to ${ownership.ownerName ?? 'someone else'}. You can use it and ` +
          'duplicate it, but not change it.',
  );
}

/** Any member may create their own, with no administrator involved (FR-006). */
export function ownerFor(user: SessionUser): string {
  return user.id;
}

async function nameOf(database: Database, userId: string): Promise<string | null> {
  const { users } = await import('@factory/db/schema');
  const [row] = await database
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row?.name ?? null;
}
