import type { Database } from '@factory/db';
import {
  artifacts,
  logChunks,
  pipelines,
  pipelineVersions,
  repositories,
  runs,
  stepResults,
  tickets,
  users,
  workspaces,
} from '@factory/db/schema';
import { CONDITION_DESCRIPTION, notFound, type PipelineSnapshot, type Step } from '@factory/shared';
import { and, count, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { m } from '$lib/i18n';
import { type RunStatus, type StepShape, shapeOf } from '$lib/step-shape';
import { queueState } from './queue';

/**
 * Everything the run page and the dashboard read. The stream carries changes;
 * this is the source of truth, so a viewer joining late still renders
 * correctly (D4).
 */

export interface StepView {
  index: number;
  type: Step['type'];
  label: string;
  model?: string;
  conditional: boolean;
  state: 'pending' | 'running' | 'done' | 'failed' | 'skipped';
  /** Present only when skipped — what FR-075a requires be shown. */
  conditionNotMet?: string | null;
  durationS?: number | null;
  costUsd?: string;
  summary?: string | null;
  errorDetail?: string | null;
  command?: string;
}

export interface RunView {
  run: {
    id: string;
    attempt: number;
    status: string;
    costUsd: string;
    costCeilingUsd: string;
    timeCeilingMinutes: number;
    currentStepIndex: number | null;
    /** Set while a pause has been asked for and the step is still finishing. */
    pauseRequestedAt: Date | null;
    failureReason: string | null;
    failureStepIndex: number | null;
    startedAt: Date | null;
    finishedAt: Date | null;
    containerId: string | null;
    orchestratorExecutionId: string | null;
  };
  ticket: {
    id: string;
    reference: string;
    title: string;
    /** Carried so editing and retrying can be one action (FR-089). */
    description: string | null;
    acceptanceCriteria: string[];
    status: string;
    branchName: string | null;
    mergeRequestUrl: string | null;
    hasUi: boolean | null;
    uiRationale: string | null;
    classificationMissing: boolean;
    createdBy: string;
    createdByName: string | null;
    createdAt: Date;
  };
  repository: { name: string; fullPath: string; provider: string; defaultBranch: string };
  pipeline: { name: string; version: number };
  steps: StepView[];
  artifacts: {
    id: string;
    kind: string;
    path: string;
    version: number;
    stepIndex: number;
    screenName: string | null;
    hasContent: boolean;
  }[];
}

export async function runView(database: Database, runId: string): Promise<RunView> {
  const [run] = await database.select().from(runs).where(eq(runs.id, runId)).limit(1);
  if (!run) throw notFound(m.error.noSuchRun);

  const [ticket] = await database
    .select()
    .from(tickets)
    .where(eq(tickets.id, run.ticketId))
    .limit(1);
  if (!ticket) throw notFound(m.error.runHasNoTicket);

  const [repository] = await database
    .select()
    .from(repositories)
    .where(eq(repositories.id, ticket.repositoryId))
    .limit(1);
  const [author] = await database
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, ticket.createdBy))
    .limit(1);

  const snapshot = run.snapshot as PipelineSnapshot;
  const results = await database.select().from(stepResults).where(eq(stepResults.runId, runId));
  const artifactRows = await database
    .select()
    .from(artifacts)
    .where(eq(artifacts.runId, runId))
    .orderBy(artifacts.stepIndex, artifacts.path, desc(artifacts.version));

  const steps: StepView[] = snapshot.pipeline.steps.map((step, index) => {
    const result = results.find((r) => r.stepIndex === index);
    const agent = snapshot.agents.find((a) => a.id === step.agent_id);
    return {
      index,
      type: step.type,
      label:
        agent?.name ??
        (step.type === 'shell' ? (step.command ?? 'shell command') : labelFor(step.type)),
      model: agent?.model,
      conditional: step.condition !== 'always',
      state: result?.status ?? 'pending',
      conditionNotMet: result?.conditionNotMet,
      durationS: result?.durationS,
      costUsd: result?.costUsd,
      summary: result?.summary,
      errorDetail: result?.errorDetail,
      command: step.command,
    };
  });

  return {
    run: {
      id: run.id,
      attempt: run.attempt,
      status: run.status,
      costUsd: run.costUsd,
      costCeilingUsd: run.costCeilingUsd,
      timeCeilingMinutes: run.timeCeilingMinutes,
      currentStepIndex: run.currentStepIndex,
      pauseRequestedAt: run.pauseRequestedAt,
      failureReason: run.failureReason,
      failureStepIndex: run.failureStepIndex,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      containerId: run.containerId,
      orchestratorExecutionId: run.orchestratorExecutionId,
    },
    ticket: {
      id: ticket.id,
      reference: ticket.reference,
      title: ticket.title,
      description: ticket.description,
      acceptanceCriteria: ticket.acceptanceCriteria,
      status: ticket.status,
      branchName: ticket.branchName,
      mergeRequestUrl: ticket.mergeRequestUrl,
      hasUi: ticket.hasUi,
      uiRationale: ticket.uiRationale,
      classificationMissing: ticket.classificationMissing,
      createdBy: ticket.createdBy,
      createdByName: author?.name ?? null,
      createdAt: ticket.createdAt,
    },
    repository: {
      // The crumb names the repository, not its whole path (design.pen 06).
      name: repository?.name ?? '',
      fullPath: repository?.fullPath ?? '',
      provider: repository?.provider ?? '',
      defaultBranch: repository?.defaultBranch ?? '',
    },
    pipeline: { name: snapshot.pipeline.name, version: snapshot.pipeline.version },
    steps,
    artifacts: artifactRows.map((a) => ({
      id: a.id,
      kind: a.kind,
      path: a.path,
      version: a.version,
      stepIndex: a.stepIndex,
      screenName: a.screenName,
      hasContent: a.content !== null,
    })),
  };
}

function labelFor(type: Step['type']): string {
  return {
    agent: 'Agent',
    design: 'Design',
    checkpoint: 'Human checkpoint',
    shell: 'Shell command',
    notify: 'Notify',
  }[type];
}

/** The most recent run of a ticket — its current one, or its last attempt. */
export async function latestRunForTicket(
  database: Database,
  ticketId: string,
): Promise<RunView | null> {
  const [latest] = await database
    .select({ id: runs.id })
    .from(runs)
    .where(eq(runs.ticketId, ticketId))
    .orderBy(desc(runs.attempt))
    .limit(1);
  return latest ? runView(database, latest.id) : null;
}

/** The live log for one step, oldest first (FR-076). */
export async function stepLog(database: Database, runId: string, stepIndex: number, after = 0) {
  return database
    .select()
    .from(logChunks)
    .where(
      and(
        eq(logChunks.runId, runId),
        eq(logChunks.stepIndex, stepIndex),
        gte(logChunks.seq, after + 1),
      ),
    )
    .orderBy(logChunks.seq);
}

export async function artifactContent(database: Database, artifactId: string) {
  const [row] = await database
    .select()
    .from(artifacts)
    .where(eq(artifacts.id, artifactId))
    .limit(1);
  if (!row) throw notFound(m.error.noSuchArtifact);
  return row;
}

/**
 * The tickets board, with the status strip each card shows: whichever of the
 * running step, the pending gate, the merge request, or the failure applies
 * (FR-023, FR-023a).
 */
export interface BoardTicket {
  id: string;
  reference: string;
  title: string;
  status: string;
  repositoryId: string;
  repository: string;
  pipelineId: string | null;
  pipeline: string | null;
  createdBy: string;
  createdByName: string | null;
  mergeRequestUrl: string | null;
  hasUi: boolean | null;
  strip: { kind: 'step' | 'gate' | 'merge_request' | 'failure' | 'none'; text: string };
  /**
   * Its progress through the pipeline its run pinned — or, before it has a
   * run, the version the ticket pinned (specs/004-bento-redesign FR-018).
   */
  steps: StepShape;
  /**
   * While it waits at a checkpoint: the step the checkpoint gates, under its
   * stored name, and since when — the moment the run paused, which is also
   * what a gate's timeout counts from. The approvals tile says both (FR-011).
   */
  gate: { step: string | null; since: string } | null;
}

export async function board(database: Database): Promise<BoardTicket[]> {
  const rows = await database
    .select({
      id: tickets.id,
      reference: tickets.reference,
      title: tickets.title,
      status: tickets.status,
      repositoryId: tickets.repositoryId,
      repository: repositories.name,
      pipelineId: tickets.pipelineId,
      pipeline: pipelines.name,
      createdBy: tickets.createdBy,
      createdByName: users.name,
      mergeRequestUrl: tickets.mergeRequestUrl,
      hasUi: tickets.hasUi,
      createdAt: tickets.createdAt,
      runId: runs.id,
      runStatus: runs.status,
      currentStepIndex: runs.currentStepIndex,
      failureStepIndex: runs.failureStepIndex,
      failureReason: runs.failureReason,
      runUpdatedAt: runs.updatedAt,
      snapshot: runs.snapshot,
      pipelineVersion: tickets.pipelineVersion,
    })
    .from(tickets)
    .leftJoin(repositories, eq(repositories.id, tickets.repositoryId))
    .leftJoin(pipelines, eq(pipelines.id, tickets.pipelineId))
    .leftJoin(users, eq(users.id, tickets.createdBy))
    .leftJoin(runs, eq(runs.id, tickets.currentRunId))
    .orderBy(desc(tickets.createdAt));

  // Every card's bar in two queries, not two per card (research D3).
  const shapes = await stepShapes(
    database,
    rows.map((row) => ({
      ticketId: row.id,
      pipelineId: row.pipelineId,
      pipelineVersion: row.pipelineVersion,
      runId: row.runId,
      runStatus: row.runStatus as RunStatus | null,
      currentStepIndex: row.currentStepIndex,
      failureStepIndex: row.failureStepIndex,
      snapshot: row.snapshot as PipelineSnapshot | null,
    })),
  );

  return rows.map((row) => {
    const snapshot = row.snapshot as PipelineSnapshot | null;
    const steps = snapshot?.pipeline.steps ?? [];
    const index = row.currentStepIndex ?? 0;
    const nameOfStep = (at: number) =>
      snapshot?.agents.find((a) => a.id === steps[at]?.agent_id)?.name ??
      (steps[at] ? labelFor(steps[at].type) : null);
    const label = nameOfStep(index);

    /**
     * A gate is named by what it is gating, not by itself: "Plan needs your
     * approval" says what to go and read, where "Human checkpoint needs your
     * approval" says only that one is waiting.
     */
    const gatedLabel = (() => {
      for (let at = index - 1; at >= 0; at -= 1) {
        if (steps[at]?.type !== 'checkpoint' && steps[at]?.type !== 'notify') {
          return nameOfStep(at);
        }
      }
      return null;
    })();

    // The words a ticket carries on the board are copy, so they come from the
    // catalogue rather than from here (`m.strip` in `$lib/i18n`). The step's
    // own name does not: it is whatever the pipeline calls it.
    let strip: BoardTicket['strip'] = { kind: 'none', text: m.strip.notStarted };
    if (row.mergeRequestUrl) {
      strip = { kind: 'merge_request', text: m.strip.mergeRequestOpened };
    } else if (row.runStatus === 'failed') {
      strip = { kind: 'failure', text: row.failureReason ?? m.strip.runFailed };
    } else if (row.runStatus === 'waiting_approval') {
      strip = {
        kind: 'gate',
        text: m.strip.needsApproval(gatedLabel ?? label ?? m.strip.aStep),
      };
    } else if (row.runStatus === 'running' && label) {
      strip = { kind: 'step', text: m.strip.atStep(label, index + 1, steps.length) };
    } else if (row.runStatus === 'queued') {
      strip = { kind: 'none', text: m.strip.waitingToStart };
    }

    return {
      id: row.id,
      reference: row.reference,
      title: row.title,
      status: row.status,
      repositoryId: row.repositoryId,
      repository: row.repository ?? '',
      pipelineId: row.pipelineId,
      pipeline: row.pipeline,
      createdBy: row.createdBy,
      createdByName: row.createdByName,
      mergeRequestUrl: row.mergeRequestUrl,
      hasUi: row.hasUi,
      strip,
      steps: shapes.get(row.id) as StepShape,
      gate:
        row.runStatus === 'waiting_approval' && row.runUpdatedAt
          ? { step: gatedLabel, since: row.runUpdatedAt.toISOString() }
          : null,
    };
  });
}

/**
 * What a step bar needs to know about one ticket — its current run if it has
 * one, and the pipeline version it pinned either way.
 */
export interface ShapeSource {
  ticketId: string;
  pipelineId: string | null;
  pipelineVersion: number | null;
  runId: string | null;
  runStatus: RunStatus | null;
  currentStepIndex: number | null;
  failureStepIndex: number | null;
  snapshot: PipelineSnapshot | null;
}

/**
 * Each ticket's step shape (specs/004-bento-redesign research D3).
 *
 * The steps come from the run's snapshot, which is what the run pinned; a
 * ticket that has no run yet is drawn from the pipeline VERSION it pinned,
 * never the pipeline's current one — a pipeline edited after the ticket was
 * created must not redraw it (Constitution IV). Two queries for any number of
 * tickets: one for skipped steps, one for pinned versions.
 */
export async function stepShapes(
  database: Database,
  sources: ShapeSource[],
): Promise<Map<string, StepShape>> {
  const runIds = sources.flatMap((source) => (source.runId ? [source.runId] : []));
  const skippedRows =
    runIds.length === 0
      ? []
      : await database
          .select({ runId: stepResults.runId, stepIndex: stepResults.stepIndex })
          .from(stepResults)
          .where(and(inArray(stepResults.runId, runIds), eq(stepResults.status, 'skipped')));
  const skippedByRun = new Map<string, number[]>();
  for (const row of skippedRows) {
    skippedByRun.set(row.runId, [...(skippedByRun.get(row.runId) ?? []), row.stepIndex]);
  }

  const unstarted = sources.filter((source) => !source.snapshot && source.pipelineId);
  const pipelineIds = [...new Set(unstarted.map((source) => source.pipelineId as string))];
  const versionRows =
    pipelineIds.length === 0
      ? []
      : await database
          .select({
            pipelineId: pipelineVersions.pipelineId,
            version: pipelineVersions.version,
            steps: pipelineVersions.steps,
          })
          .from(pipelineVersions)
          .where(inArray(pipelineVersions.pipelineId, pipelineIds));
  const pinned = new Map(versionRows.map((row) => [`${row.pipelineId}@${row.version}`, row.steps]));

  const shapes = new Map<string, StepShape>();
  for (const source of sources) {
    const steps =
      source.snapshot?.pipeline.steps ??
      pinned.get(`${source.pipelineId}@${source.pipelineVersion}`) ??
      [];
    shapes.set(
      source.ticketId,
      shapeOf({
        steps,
        runStatus: source.snapshot ? source.runStatus : null,
        currentStepIndex: source.currentStepIndex,
        failureStepIndex: source.failureStepIndex,
        skipped: source.runId ? skippedByRun.get(source.runId) : [],
      }),
    );
  }
  return shapes;
}

/** Position in the queue when the concurrency ceiling is full (FR-082). */
/**
 * Delegated, so there is one answer to "where am I in the queue" rather than
 * two that disagree (FR-082).
 */
export async function queuePosition(database: Database, runId: string): Promise<number | null> {
  const { positionOf } = await import('./queue');
  return positionOf(database, runId);
}

/**
 * A screen's image bytes, for the route that serves them (FR-077). Only a
 * screen: a document is text and goes through a query like everything else.
 */
export async function screenBytes(
  database: Database,
  artifactId: string,
): Promise<{ bytes: Uint8Array; contentType: string; filename: string } | null> {
  const [row] = await database
    .select({ path: artifacts.path, kind: artifacts.kind, bytes: artifacts.bytes })
    .from(artifacts)
    .where(eq(artifacts.id, artifactId))
    .limit(1);
  if (row?.kind !== 'screen' || !row.bytes) return null;

  const filename = row.path.split('/').pop() ?? 'screen.png';
  return { bytes: row.bytes, contentType: contentTypeFor(filename), filename };
}

function contentTypeFor(filename: string): string {
  const extension = filename.toLowerCase().split('.').pop();
  switch (extension) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'webp':
      return 'image/webp';
    default:
      return 'image/png';
  }
}
