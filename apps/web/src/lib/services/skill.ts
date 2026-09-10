import type { Database } from '@factory/db';
import { agentSkills, skills } from '@factory/db/schema';
import { conflict, invalidInput, notFound } from '@factory/shared';
import { eq } from 'drizzle-orm';
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
  if (!row) throw notFound('no such skill');

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
    const [created] = await database
      .insert(skills)
      .values({
        name: fields.name as string,
        description: fields.description as string,
        content: fields.content as string,
        ownerId: user.id,
        updatedBy: user.id,
      })
      .returning();
    if (!created) throw conflict('could not create the skill');
    return { id: created.id };
  } catch (error) {
    if (flatten(error).includes('skills_name_unique')) {
      throw conflict(
        `There is already a skill called “${input.name.trim()}”. A skill's name is how an ` +
          'agent refers to it, so it has to be unique.',
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
): Promise<{ changed: true; reaches: { id: string; name: string }[] }> {
  await requireChangeable(database, 'skill', skillId, user);
  const fields = validate(input);

  try {
    await database
      .update(skills)
      .set({
        ...(fields.name === undefined ? {} : { name: fields.name }),
        ...(fields.description === undefined ? {} : { description: fields.description }),
        ...(fields.content === undefined ? {} : { content: fields.content }),
        updatedBy: user.id,
        updatedAt: new Date(),
      })
      .where(eq(skills.id, skillId));
  } catch (error) {
    if (flatten(error).includes('skills_name_unique')) {
      throw conflict(`There is already a skill called “${input.name?.trim()}”.`);
    }
    throw error;
  }

  // What the change reaches — and, just as importantly, what it does not:
  // a run in flight read this skill's content once and never looks again
  // (FR-044, SC-010).
  return { changed: true, reaches: await agentsHolding(database, skillId) };
}

function validate(input: SkillInput) {
  const name = input.name?.trim();
  const description = input.description?.trim();
  const content = input.content;

  if (input.name !== undefined && !name) throw invalidInput('Give the skill a name.');
  if (input.description !== undefined && !description) {
    throw invalidInput(
      'Say when an agent should apply this skill. That sentence is what an agent reads to ' +
        'decide whether to reach for it, so a skill without one is unusable.',
    );
  }
  if (input.content !== undefined && !content?.trim()) {
    throw invalidInput('A skill with no content gives an agent nothing to apply.');
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
