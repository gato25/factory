import type { Database } from '@factory/db';
import { agents, pipelineVersions, runs, workspaces } from '@factory/db/schema';
import { CONDITION_DESCRIPTION, notFound, type Step } from '@factory/shared';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { verifies } from './pipeline-defaults';

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
  model?: string;
  conditional: boolean;
  /** The condition in words, never as a code (FR-032f). */
  conditionText?: string;
}

export type Estimate =
  | { kind: 'measured'; costUsd: string; minutes: number; samples: number }
  | { kind: 'unknown'; ceilingUsd: string; ceilingMinutes: number };

export interface RunPreview {
  steps: StepPreview[];
  verifies: boolean;
  estimate: Estimate;
}

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
      model: agent?.model,
      conditional: step.condition !== 'always',
      conditionText: CONDITION_DESCRIPTION[step.condition],
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
    .select({ costUsd: runs.costUsd, startedAt: runs.startedAt, finishedAt: runs.finishedAt })
    .from(runs)
    .where(and(eq(runs.status, 'done'), isNotNull(runs.finishedAt)))
    .limit(50);

  const comparable = past.filter((row) => row.startedAt && row.finishedAt);
  if (comparable.length === 0) {
    const [workspace] = await database
      .select()
      .from(workspaces)
      .orderBy(workspaces.createdAt)
      .limit(1);
    return {
      kind: 'unknown',
      ceilingUsd: workspace?.defaultCostCeilingUsd ?? '5.0000',
      ceilingMinutes: workspace?.defaultTimeCeilingMinutes ?? 45,
    };
  }

  const totalTenths = comparable.reduce((sum, row) => sum + toTenths(row.costUsd), 0);
  const totalMinutes = comparable.reduce(
    (sum, row) =>
      sum + ((row.finishedAt as Date).getTime() - (row.startedAt as Date).getTime()) / 60_000,
    0,
  );
  return {
    kind: 'measured',
    costUsd: fromTenths(Math.round(totalTenths / comparable.length)),
    minutes: Math.max(1, Math.round(totalMinutes / comparable.length)),
    samples: comparable.length,
  };
}

const toTenths = (value: string) => {
  const [whole, fraction = ''] = value.split('.');
  return Number(`${whole}${fraction.padEnd(4, '0').slice(0, 4)}`);
};
const fromTenths = (value: number) => {
  const s = String(value).padStart(5, '0');
  return `${s.slice(0, -4)}.${s.slice(-4)}`;
};

/** The sentence the ticket form shows when nothing verifies the result. */
export function verificationWarning(preview: RunPreview): string | null {
  return preview.verifies
    ? null
    : 'This pipeline has no verification step, so nothing beyond the implementing agent will ' +
        'check the result. Add a shell step running your tests to change that.';
}
