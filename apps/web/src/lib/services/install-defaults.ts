import type { Database } from '@factory/db';
import { agents, pipelines, pipelineVersions } from '@factory/db/schema';
import type { Step } from '@factory/shared';
import { eq } from 'drizzle-orm';
import { DEFAULT_AGENTS } from './agent-defaults';
import { DEFAULT_PIPELINES } from './pipeline-defaults';

/**
 * Putting the shipped agents and the three shipped pipelines into the
 * database (FR-033, FR-034).
 *
 * Both were defined and neither was ever installed — `DEFAULT_AGENTS` was
 * imported and unused, `DEFAULT_PIPELINES` had no reader — so a fresh
 * deployment had no agents and no pipelines at all. A ticket needs a
 * pipeline, so nothing could be started; and "resetting a modified default
 * restores what shipped" had no shipped default to restore.
 *
 * `agentStep` builds a step naming an agent by SLUG, because a definition in
 * source cannot know a database id. The slug has to become the real id here,
 * once, at install: leaving it would put a string where every reader expects
 * a UUID, and a pipeline whose steps name nothing runnable is worse than no
 * pipeline.
 *
 * Idempotent, and matched by name rather than by a slug column: running it
 * twice installs nothing twice, and it never overwrites an agent or pipeline
 * somebody has since changed — a re-install is not a reset (that is
 * `resetAgent`, which each agent's `default_config` is stored for).
 */
export interface Installed {
  agentsCreated: string[];
  pipelinesCreated: string[];
  /** Already there, so left exactly as they are. */
  agentsKept: string[];
  pipelinesKept: string[];
}

export async function installDefaults(database: Database): Promise<Installed> {
  const result: Installed = {
    agentsCreated: [],
    pipelinesCreated: [],
    agentsKept: [],
    pipelinesKept: [],
  };

  /** slug → the agent's real id, for rewriting the pipelines' steps. */
  const idBySlug = new Map<string, string>();

  for (const shipped of DEFAULT_AGENTS) {
    const [existing] = await database
      .select({ id: agents.id })
      .from(agents)
      .where(eq(agents.name, shipped.name))
      .limit(1);
    if (existing) {
      idBySlug.set(shipped.slug, existing.id);
      result.agentsKept.push(shipped.name);
      continue;
    }

    const values = {
      name: shipped.name,
      description: shipped.description,
      icon: shipped.icon,
      kind: 'default' as const,
      engine: shipped.engine,
      model: shipped.model,
      systemPrompt: shipped.systemPrompt,
      allowedTools: shipped.allowedTools,
    };
    const [created] = await database
      .insert(agents)
      .values({
        ...values,
        // What `resetAgent` goes back to. Recorded at install, so a change
        // made later has something to be undone against (FR-040).
        defaultConfig: values,
      })
      .returning({ id: agents.id });
    if (!created) throw new Error(`could not install the ${shipped.name} agent`);
    idBySlug.set(shipped.slug, created.id);
    result.agentsCreated.push(shipped.name);
  }

  /** Replaces each step's slug with the installed agent's id. */
  const resolved = (steps: Step[]): Step[] =>
    steps.map((step) => {
      if (step.type !== 'agent' || !step.agent_id) return step;
      const id = idBySlug.get(step.agent_id);
      if (!id) {
        // A pipeline naming an agent that does not exist would fail at that
        // step, at the worst possible moment. Better to refuse to install it.
        throw new Error(
          `a shipped pipeline names the agent ${step.agent_id}, which is not shipped`,
        );
      }
      return { ...step, agent_id: id };
    });

  for (const shipped of DEFAULT_PIPELINES) {
    const [existing] = await database
      .select({ id: pipelines.id })
      .from(pipelines)
      .where(eq(pipelines.name, shipped.name))
      .limit(1);
    if (existing) {
      result.pipelinesKept.push(shipped.name);
      continue;
    }

    const [created] = await database
      .insert(pipelines)
      // A shipped pipeline has no owner: ownership is what makes something
      // one person's to change, and these belong to the workspace (FR-006).
      .values({ name: shipped.name, description: shipped.description, currentVersion: 1 })
      .returning({ id: pipelines.id });
    if (!created) throw new Error(`could not install the ${shipped.name} pipeline`);
    await database.insert(pipelineVersions).values({
      pipelineId: created.id,
      version: 1,
      steps: resolved(shipped.steps),
    });
    result.pipelinesCreated.push(shipped.name);
  }

  return result;
}
