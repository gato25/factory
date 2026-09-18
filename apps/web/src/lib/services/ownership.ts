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
  pipeline: 'дамжлага',
  agent: 'агент',
  skill: 'ур чадвар',
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
  if (!row) throw notFound(`тийм ${WHAT[kind]} алга`);

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
  if (!user) throw notAuthorised('та нэвтэрсэн байх ёстой');

  throw notAuthorised(
    ownership.isDefault
      ? `Энэ ${WHAT[kind]} Code Factory-тай хамт ирдэг. Та үүнийг ашиглаж, хуулбарлаж болно; ` +
          'зөвхөн администратор өөрчилнө.'
      : `Энэ ${WHAT[kind]} ` +
          `${ownership.ownerName ? `${ownership.ownerName}-д харьяалагдана` : 'өөр хүнийх'}. ` +
          'Та үүнийг ашиглаж, хуулбарлаж болно, гэхдээ өөрчилж болохгүй.',
  );
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
