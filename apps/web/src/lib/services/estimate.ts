import type { Database } from '@factory/db';
import { agents, pipelineVersions, runs, stepResults, workspaces } from '@factory/db/schema';
import { CONDITION_DESCRIPTION, notFound, type Step } from '@factory/shared';
import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import { verifies } from './pipeline-defaults';
import { totalTokensSql } from './token-columns';

/**
 * What a person sees before starting a ticket (FR-019): every step with the
 * agent and model behind it, which steps are conditional and on what
 * (FR-019a), whether the pipeline verifies anything at all (FR-034a, SC-016),
 * and an estimate.
 *
 * The estimate comes from comparable past runs, and is explicitly NOT a
 * commitment (spec Assumptions). When there is no history we say so rather
 * than inventing a number from token prices we cannot predict.
 */

export interface StepPreview {
  index: number;
  type: Step['type'];
  label: string;
  /** What the step is for, in the agent's own words (design.pen 05). */
  description?: string;
  /** The agent's own icon, so the preview and the builder agree. */
  icon?: string;
  model?: string;
  conditional: boolean;
  /** The condition in words, never as a code (FR-032f). */
  conditionText?: string;
  /**
   * The condition itself and the engine the step's agent runs on, so a screen
   * can say both in its own language (specs/004-bento-redesign FR-019,
   * FR-026) — "Интерфейс өөрчлөгдөх бол", "pen.dev · Claude Opus 5".
   */
  condition: Step['condition'];
  engine?: 'claude_cli' | 'design_cli';
}

export type Estimate =
  | { kind: 'measured'; tokens: number; minutes: number; samples: number }
  | { kind: 'unknown'; ceilingMinutes: number };

export interface RunPreview {
  steps: StepPreview[];
  verifies: boolean;
  estimate: Estimate;
}

/** What a step with no agent behind it is for. */
const DESCRIPTION: Record<Step['type'], string | undefined> = {
  agent: undefined,
  design: undefined,
  checkpoint: 'Pauses until someone approves',
  shell: 'Runs a script in the sandbox',
  notify: 'Sends a message',
};

const TYPE_LABEL: Record<Step['type'], string> = {
  agent: 'Agent',
  design: 'Design',
  checkpoint: 'Human checkpoint',
  shell: 'Shell command',
  notify: 'Notify',
};

export async function previewRun(
  database: Database,
  pipelineId: string,
  version: number,
): Promise<RunPreview> {
  const rows = await database
    .select()
    .from(pipelineVersions)
    .where(eq(pipelineVersions.pipelineId, pipelineId));
  const pinned = rows.find((row) => row.version === version);
  if (!pinned) throw notFound(`pipeline version ${version} does not exist`);

  const steps = pinned.steps as Step[];
  const agentIds = [...new Set(steps.map((s) => s.agent_id).filter((id): id is string => !!id))];
  const agentRows = agentIds.length
    ? await database.select().from(agents).where(inArray(agents.id, agentIds))
    : [];

  const preview: StepPreview[] = steps.map((step, index) => {
    const agent = agentRows.find((a) => a.id === step.agent_id);
    return {
      index,
      type: step.type,
      label:
        agent?.name ?? (step.type === 'shell' ? (step.command ?? 'shell') : TYPE_LABEL[step.type]),
      description: agent?.description ?? DESCRIPTION[step.type],
      icon: agent?.icon ?? undefined,
      model: agent?.model,
      conditional: step.condition !== 'always',
      conditionText: CONDITION_DESCRIPTION[step.condition],
      condition: step.condition,
      engine: agent?.engine,
    };
  });

  return {
    steps: preview,
    verifies: verifies(steps),
    estimate: await estimate(database, pipelineId),
  };
}

async function estimate(database: Database, pipelineId: string): Promise<Estimate> {
  const past = await database
    .select({ id: runs.id, startedAt: runs.startedAt, finishedAt: runs.finishedAt })
    .from(runs)
    .where(and(eq(runs.status, 'done'), isNotNull(runs.finishedAt)))
    .orderBy(desc(runs.finishedAt))
    .limit(50);

  // What each of those runs processed. A run from before tokens were recorded
  // has none, and is not a sample: averaging it in as zero would say the next
  // run is nearly free.
  const perRun = past.length
    ? await database
        .select({ runId: stepResults.runId, total: totalTokensSql })
        .from(stepResults)
        .where(
          inArray(
            stepResults.runId,
            past.map((row) => row.id),
          ),
        )
        .groupBy(stepResults.runId)
    : [];
  const processed = new Map(perRun.map((row) => [row.runId, Number(row.total)]));

  const comparable = past.filter(
    (row) => row.startedAt && row.finishedAt && (processed.get(row.id) ?? 0) > 0,
  );
  if (comparable.length === 0) {
    const [workspace] = await database
      .select()
      .from(workspaces)
      .orderBy(workspaces.createdAt)
      .limit(1);
    return { kind: 'unknown', ceilingMinutes: workspace?.defaultTimeCeilingMinutes ?? 45 };
  }

  const totalTokens = comparable.reduce((sum, row) => sum + (processed.get(row.id) ?? 0), 0);
  const totalMinutes = comparable.reduce(
    (sum, row) =>
      sum + ((row.finishedAt as Date).getTime() - (row.startedAt as Date).getTime()) / 60_000,
    0,
  );
  return {
    kind: 'measured',
    tokens: Math.round(totalTokens / comparable.length),
    minutes: Math.max(1, Math.round(totalMinutes / comparable.length)),
    samples: comparable.length,
  };
}

/** The sentence the ticket form shows when nothing verifies the result. */
export function verificationWarning(preview: RunPreview): string | null {
  return preview.verifies
    ? null
    : 'This pipeline has no verification step, so nothing beyond the implementing agent will ' +
        'check the result. Add a shell step running your tests to change that.';
}
