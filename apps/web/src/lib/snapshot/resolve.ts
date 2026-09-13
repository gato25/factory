import type { Database } from '@factory/db';
import {
  agentSkills,
  agents,
  pipelines,
  pipelineVersions,
  repositories,
  skills,
  tickets,
  workspaces,
} from '@factory/db/schema';
import {
  invalidInput,
  notFound,
  type PipelineSnapshot,
  type SnapshotAgent,
  type Step,
} from '@factory/shared';
import { and, eq, inArray } from 'drizzle-orm';
import { fileManifest } from '../services/ticket-files';
import { type Ceilings, resolveCeilings } from './ceilings';

/**
 * Flatten the pipeline version, every agent, every skill and every ceiling
 * into ONE document, consulted once and never re-read (FR-044). This is what
 * lets a member edit their own agent without disturbing a run in flight
 * (FR-041, SC-010), and it is why the orchestrator can stay generic.
 */

export interface ResolveInput {
  ticketId: string;
  attempt: number;
  runId: string;
  callbackUrl: string;
  resumeSecret: string;
}

export interface ResolvedSnapshot {
  snapshot: PipelineSnapshot;
  ceilings: Ceilings;
}

export async function resolveSnapshot(
  database: Database,
  input: ResolveInput,
): Promise<ResolvedSnapshot> {
  const [ticket] = await database
    .select()
    .from(tickets)
    .where(eq(tickets.id, input.ticketId))
    .limit(1);
  if (!ticket) throw notFound('no such ticket');
  if (!ticket.pipelineId || ticket.pipelineVersion == null) {
    throw invalidInput('this ticket has no pinned pipeline version, so it cannot start');
  }

  const [repository] = await database
    .select()
    .from(repositories)
    .where(eq(repositories.id, ticket.repositoryId))
    .limit(1);
  if (!repository) throw notFound('that repository is not connected');
  if (!repository.credentialId) {
    throw invalidInput(`${repository.fullPath} has no stored credential`);
  }

  // The pinned version, never the pipeline's current one (FR-027, SC-010).
  // Matched in the query: filtering after a limit would pick one arbitrary
  // row and then reject it, so every run on an edited pipeline would fail.
  const [version] = await database
    .select()
    .from(pipelineVersions)
    .where(
      and(
        eq(pipelineVersions.pipelineId, ticket.pipelineId),
        eq(pipelineVersions.version, ticket.pipelineVersion),
      ),
    )
    .limit(1);
  if (!version) {
    throw notFound(`pipeline version ${ticket.pipelineVersion} no longer exists`);
  }
  const [pipeline] = await database
    .select()
    .from(pipelines)
    .where(eq(pipelines.id, ticket.pipelineId))
    .limit(1);

  const steps = version.steps as Step[];
  const agentIds = [...new Set(steps.map((s) => s.agent_id).filter((id): id is string => !!id))];
  const agentRows = agentIds.length
    ? await database.select().from(agents).where(inArray(agents.id, agentIds))
    : [];
  if (agentRows.length !== agentIds.length) {
    const missing = agentIds.filter((id) => !agentRows.some((a) => a.id === id));
    throw notFound(
      `this pipeline references an agent that no longer exists: ${missing.join(', ')}`,
    );
  }

  // Skills are copied in whole, so editing one later cannot reach this run.
  const links = agentRows.length
    ? await database
        .select()
        .from(agentSkills)
        .where(
          inArray(
            agentSkills.agentId,
            agentRows.map((a) => a.id),
          ),
        )
    : [];
  const skillIds = [...new Set(links.map((l) => l.skillId))];
  const skillRows = skillIds.length
    ? await database.select().from(skills).where(inArray(skills.id, skillIds))
    : [];

  const [workspace] = await database
    .select()
    .from(workspaces)
    .orderBy(workspaces.createdAt)
    .limit(1);
  if (!workspace) throw invalidInput('the workspace is not configured');

  // The run's ceiling comes from the workspace (FR-079). An agent's own
  // limits are per-STEP and travel on the agent below, capped in the runner
  // against what the run has left (FR-080) — folding them in here would let
  // one step's limit cap the whole run.
  const ceilings = resolveCeilings({
    workspace: {
      costUsd: workspace.defaultCostCeilingUsd,
      minutes: workspace.defaultTimeCeilingMinutes,
    },
  });

  const requirementFiles = await fileManifest(database, ticket.id);

  const snapshotAgents: SnapshotAgent[] = agentRows.map((agent) => ({
    id: agent.id,
    name: agent.name,
    engine: agent.engine,
    model: agent.model,
    system_prompt: agent.systemPrompt,
    allowed_tools: agent.engine === 'design_cli' ? [] : agent.allowedTools,
    skills: links
      .filter((l) => l.agentId === agent.id)
      .map((l) => skillRows.find((s) => s.id === l.skillId))
      .filter((s): s is NonNullable<typeof s> => !!s)
      .map((s) => ({ name: s.name, description: s.description, content: s.content })),
    limits: {
      max_cost_usd: agent.maxCostUsd ?? undefined,
      max_minutes: agent.maxMinutes ?? undefined,
      max_turns: agent.maxTurns ?? undefined,
    },
  }));

  const snapshot: PipelineSnapshot = {
    run_id: input.runId,
    attempt: input.attempt,
    ticket: {
      reference: ticket.reference,
      title: ticket.title,
      description: ticket.description,
      acceptance_criteria: ticket.acceptanceCriteria,
      // Pinned like everything else here: attaching a document after a run
      // has started must not change what that run was asked to build
      // (FR-044). The next attempt picks it up, which is what the retry is
      // for.
      requirement_files: requirementFiles,
    },
    repo: {
      clone_url: repository.cloneUrl,
      // The CURRENT default branch, not one recorded earlier (FR-065 edge case).
      default_branch: repository.defaultBranch,
      branch: ticket.branchName ?? `factory/${ticket.reference.replace('#', '')}`,
      provider: repository.provider,
      credential_ref: repository.credentialId,
    },
    pipeline: {
      id: ticket.pipelineId,
      version: ticket.pipelineVersion,
      name: pipeline?.name ?? 'pipeline',
      steps,
    },
    limits: { cost_ceiling_usd: ceilings.costUsd, time_ceiling_minutes: ceilings.minutes },
    // Pinned at start, like the ceilings: raising a sandbox's memory must
    // not reshape a container already running (FR-085, FR-044).
    sandbox: {
      image: workspace.sandboxImage,
      cpu: workspace.sandboxCpu,
      memory_mb: workspace.sandboxMemoryMb,
      wall_clock_minutes: workspace.sandboxWallClockMinutes,
      network_during_implement: workspace.sandboxNetworkDuringImplement,
    },
    agents: snapshotAgents,
    callback_url: input.callbackUrl,
    resume_secret: input.resumeSecret,
  };

  return { snapshot, ceilings };
}
