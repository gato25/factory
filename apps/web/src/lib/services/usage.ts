import type { Database } from '@factory/db';
import { agentSkills, agents, pipelineVersions, runs, skills, tickets } from '@factory/db/schema';
import type { PipelineSnapshot, Step } from '@factory/shared';
import { eq, inArray, sql } from 'drizzle-orm';

/**
 * How many pipelines and runs depend on each agent and each skill (FR-043a).
 * This is what makes changing one an informed decision rather than a guess,
 * and it is also the honest answer to "is this safe to delete".
 *
 * Runs are counted from their SNAPSHOTS, not from the current pipeline: a run
 * that started before an agent was detached still depends on it, because that
 * is what it is executing (FR-044).
 */

export interface Usage {
  /** Current versions of pipelines that reference it. */
  pipelines: number;
  /** Runs whose snapshot references it. */
  runs: number;
  /** Of those, how many are still going. */
  runsInFlight: number;
}

const ACTIVE = ['queued', 'running', 'waiting_approval', 'opening_mr'] as const;

/** The current version's steps for every pipeline, as the builder shows them. */
async function currentVersions(database: Database) {
  const { pipelines } = await import('@factory/db/schema');
  const rows = await database
    .select({
      pipelineId: pipelineVersions.pipelineId,
      version: pipelineVersions.version,
      steps: pipelineVersions.steps,
      currentVersion: pipelines.currentVersion,
    })
    .from(pipelineVersions)
    .innerJoin(pipelines, eq(pipelines.id, pipelineVersions.pipelineId));
  return rows.filter((row) => row.version === row.currentVersion);
}

export async function agentUsage(database: Database): Promise<Map<string, Usage>> {
  const usage = new Map<string, Usage>();
  const bump = (id: string, field: keyof Usage) => {
    const current = usage.get(id) ?? { pipelines: 0, runs: 0, runsInFlight: 0 };
    usage.set(id, { ...current, [field]: current[field] + 1 });
  };

  for (const row of await currentVersions(database)) {
    // A pipeline counts once however many of its steps use the agent.
    const used = new Set(
      (row.steps as Step[]).map((step) => step.agent_id).filter((id): id is string => !!id),
    );
    for (const id of used) bump(id, 'pipelines');
  }

  const runRows = await database
    .select({ snapshot: runs.snapshot, status: runs.status })
    .from(runs);
  for (const row of runRows) {
    const snapshot = row.snapshot as PipelineSnapshot;
    const used = new Set(snapshot.agents.map((agent) => agent.id));
    for (const id of used) {
      bump(id, 'runs');
      if ((ACTIVE as readonly string[]).includes(row.status)) bump(id, 'runsInFlight');
    }
  }
  return usage;
}

export async function skillUsage(database: Database): Promise<Map<string, Usage>> {
  const usage = new Map<string, Usage>();
  const attachments = await database.select().from(agentSkills);
  const agentsForSkill = new Map<string, string[]>();
  for (const row of attachments) {
    agentsForSkill.set(row.skillId, [...(agentsForSkill.get(row.skillId) ?? []), row.agentId]);
  }

  const byAgent = await agentUsage(database);
  for (const [skillId, attached] of agentsForSkill) {
    // A pipeline that uses two agents holding the same skill counts once for
    // the pipeline; the numbers are about dependency, not about frequency.
    const totals = { pipelines: 0, runs: 0, runsInFlight: 0 };
    for (const agentId of attached) {
      const agent = byAgent.get(agentId);
      if (!agent) continue;
      totals.pipelines += agent.pipelines;
      totals.runs += agent.runs;
      totals.runsInFlight += agent.runsInFlight;
    }
    usage.set(skillId, totals);
  }

  // A skill attached to nothing still exists, and its zero is worth saying.
  for (const skill of await database.select({ id: skills.id }).from(skills)) {
    if (!usage.has(skill.id)) {
      usage.set(skill.id, { pipelines: 0, runs: 0, runsInFlight: 0 });
    }
  }
  return usage;
}

/** Which agents hold a skill, so a change names what it reaches. */
export async function agentsHolding(database: Database, skillId: string) {
  const rows = await database
    .select({ id: agents.id, name: agents.name })
    .from(agentSkills)
    .innerJoin(agents, eq(agents.id, agentSkills.agentId))
    .where(eq(agentSkills.skillId, skillId))
    .orderBy(agents.name);
  return rows;
}

/** Which pipelines a given agent appears in, by name. */
export async function pipelinesUsingAgent(database: Database, agentId: string) {
  const { pipelines } = await import('@factory/db/schema');
  const current = await currentVersions(database);
  const ids = current
    .filter((row) => (row.steps as Step[]).some((step) => step.agent_id === agentId))
    .map((row) => row.pipelineId);
  if (ids.length === 0) return [];
  return database
    .select({ id: pipelines.id, name: pipelines.name })
    .from(pipelines)
    .where(inArray(pipelines.id, ids))
    .orderBy(pipelines.name);
}

/**
 * Runs still in flight that pinned this agent. Deleting it cannot reach them
 * — their snapshot holds everything they need — but a person deleting it
 * should know they exist.
 */
export async function runsInFlightWithAgent(database: Database, agentId: string): Promise<number> {
  const [row] = await database
    .select({ count: sql<number>`count(*)::int` })
    .from(runs)
    .innerJoin(tickets, eq(tickets.id, runs.ticketId))
    .where(
      sql`${runs.status} in ('queued', 'running', 'waiting_approval', 'opening_mr')
        and ${runs.snapshot} -> 'agents' @> ${JSON.stringify([{ id: agentId }])}::jsonb`,
    );
  return row?.count ?? 0;
}
