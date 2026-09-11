import { FactoryError, notAuthorised } from '@factory/shared';
import * as v from 'valibot';
import { command, form, getRequestEvent, query } from '$app/server';
import { db } from '$lib/db';
import { formBoolean } from '$lib/forms';
import {
  createAgent,
  deleteAgent,
  duplicateAgent,
  getAgent,
  listAgents,
  MODELS,
  resetAgent,
  TOOLS,
  toggleSkill,
  updateAgent,
} from '$lib/services/agent';

/**
 * Agents. Readable and usable by anyone; changeable only by the owner or an
 * administrator, which the service enforces rather than the component
 * (contracts/ui-data.md).
 */

function requireUser() {
  const user = getRequestEvent().locals.user;
  if (!user) throw notAuthorised('you must be signed in');
  return user;
}

const AgentId = v.pipe(v.string(), v.uuid());

/** Every mutation reports a refusal a person can read, rather than throwing. */
async function attempt<T extends object>(work: () => Promise<T>): Promise<T | { problem: string }> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof FactoryError) return { problem: error.message };
    throw error;
  }
}

export const agents = query(async () => {
  const user = requireUser();
  return listAgents(db(), user);
});

export const agent = query(AgentId, async (id) => {
  const user = requireUser();
  return getAgent(db(), id, user);
});

/** The vocabulary the editor offers: the tools, and each engine's models. */
export const options = query(async () => {
  requireUser();
  const { TEMPLATE_VARIABLES, TOOL_DESCRIPTION } = await import('$lib/services/agent');
  return {
    tools: TOOLS.map((tool) => ({ name: tool, what: TOOL_DESCRIPTION[tool] })),
    models: MODELS,
    variables: TEMPLATE_VARIABLES.map((variable) => ({ ...variable })),
  };
});

/**
 * Instructions, model, permitted tools, attached skills and each limit are
 * separate fields on one form, so they are configured independently but
 * saved together — a half-saved agent would be worse than either (FR-036).
 */
const SaveSchema = v.object({
  agentId: AgentId,
  name: v.pipe(v.string(), v.trim(), v.minLength(1, 'Give the agent a name.')),
  description: v.optional(v.string(), ''),
  engine: v.picklist(['claude_cli', 'design_cli'] as const),
  model: v.pipe(v.string(), v.minLength(1, 'Choose a model.')),
  systemPrompt: v.optional(v.string(), ''),
  /** Checkboxes, so the tools arrive as a comma-separated hidden field. */
  allowedTools: v.optional(v.string(), ''),
  skillIds: v.optional(v.string(), ''),
  maxCostUsd: v.optional(v.string(), ''),
  maxMinutes: v.optional(v.string(), ''),
  maxTurns: v.optional(v.string(), ''),
});

const list = (value: string) =>
  value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

const optionalNumber = (value: string) => (value.trim() ? Number(value) : null);

export const save = form(SaveSchema, async (input) => {
  const user = requireUser();
  return attempt(async () => {
    await updateAgent(
      db(),
      input.agentId,
      {
        name: input.name,
        description: input.description || null,
        engine: input.engine,
        model: input.model,
        systemPrompt: input.systemPrompt,
        allowedTools: list(input.allowedTools),
        skillIds: list(input.skillIds),
        maxCostUsd: input.maxCostUsd.trim() || null,
        maxMinutes: optionalNumber(input.maxMinutes),
        maxTurns: optionalNumber(input.maxTurns),
      },
      user,
    );
    await agent(input.agentId).refresh();
    await agents().refresh();
    return { message: 'Saved. Runs already in flight are unaffected.' };
  });
});

const CreateSchema = v.object({
  name: v.pipe(v.string(), v.trim(), v.minLength(1, 'Give the agent a name.')),
  engine: v.optional(v.picklist(['claude_cli', 'design_cli'] as const), 'claude_cli'),
  description: v.optional(v.string(), ''),
});

export const create = form(CreateSchema, async (input) => {
  const user = requireUser();
  return attempt(async () => {
    const created = await createAgent(
      db(),
      { name: input.name, engine: input.engine, description: input.description || null },
      user,
    );
    await agents().refresh();
    return { id: created.id };
  });
});

/** Back to what shipped (FR-040). */
export const reset = command(AgentId, async (id) => {
  const user = requireUser();
  return attempt(async () => {
    await resetAgent(db(), id, user);
    await agent(id).refresh();
    await agents().refresh();
    return { message: 'Back to the configuration this agent shipped with.' };
  });
});

export const duplicate = command(AgentId, async (id) => {
  const user = requireUser();
  return attempt(async () => {
    const copy = await duplicateAgent(db(), id, user);
    await agents().refresh();
    return { ...copy, message: `Duplicated as “${copy.name}”, and it is yours to change.` };
  });
});

export const remove = command(AgentId, async (id) => {
  const user = requireUser();
  return attempt(async () => {
    const { runsStillUsingIt } = await deleteAgent(db(), id, user);
    await agents().refresh();
    return {
      message:
        runsStillUsingIt === 0
          ? 'Deleted.'
          : `Deleted. ${runsStillUsingIt} run${runsStillUsingIt === 1 ? '' : 's'} still ` +
            'running will finish: each read this agent when it started and never looks again.',
    };
  });
});

/** One skill on or off, which is what the editor's toggles do (FR-042). */
export const attach = command(
  v.object({ agentId: AgentId, skillId: v.pipe(v.string(), v.uuid()), on: formBoolean() }),
  async ({ agentId, skillId, on }) => {
    const user = requireUser();
    return attempt(async () => {
      await toggleSkill(db(), agentId, skillId, on, user);
      await agent(agentId).refresh();
      return { attached: on };
    });
  },
);
