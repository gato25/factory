import type { Database } from '@factory/db';
import { agentSkills, agents, skills } from '@factory/db/schema';
import { conflict, invalidInput, notFound } from '@factory/shared';
import { and, eq, inArray } from 'drizzle-orm';
import { DEFAULT_AGENTS } from './agent-defaults';
import type { SessionUser } from './auth';
import { ownershipOf, requireChangeable } from './ownership';
import { agentUsage, pipelinesUsingAgent, runsInFlightWithAgent } from './usage';

/**
 * An agent's instructions, model, permitted tools, attached skills, and its
 * own cost, time and turn limits are each configured independently (FR-036).
 * Nothing here couples them: a person raising a turn limit does not have to
 * think about tools, and a person withholding a tool does not lose their
 * prompt.
 *
 * Changes reach only runs started afterwards (FR-041). That is not enforced
 * here but in the snapshot: a run reads every agent once, at the start, and
 * never looks again (FR-044).
 */

/** Every tool an agent may be permitted. Withholding one makes it
 *  unreachable rather than merely discouraged (FR-039). */
export const TOOLS = [
  'Read',
  'Write',
  'Edit',
  'Glob',
  'Grep',
  'Bash',
  'WebFetch',
  'GitPush',
] as const;

export type Tool = (typeof TOOLS)[number];

export const TOOL_DESCRIPTION: Record<Tool, string> = {
  Read: 'Read a file in the repository',
  Write: 'Create a file',
  Edit: 'Change an existing file',
  Glob: 'Find files by name',
  Grep: 'Search file contents',
  Bash: 'Run a shell command — including the repository’s tests',
  WebFetch: 'Fetch a URL',
  GitPush: 'Push the branch',
};

/**
 * The design service's own model choices. Tool permissions do not apply to
 * that engine and are not offered for it (FR-036a).
 */
export const MODELS: Record<'claude_cli' | 'design_cli', string[]> = {
  claude_cli: ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5'],
  design_cli: ['pen-default', 'pen-precise'],
};

export interface AgentDetail {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  kind: 'default' | 'custom';
  engine: 'claude_cli' | 'design_cli';
  model: string;
  systemPrompt: string;
  allowedTools: string[];
  maxCostUsd: string | null;
  maxMinutes: number | null;
  maxTurns: number | null;
  skills: { id: string; name: string; description: string }[];
  ownerId: string | null;
  ownerName: string | null;
  isDefault: boolean;
  mayChange: boolean;
  /** Whether a shipped configuration exists to go back to (FR-040). */
  resettable: boolean;
  /** Whether it currently differs from what shipped, so Reset would change it. */
  modifiedFromShipped: boolean;
  usage: { pipelines: number; runs: number; runsInFlight: number };
  usedBy: { id: string; name: string }[];
}

export async function listAgents(database: Database, user: SessionUser | null) {
  const rows = await database.select().from(agents).orderBy(agents.name);
  const usage = await agentUsage(database);
  const attached = await database
    .select({ agentId: agentSkills.agentId, name: skills.name })
    .from(agentSkills)
    .innerJoin(skills, eq(skills.id, agentSkills.skillId));
  // The card names whoever owns it (FR-006d), so the name has to travel with
  // the row rather than being fetched again per card.
  const { users } = await import('@factory/db/schema');
  const owners = await database.select({ id: users.id, name: users.name }).from(users);

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    icon: row.icon,
    kind: row.kind,
    // Which engine each one runs on, wherever agents are listed (FR-036b).
    engine: row.engine,
    model: row.model,
    allowedTools: row.allowedTools,
    skills: attached.filter((a) => a.agentId === row.id).map((a) => a.name),
    ownerId: row.ownerId,
    ownerName: owners.find((owner) => owner.id === row.ownerId)?.name ?? null,
    isDefault: row.ownerId === null,
    mayChange: Boolean(user) && (user?.role === 'admin' || row.ownerId === user?.id),
    usage: usage.get(row.id) ?? { pipelines: 0, runs: 0, runsInFlight: 0 },
  }));
}

export async function getAgent(
  database: Database,
  agentId: string,
  user: SessionUser | null,
): Promise<AgentDetail> {
  const [row] = await database.select().from(agents).where(eq(agents.id, agentId)).limit(1);
  if (!row) throw notFound('no such agent');

  const ownership = await ownershipOf(database, 'agent', agentId, user);
  const held = await database
    .select({ id: skills.id, name: skills.name, description: skills.description })
    .from(agentSkills)
    .innerJoin(skills, eq(skills.id, agentSkills.skillId))
    .where(eq(agentSkills.agentId, agentId))
    .orderBy(skills.name);
  const usage = await agentUsage(database);

  return {
    id: row.id,
    name: row.name,
    description: row.description,
    icon: row.icon,
    kind: row.kind,
    engine: row.engine,
    model: row.model,
    systemPrompt: row.systemPrompt,
    allowedTools: row.allowedTools,
    maxCostUsd: row.maxCostUsd,
    maxMinutes: row.maxMinutes,
    maxTurns: row.maxTurns,
    skills: held,
    ownerId: ownership.ownerId,
    ownerName: ownership.ownerName,
    isDefault: ownership.isDefault,
    mayChange: ownership.mayChange,
    resettable: row.defaultConfig !== null,
    modifiedFromShipped: await isModifiedFromShipped(database, agentId),
    usage: usage.get(row.id) ?? { pipelines: 0, runs: 0, runsInFlight: 0 },
    usedBy: await pipelinesUsingAgent(database, agentId),
  };
}

export interface AgentInput {
  name?: string;
  description?: string | null;
  engine?: 'claude_cli' | 'design_cli';
  model?: string;
  systemPrompt?: string;
  allowedTools?: string[];
  maxCostUsd?: string | null;
  maxMinutes?: number | null;
  maxTurns?: number | null;
  skillIds?: string[];
}

/** Any member creates their own, with no administrator involved (FR-006). */
export async function createAgent(
  database: Database,
  input: AgentInput & { name: string },
  user: SessionUser,
): Promise<{ id: string }> {
  const engine = input.engine ?? 'claude_cli';
  const fields = validate({ ...input, engine });

  const [created] = await database
    .insert(agents)
    .values({
      name: input.name.trim(),
      description: input.description ?? null,
      kind: 'custom',
      ownerId: user.id,
      engine,
      model: fields.model ?? MODELS[engine][0] ?? 'claude-sonnet-5',
      systemPrompt: input.systemPrompt ?? '',
      allowedTools: engine === 'design_cli' ? [] : (input.allowedTools ?? ['Read']),
      maxCostUsd: input.maxCostUsd ?? null,
      maxMinutes: input.maxMinutes ?? null,
      maxTurns: input.maxTurns ?? null,
    })
    .returning();
  if (!created) throw conflict('could not create the agent');

  await setSkills(database, created.id, input.skillIds ?? []);
  return { id: created.id };
}

export async function updateAgent(
  database: Database,
  agentId: string,
  input: AgentInput,
  user: SessionUser,
): Promise<{ changed: true }> {
  await requireChangeable(database, 'agent', agentId, user);
  const [existing] = await database.select().from(agents).where(eq(agents.id, agentId)).limit(1);
  if (!existing) throw notFound('no such agent');

  const engine = input.engine ?? existing.engine;
  const fields = validate({ ...input, engine });

  await database
    .update(agents)
    .set({
      ...(input.name === undefined ? {} : { name: input.name.trim() }),
      ...(input.description === undefined ? {} : { description: input.description }),
      ...(input.engine === undefined ? {} : { engine: input.engine }),
      ...(fields.model === undefined ? {} : { model: fields.model }),
      ...(input.systemPrompt === undefined ? {} : { systemPrompt: input.systemPrompt }),
      // Tool permissions do not apply to the design engine (FR-036a), so
      // switching to it clears them rather than keeping them dormant.
      ...(engine === 'design_cli'
        ? { allowedTools: [] }
        : input.allowedTools === undefined
          ? {}
          : { allowedTools: input.allowedTools }),
      ...(input.maxCostUsd === undefined ? {} : { maxCostUsd: input.maxCostUsd }),
      ...(input.maxMinutes === undefined ? {} : { maxMinutes: input.maxMinutes }),
      ...(input.maxTurns === undefined ? {} : { maxTurns: input.maxTurns }),
      updatedAt: new Date(),
    })
    .where(eq(agents.id, agentId));

  if (input.skillIds !== undefined) await setSkills(database, agentId, input.skillIds);
  return { changed: true };
}

/** Each limit is independent, and each must be usable if it is set. */
function validate(input: AgentInput & { engine: 'claude_cli' | 'design_cli' }) {
  if (input.model !== undefined && !MODELS[input.engine].includes(input.model)) {
    throw invalidInput(
      `${input.model} is not one of the models the ${
        input.engine === 'design_cli' ? 'design service' : 'coding agent'
      } offers.`,
    );
  }
  if (input.allowedTools?.some((tool) => !TOOLS.includes(tool as Tool))) {
    const unknown = input.allowedTools.filter((tool) => !TOOLS.includes(tool as Tool));
    throw invalidInput(`There is no tool called ${unknown.join(', ')}.`);
  }
  if (input.maxCostUsd != null && Number(input.maxCostUsd) <= 0) {
    throw invalidInput('A cost limit of zero would stop the step before it began.');
  }
  if (input.maxMinutes != null && input.maxMinutes <= 0) {
    throw invalidInput('A time limit of zero would stop the step before it began.');
  }
  if (input.maxTurns != null && input.maxTurns <= 0) {
    throw invalidInput('A turn limit of zero would stop the step before it began.');
  }
  return { model: input.model };
}

async function setSkills(database: Database, agentId: string, skillIds: string[]) {
  const unique = [...new Set(skillIds)];
  if (unique.length > 0) {
    const found = await database
      .select({ id: skills.id })
      .from(skills)
      .where(inArray(skills.id, unique));
    if (found.length !== unique.length) throw notFound('one of those skills does not exist');
  }
  await database.delete(agentSkills).where(eq(agentSkills.agentId, agentId));
  if (unique.length > 0) {
    await database
      .insert(agentSkills)
      .values(unique.map((skillId) => ({ agentId, skillId })))
      .onConflictDoNothing();
  }
}

/**
 * FR-040 — a modified default agent goes back to what shipped. The shipped
 * configuration is stored on the row rather than looked up by name, so a
 * rename does not lose the way back.
 */
export async function resetAgent(
  database: Database,
  agentId: string,
  user: SessionUser,
): Promise<{ reset: true }> {
  await requireChangeable(database, 'agent', agentId, user);
  const [row] = await database.select().from(agents).where(eq(agents.id, agentId)).limit(1);
  if (!row) throw notFound('no such agent');
  if (!row.defaultConfig) {
    throw invalidInput(
      'This agent was created here rather than shipped, so there is no shipped ' +
        'configuration to go back to.',
    );
  }

  const shipped = row.defaultConfig as {
    name: string;
    description: string | null;
    engine: 'claude_cli' | 'design_cli';
    model: string;
    systemPrompt: string;
    allowedTools: string[];
  };
  await database
    .update(agents)
    .set({
      name: shipped.name,
      description: shipped.description,
      engine: shipped.engine,
      model: shipped.model,
      systemPrompt: shipped.systemPrompt,
      allowedTools: shipped.allowedTools,
      maxCostUsd: null,
      maxMinutes: null,
      maxTurns: null,
      updatedAt: new Date(),
    })
    .where(eq(agents.id, agentId));
  return { reset: true };
}

/**
 * Deleting an agent. Runs in flight are unaffected — their snapshot holds
 * everything they need (FR-044) — but a pipeline that still names it would
 * fail to start, so that is refused rather than discovered later.
 */
export async function deleteAgent(
  database: Database,
  agentId: string,
  user: SessionUser,
): Promise<{ deleted: true; runsStillUsingIt: number }> {
  await requireChangeable(database, 'agent', agentId, user);
  const using = await pipelinesUsingAgent(database, agentId);
  if (using.length > 0) {
    throw conflict(
      `${using.map((p) => p.name).join(', ')} still use${using.length === 1 ? 's' : ''} this ` +
        'agent. Take it out of them first, or a ticket on them could not start.',
    );
  }

  // Runs in flight are NOT a refusal: each read the agent once and never
  // looks again (FR-044). The count comes back so the caller can say so,
  // because silence here would look like a bug when those runs carry on.
  const runsStillUsingIt = await runsInFlightWithAgent(database, agentId);
  await database.delete(agentSkills).where(eq(agentSkills.agentId, agentId));
  await database.delete(agents).where(eq(agents.id, agentId));
  return { deleted: true, runsStillUsingIt };
}

/** Duplicating, which is how a shipped default becomes yours to change. */
export async function duplicateAgent(
  database: Database,
  agentId: string,
  user: SessionUser,
): Promise<{ id: string; name: string }> {
  const [source] = await database.select().from(agents).where(eq(agents.id, agentId)).limit(1);
  if (!source) throw notFound('no such agent');

  const [copy] = await database
    .insert(agents)
    .values({
      name: `${source.name.replace(/ \(copy\)$/, '')} (copy)`,
      description: source.description,
      icon: source.icon,
      kind: 'custom',
      ownerId: user.id,
      engine: source.engine,
      model: source.model,
      systemPrompt: source.systemPrompt,
      allowedTools: source.allowedTools,
      maxCostUsd: source.maxCostUsd,
      maxMinutes: source.maxMinutes,
      maxTurns: source.maxTurns,
    })
    .returning();
  if (!copy) throw conflict('could not duplicate the agent');

  const held = await database
    .select({ skillId: agentSkills.skillId })
    .from(agentSkills)
    .where(eq(agentSkills.agentId, agentId));
  await setSkills(
    database,
    copy.id,
    held.map((row) => row.skillId),
  );
  return { id: copy.id, name: copy.name };
}

/** The variables an agent's instructions may reference (FR-037, spec §8.3). */
export const TEMPLATE_VARIABLES = [
  { name: 'ticket.id', what: 'The ticket reference, like #142' },
  { name: 'ticket.title', what: 'Its title' },
  { name: 'ticket.description', what: 'Its description' },
  { name: 'ticket.acceptance', what: 'Its acceptance criteria, one per line' },
  { name: 'ticket.has_ui', what: 'Whether it changes the interface, once decided' },
  { name: 'repo.name', what: 'The repository name' },
  { name: 'repo.branch', what: "The run's branch" },
  { name: 'repo.default_branch', what: 'The branch it will merge into' },
  { name: 'run.attempt', what: 'Which attempt this is' },
  { name: 'feedback', what: 'A reviewer’s requested changes, when there are any' },
  { name: 'design.screens', what: 'Paths of the designed screens, when a design step ran' },
] as const;

/** Whether an agent still matches what shipped, for the editor's Reset. */
export async function isModifiedFromShipped(database: Database, agentId: string): Promise<boolean> {
  const [row] = await database.select().from(agents).where(eq(agents.id, agentId)).limit(1);
  if (!row?.defaultConfig) return false;
  const shipped = row.defaultConfig as Record<string, unknown>;
  return (
    row.systemPrompt !== shipped.systemPrompt ||
    row.model !== shipped.model ||
    JSON.stringify(row.allowedTools) !== JSON.stringify(shipped.allowedTools) ||
    row.name !== shipped.name
  );
}

/** Attaching or detaching one skill, which is what the editor's toggles do. */
export async function toggleSkill(
  database: Database,
  agentId: string,
  skillId: string,
  attached: boolean,
  user: SessionUser,
): Promise<{ attached: boolean }> {
  await requireChangeable(database, 'agent', agentId, user);
  if (attached) {
    await database.insert(agentSkills).values({ agentId, skillId }).onConflictDoNothing();
  } else {
    await database
      .delete(agentSkills)
      .where(and(eq(agentSkills.agentId, agentId), eq(agentSkills.skillId, skillId)));
  }
  return { attached };
}
