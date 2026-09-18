import type { Database } from '@factory/db';
import { agentSkills, skills, skillVersions } from '@factory/db/schema';
import { conflict, invalidInput, notFound } from '@factory/shared';
import { desc, eq } from 'drizzle-orm';
import type { SessionUser } from './auth';
import { ownershipOf, requireChangeable } from './ownership';
import { agentsHolding, skillUsage } from './usage';

/**
 * A skill is a named instruction document attachable to any number of agents
 * (FR-042). Its description says WHEN an agent should apply it, and that
 * description travels with the skill into the run so the agent can decide for
 * itself rather than applying everything it holds (FR-043).
 *
 * The description is required for that reason: a skill without one is a
 * document an agent has no basis for reaching for.
 */

export interface SkillDetail {
  id: string;
  name: string;
  description: string;
  content: string;
  ownerId: string | null;
  ownerName: string | null;
  isDefault: boolean;
  mayChange: boolean;
  updatedAt: Date;
  updatedByName: string | null;
  /** Which agents hold it, so a change names what it reaches. */
  agents: { id: string; name: string }[];
  usage: { pipelines: number; runs: number; runsInFlight: number };
}

export async function listSkills(database: Database, user: SessionUser | null) {
  const rows = await database.select().from(skills).orderBy(skills.name);
  const usage = await skillUsage(database);
  const attachments = await database.select().from(agentSkills);

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    ownerId: row.ownerId,
    isDefault: row.ownerId === null,
    mayChange: Boolean(user) && (user?.role === 'admin' || row.ownerId === user?.id),
    updatedAt: row.updatedAt,
    agentCount: attachments.filter((a) => a.skillId === row.id).length,
    usage: usage.get(row.id) ?? { pipelines: 0, runs: 0, runsInFlight: 0 },
  }));
}

export async function getSkill(
  database: Database,
  skillId: string,
  user: SessionUser | null,
): Promise<SkillDetail> {
  const [row] = await database.select().from(skills).where(eq(skills.id, skillId)).limit(1);
  if (!row) throw notFound('тийм ур чадвар алга');

  const ownership = await ownershipOf(database, 'skill', skillId, user);
  const usage = await skillUsage(database);
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    content: row.content,
    ownerId: ownership.ownerId,
    ownerName: ownership.ownerName,
    isDefault: ownership.isDefault,
    mayChange: ownership.mayChange,
    updatedAt: row.updatedAt,
    updatedByName: row.updatedBy ? await nameOf(database, row.updatedBy) : null,
    agents: await agentsHolding(database, skillId),
    usage: usage.get(row.id) ?? { pipelines: 0, runs: 0, runsInFlight: 0 },
  };
}

export interface SkillInput {
  name?: string;
  description?: string;
  content?: string;
}

export async function createSkill(
  database: Database,
  input: SkillInput & { name: string; description: string; content: string },
  user: SessionUser,
): Promise<{ id: string }> {
  const fields = validate(input);

  try {
    const created = await database.transaction(async (tx) => {
      const [row] = await tx
        .insert(skills)
        .values({
          name: fields.name as string,
          description: fields.description as string,
          content: fields.content as string,
          ownerId: user.id,
          updatedBy: user.id,
        })
        .returning();
      if (!row) throw conflict('ур чадварыг үүсгэж чадсангүй');
      // Version 1 is the skill as it was written, so the history has a
      // beginning rather than starting at the first edit.
      await tx.insert(skillVersions).values({
        skillId: row.id,
        version: 1,
        name: row.name,
        description: row.description,
        content: row.content,
        createdBy: user.id,
      });
      return row;
    });
    return { id: created.id };
  } catch (error) {
    if (flatten(error).includes('skills_name_unique')) {
      throw conflict(
        `“${input.name.trim()}” нэртэй ур чадвар аль хэдийн байна. Агент ур чадварыг нэрээр нь ` +
          'дууддаг тул нэр нь давхцах ёсгүй.',
      );
    }
    throw error;
  }
}

export async function updateSkill(
  database: Database,
  skillId: string,
  input: SkillInput,
  user: SessionUser,
): Promise<{ changed: true; version: number; reaches: { id: string; name: string }[] }> {
  await requireChangeable(database, 'skill', skillId, user);
  const fields = validate(input);

  let version = 0;
  try {
    await database.transaction(async (tx) => {
      const [saved] = await tx
        .update(skills)
        .set({
          ...(fields.name === undefined ? {} : { name: fields.name }),
          ...(fields.description === undefined ? {} : { description: fields.description }),
          ...(fields.content === undefined ? {} : { content: fields.content }),
          updatedBy: user.id,
          updatedAt: new Date(),
        })
        .where(eq(skills.id, skillId))
        .returning();
      if (!saved) throw notFound('тийм ур чадвар алга');
      // The saved state, not the replaced one: the newest version and the
      // skill row then say the same thing, and restoring a version is
      // saving its content again.
      version = (await latestVersion(tx, skillId)) + 1;
      await tx.insert(skillVersions).values({
        skillId,
        version,
        name: saved.name,
        description: saved.description,
        content: saved.content,
        createdBy: user.id,
      });
    });
  } catch (error) {
    if (flatten(error).includes('skills_name_unique')) {
      throw conflict(`“${input.name?.trim()}” нэртэй ур чадвар аль хэдийн байна.`);
    }
    throw error;
  }

  // What the change reaches — and, just as importantly, what it does not:
  // a run in flight read this skill's content once and never looks again
  // (FR-044, SC-010).
  return { changed: true, version, reaches: await agentsHolding(database, skillId) };
}

function validate(input: SkillInput) {
  const name = input.name?.trim();
  const description = input.description?.trim();
  const content = input.content;

  if (input.name !== undefined && !name) throw invalidInput('Ур чадварт нэр өгнө үү.');
  if (input.description !== undefined && !description) {
    throw invalidInput(
      'Say when an agent should apply this skill. That sentence is what an agent reads to ' +
        'decide whether to reach for it, so a skill without one is unusable.',
    );
  }
  if (input.content !== undefined && !content?.trim()) {
    throw invalidInput('Агуулгагүй ур чадвар агентад хэрэглэх юу ч өгөхгүй.');
  }
  return { name, description, content };
}

/**
 * Deleting a skill. Agents holding it simply stop holding it — the join rows
 * cascade — and runs in flight are untouched because their snapshot carries
 * the content (FR-044). The count of affected agents comes back so the
 * caller can say what changed.
 */
export async function deleteSkill(
  database: Database,
  skillId: string,
  user: SessionUser,
): Promise<{ deleted: true; detachedFrom: { id: string; name: string }[] }> {
  await requireChangeable(database, 'skill', skillId, user);
  const detachedFrom = await agentsHolding(database, skillId);
  await database.delete(skills).where(eq(skills.id, skillId));
  return { deleted: true, detachedFrom };
}

export interface SkillVersion {
  version: number;
  name: string;
  description: string;
  content: string;
  authorName: string | null;
  createdAt: Date;
  /** True for the version the skill currently holds. */
  current: boolean;
}

/**
 * What the skill has said, newest first (FR-043b).
 *
 * Ownership does not gate reading it: anyone who may read the skill may read
 * how it got here, because a run that behaved oddly last week is explained by
 * what the skill said last week, not by who owns it now.
 */
export async function skillHistory(database: Database, skillId: string): Promise<SkillVersion[]> {
  const rows = await database
    .select({
      version: skillVersions.version,
      name: skillVersions.name,
      description: skillVersions.description,
      content: skillVersions.content,
      createdBy: skillVersions.createdBy,
      createdAt: skillVersions.createdAt,
    })
    .from(skillVersions)
    .where(eq(skillVersions.skillId, skillId))
    .orderBy(desc(skillVersions.version));

  const newest = rows[0]?.version ?? 0;
  const names = new Map<string, string | null>();
  const out: SkillVersion[] = [];
  for (const row of rows) {
    if (row.createdBy && !names.has(row.createdBy)) {
      names.set(row.createdBy, await nameOf(database, row.createdBy));
    }
    out.push({
      version: row.version,
      name: row.name,
      description: row.description,
      content: row.content,
      authorName: row.createdBy ? (names.get(row.createdBy) ?? null) : null,
      createdAt: row.createdAt,
      current: row.version === newest,
    });
  }
  return out;
}

/**
 * The highest version recorded, or 0 for a skill written before history was
 * kept — in which case the next save becomes version 1 and the history
 * starts from what is true now rather than pretending to know what was.
 */
async function latestVersion(database: Reader, skillId: string): Promise<number> {
  const [row] = await database
    .select({ version: skillVersions.version })
    .from(skillVersions)
    .where(eq(skillVersions.skillId, skillId))
    .orderBy(desc(skillVersions.version))
    .limit(1);
  return row?.version ?? 0;
}

/** A database or a transaction — both can read. */
type Reader = Pick<Database, 'select'>;

async function nameOf(database: Database, userId: string): Promise<string | null> {
  const { users } = await import('@factory/db/schema');
  const [row] = await database
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row?.name ?? null;
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
