import type { Database } from '@factory/db';
import {
  artifacts,
  logChunks,
  pipelines,
  repositories,
  runs,
  stepResults,
  tickets,
  users,
  workspaces,
} from '@factory/db/schema';
import { notFound, type PipelineSnapshot, type Step } from '@factory/shared';
import { and, count, desc, eq, gte, inArray, sql } from 'drizzle-orm';

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
  repository: { fullPath: string; provider: string; defaultBranch: string };
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

const CONDITION_TEXT: Record<Step['condition'], string | undefined> = {
  always: undefined,
  ticket_has_ui: 'only if this ticket changes the interface',
  ticket_has_no_ui: 'only if this ticket does not change the interface',
};

export async function runView(database: Database, runId: string): Promise<RunView> {
  const [run] = await database.select().from(runs).where(eq(runs.id, runId)).limit(1);
  if (!run) throw notFound('no such run');

  const [ticket] = await database
    .select()
    .from(tickets)
    .where(eq(tickets.id, run.ticketId))
    .limit(1);
  if (!ticket) throw notFound('that run has no ticket');

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
  if (!row) throw notFound('no such artifact');
  return row;
}

/** The four dashboard tiles (FR-071). */
export async function dashboardTiles(database: Database) {
  const weekAgo = new Date(Date.now() - 7 * 24 * 3_600_000);
  const [connected] = await database
    .select({ n: count() })
    .from(repositories)
    .where(eq(repositories.status, 'connected'));
  const [running] = await database
    .select({ n: count() })
    .from(tickets)
    .where(inArray(tickets.status, ['queued', 'running']));
  const [awaiting] = await database
    .select({ n: count() })
    .from(tickets)
    .where(eq(tickets.status, 'waiting_approval'));
  const [merged] = await database
    .select({ n: count() })
    .from(tickets)
    .where(and(eq(tickets.status, 'done'), gte(tickets.updatedAt, weekAgo)));
  return {
    repositoriesConnected: connected?.n ?? 0,
    ticketsRunning: running?.n ?? 0,
    awaitingApproval: awaiting?.n ?? 0,
    mergeRequestsThisWeek: merged?.n ?? 0,
  };
}

/** Every active run, with its progress through the pipeline (FR-072). */
export async function activeRuns(database: Database) {
  const rows = await database
    .select({
      runId: runs.id,
      status: runs.status,
      currentStepIndex: runs.currentStepIndex,
      costUsd: runs.costUsd,
      snapshot: runs.snapshot,
      ticketId: tickets.id,
      reference: tickets.reference,
      title: tickets.title,
      ticketStatus: tickets.status,
      repository: repositories.fullPath,
    })
    .from(runs)
    .innerJoin(tickets, eq(tickets.id, runs.ticketId))
    .leftJoin(repositories, eq(repositories.id, tickets.repositoryId))
    .where(inArray(runs.status, ['queued', 'running', 'waiting_approval', 'opening_mr']))
    .orderBy(desc(runs.createdAt));

  return rows.map((row) => {
    const snapshot = row.snapshot as PipelineSnapshot;
    return {
      runId: row.runId,
      ticketId: row.ticketId,
      reference: row.reference,
      title: row.title,
      repository: row.repository ?? '',
      pipeline: snapshot.pipeline.name,
      status: row.status,
      costUsd: row.costUsd,
      stepCount: snapshot.pipeline.steps.length,
      currentStepIndex: row.currentStepIndex,
      stepLabels: snapshot.pipeline.steps.map(
        (step) => snapshot.agents.find((a) => a.id === step.agent_id)?.name ?? labelFor(step.type),
      ),
    };
  });
}

/**
 * The activity feed, derived from the rows that already record what happened
 * rather than duplicated into a table of its own (FR-073).
 */
export async function recentActivity(database: Database, limit = 20) {
  const rows = await database
    .select({
      runId: runs.id,
      status: runs.status,
      finishedAt: runs.finishedAt,
      createdAt: runs.createdAt,
      failureReason: runs.failureReason,
      attempt: runs.attempt,
      reference: tickets.reference,
      title: tickets.title,
      ticketId: tickets.id,
      mergeRequestUrl: tickets.mergeRequestUrl,
    })
    .from(runs)
    .innerJoin(tickets, eq(tickets.id, runs.ticketId))
    .orderBy(desc(sql`coalesce(${runs.finishedAt}, ${runs.createdAt})`))
    .limit(limit);

  return rows.map((row) => ({
    runId: row.runId,
    ticketId: row.ticketId,
    reference: row.reference,
    title: row.title,
    at: row.finishedAt ?? row.createdAt,
    kind:
      row.status === 'done'
        ? ('mr_opened' as const)
        : row.status === 'failed'
          ? ('run_failed' as const)
          : row.status === 'waiting_approval'
            ? ('gate_reached' as const)
            : row.status === 'cancelled'
              ? ('run_cancelled' as const)
              : ('ticket_created' as const),
    detail: row.status === 'failed' ? row.failureReason : row.mergeRequestUrl,
    attempt: row.attempt,
  }));
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
}

export async function board(database: Database): Promise<BoardTicket[]> {
  const rows = await database
    .select({
      id: tickets.id,
      reference: tickets.reference,
      title: tickets.title,
      status: tickets.status,
      repositoryId: tickets.repositoryId,
      repository: repositories.fullPath,
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
      failureReason: runs.failureReason,
      snapshot: runs.snapshot,
    })
    .from(tickets)
    .leftJoin(repositories, eq(repositories.id, tickets.repositoryId))
    .leftJoin(pipelines, eq(pipelines.id, tickets.pipelineId))
    .leftJoin(users, eq(users.id, tickets.createdBy))
    .leftJoin(runs, eq(runs.id, tickets.currentRunId))
    .orderBy(desc(tickets.createdAt));

  return rows.map((row) => {
    const snapshot = row.snapshot as PipelineSnapshot | null;
    const steps = snapshot?.pipeline.steps ?? [];
    const index = row.currentStepIndex ?? 0;
    const label =
      snapshot?.agents.find((a) => a.id === steps[index]?.agent_id)?.name ??
      (steps[index] ? labelFor(steps[index].type) : null);

    let strip: BoardTicket['strip'] = { kind: 'none', text: 'Not started' };
    if (row.mergeRequestUrl) {
      strip = { kind: 'merge_request', text: 'Merge request opened' };
    } else if (row.runStatus === 'failed') {
      strip = { kind: 'failure', text: row.failureReason ?? 'The run failed' };
    } else if (row.runStatus === 'waiting_approval') {
      strip = { kind: 'gate', text: `${label ?? 'A step'} needs your approval` };
    } else if (row.runStatus === 'running' && label) {
      strip = { kind: 'step', text: `${label} · step ${index + 1} of ${steps.length}` };
    } else if (row.runStatus === 'queued') {
      strip = { kind: 'none', text: 'Waiting to start' };
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
    };
  });
}

/** Position in the queue when the concurrency ceiling is full (FR-082). */
export async function queuePosition(database: Database, runId: string): Promise<number | null> {
  const [workspace] = await database.select().from(workspaces).limit(1);
  const cap = workspace?.maxConcurrentRuns ?? 6;
  const queued = await database
    .select({ id: runs.id })
    .from(runs)
    .where(inArray(runs.status, ['queued', 'running', 'opening_mr']))
    .orderBy(runs.createdAt);
  const index = queued.findIndex((r) => r.id === runId);
  if (index < 0 || index < cap) return null;
  return index - cap + 1;
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
