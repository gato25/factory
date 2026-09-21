import type { Database } from '@factory/db';
import { pipelines, pipelineVersions, repositories, runs, tickets } from '@factory/db/schema';
import { conflict, invalidInput, notFound, type Step } from '@factory/shared';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { SessionUser } from './auth';
import { requireOwnerOrAdmin } from './authz';
import { assertSavable, conditionWords, problemsWith } from './pipeline-validate';
import { m } from '$lib/i18n';

/**
 * A pipeline is an ordered list of steps held as data (FR-024). Nothing here
 * knows what a specification or a plan is, and no order is fixed by the
 * machinery — that is what lets one generic workflow serve every pipeline
 * (Constitution Principle III).
 *
 * Opening the merge request is NOT in the list: it is implicit and always
 * last, so it cannot be moved or removed (FR-029).
 */

export const STEP_KINDS = ['agent', 'design', 'checkpoint', 'shell', 'notify'] as const;

/**
 * The words `design.pen`'s palette uses, so the screen and the code agree.
 * They come from the catalogue, which is where the artboard's copy lives.
 */
export const STEP_KIND_LABEL: Record<(typeof STEP_KINDS)[number], string> = {
  agent: m.stepKind.agent,
  design: m.stepKind.design,
  checkpoint: m.stepKind.checkpoint,
  shell: m.stepKind.shell,
  notify: m.stepKind.notify,
};

/** What each kind is for, and the icon the design gives it. */
export const STEP_KIND_DETAIL: Record<
  (typeof STEP_KINDS)[number],
  { description: string; icon: string }
> = {
  checkpoint: { description: m.stepKind.checkpointDetail, icon: 'hand' },
  design: { description: m.stepKind.designDetail, icon: 'palette' },
  agent: { description: m.stepKind.agentDetail, icon: 'bot' },
  shell: { description: m.stepKind.shellDetail, icon: 'terminal' },
  notify: { description: m.stepKind.notifyDetail, icon: 'bell' },
};

/** The order the design's palette lists them in. */
export const PALETTE_ORDER = ['checkpoint', 'design', 'agent', 'shell', 'notify'] as const;

/** The implicit final step, shown but never editable (FR-029). */
export const IMPLICIT_LAST_STEP = {
  label: m.stepKind.implicitLast,
  why: m.stepKind.implicitLastWhy,
};

export interface PipelineDetail {
  id: string;
  name: string;
  description: string | null;
  ownerId: string | null;
  currentVersion: number;
  steps: Step[];
  /** How many repositories use this pipeline, before anyone changes it (FR-030). */
  repositoriesUsing: number;
  /** How many runs are executing an older version right now (SC-010). */
  runsInFlight: number;
  /** True when the viewer may change it (FR-006c). */
  mayChange: boolean;
  problems: { index: number | null; message: string }[];
  versions: { version: number; createdAt: Date; stepCount: number }[];
}

export async function getPipeline(
  database: Database,
  pipelineId: string,
  user: SessionUser | null,
): Promise<PipelineDetail> {
  const [pipeline] = await database
    .select()
    .from(pipelines)
    .where(eq(pipelines.id, pipelineId))
    .limit(1);
  if (!pipeline) throw notFound(m.error.noSuchPipeline);

  const versions = await database
    .select()
    .from(pipelineVersions)
    .where(eq(pipelineVersions.pipelineId, pipelineId))
    .orderBy(desc(pipelineVersions.version));
  const current = versions.find((row) => row.version === pipeline.currentVersion) ?? versions[0];
  const steps = (current?.steps ?? []) as Step[];

  const [usage] = await database
    .select({ count: sql<number>`count(*)::int` })
    .from(repositories)
    .where(eq(repositories.defaultPipelineId, pipelineId));

  const [inFlight] = await database
    .select({ count: sql<number>`count(*)::int` })
    .from(runs)
    .innerJoin(tickets, eq(tickets.id, runs.ticketId))
    .where(
      and(
        eq(tickets.pipelineId, pipelineId),
        inArray(runs.status, ['queued', 'running', 'waiting_approval', 'opening_mr']),
      ),
    );

  return {
    id: pipeline.id,
    name: pipeline.name,
    description: pipeline.description,
    ownerId: pipeline.ownerId,
    currentVersion: pipeline.currentVersion,
    steps,
    repositoriesUsing: usage?.count ?? 0,
    runsInFlight: inFlight?.count ?? 0,
    mayChange: Boolean(user) && (user?.role === 'admin' || pipeline.ownerId === user?.id),
    problems: problemsWith(steps),
    versions: versions.map((row) => ({
      version: row.version,
      createdAt: row.createdAt,
      stepCount: (row.steps as Step[]).length,
    })),
  };
}

export async function listPipelines(database: Database) {
  const rows = await database.select().from(pipelines).orderBy(pipelines.name);
  const usage = await database
    .select({
      pipelineId: repositories.defaultPipelineId,
      count: sql<number>`count(*)::int`,
    })
    .from(repositories)
    .groupBy(repositories.defaultPipelineId);

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    ownerId: row.ownerId,
    currentVersion: row.currentVersion,
    repositoriesUsing: usage.find((u) => u.pipelineId === row.id)?.count ?? 0,
  }));
}

/**
 * A save writes a NEW version row and advances the pipeline's pointer
 * (FR-027). The row is insert-only, so a run that pinned version 7 keeps
 * executing version 7 no matter what happens here — which is what makes
 * SC-010 true rather than merely intended (Principle IV).
 */
export async function savePipeline(
  database: Database,
  input: { pipelineId: string; name?: string; description?: string | null; steps: Step[] },
  user: SessionUser,
): Promise<{ version: number; runsUnaffected: number }> {
  const [pipeline] = await database
    .select()
    .from(pipelines)
    .where(eq(pipelines.id, input.pipelineId))
    .limit(1);
  if (!pipeline) throw notFound(m.error.noSuchPipeline);
  requireOwnerOrAdmin(user, pipeline.ownerId, 'this pipeline');

  assertSavable(input.steps);

  // Counted before the write, so the number reported is the number of runs
  // that were in flight when the edit landed.
  const [inFlight] = await database
    .select({ count: sql<number>`count(*)::int` })
    .from(runs)
    .innerJoin(tickets, eq(tickets.id, runs.ticketId))
    .where(
      and(
        eq(tickets.pipelineId, input.pipelineId),
        inArray(runs.status, ['queued', 'running', 'waiting_approval', 'opening_mr']),
      ),
    );

  const version = pipeline.currentVersion + 1;
  try {
    await database.insert(pipelineVersions).values({
      pipelineId: input.pipelineId,
      version,
      steps: normalise(input.steps),
      createdBy: user.id,
    });
  } catch (error) {
    // Drizzle wraps the driver's error, so the constraint name is on the
    // cause chain rather than in the message.
    if (flatten(error).includes('pipeline_versions_pipeline_version_key')) {
      throw conflict(
        'Someone else saved this pipeline while you were editing. Reload to see their ' +
          'version before saving yours.',
      );
    }
    throw error;
  }

  await database
    .update(pipelines)
    .set({
      currentVersion: version,
      ...(input.name === undefined ? {} : { name: input.name.trim() }),
      ...(input.description === undefined ? {} : { description: input.description }),
      updatedAt: new Date(),
    })
    .where(eq(pipelines.id, input.pipelineId));

  return { version, runsUnaffected: inFlight?.count ?? 0 };
}

/**
 * The name on its own.
 *
 * Renaming is deliberately NOT a new version: a version is what a run pins,
 * and no run's behaviour depends on what the pipeline is called. Bumping the
 * version here would make the history say something changed for runs when
 * nothing did (FR-027).
 */
export async function renamePipeline(
  database: Database,
  pipelineId: string,
  name: string,
  user: SessionUser,
): Promise<{ name: string }> {
  const trimmed = name.trim();
  if (!trimmed) throw invalidInput(m.form.pipelineName);

  const [pipeline] = await database
    .select()
    .from(pipelines)
    .where(eq(pipelines.id, pipelineId))
    .limit(1);
  if (!pipeline) throw notFound(m.error.noSuchPipeline);
  requireOwnerOrAdmin(user, pipeline.ownerId, 'this pipeline');

  await database
    .update(pipelines)
    .set({ name: trimmed, updatedAt: new Date() })
    .where(eq(pipelines.id, pipelineId));
  return { name: trimmed };
}

/** Every step carries a condition, defaulting to always (FR-032a). */
function normalise(steps: Step[]): Step[] {
  return steps.map((step) => ({ ...step, condition: step.condition ?? 'always' }));
}

/**
 * Reorder, insert between any two steps, and remove (FR-026). Held here as
 * pure functions on the list so the builder and the remote functions agree,
 * and so the edits are testable without a database.
 */

export function moveStep(steps: Step[], from: number, to: number): Step[] {
  if (from < 0 || from >= steps.length) throw invalidInput(m.conflicts.noSuchStepToMove);
  const target = Math.max(0, Math.min(steps.length - 1, to));
  const next = [...steps];
  const [moved] = next.splice(from, 1);
  if (!moved) throw invalidInput(m.conflicts.noSuchStepToMove);
  next.splice(target, 0, moved);
  return next;
}

/** `at` is the position the new step takes; `steps.length` appends. */
export function insertStep(steps: Step[], at: number, step: Step): Step[] {
  const target = Math.max(0, Math.min(steps.length, at));
  const next = [...steps];
  // A step always carries a condition; the caller's wins if it gave one.
  next.splice(target, 0, { ...step, condition: step.condition ?? 'always' });
  return next;
}

export function removeStep(steps: Step[], at: number): Step[] {
  if (at < 0 || at >= steps.length) throw invalidInput(m.conflicts.noSuchStepToRemove);
  return steps.filter((_, index) => index !== at);
}

/** A blank step of each kind, so the palette inserts something valid-shaped. */
export function blankStep(kind: (typeof STEP_KINDS)[number]): Step {
  switch (kind) {
    case 'agent':
      return { type: 'agent', condition: 'always', output_files: [] };
    case 'design':
      return { type: 'design', condition: 'ticket_has_ui' };
    case 'checkpoint':
      return { type: 'checkpoint', condition: 'always', approvers: 'anyone', on_timeout: 'wait' };
    case 'shell':
      return { type: 'shell', condition: 'always', command: '' };
    case 'notify':
      return { type: 'notify', condition: 'always', channel: '', template: '' };
  }
}

/**
 * Duplicating a pipeline (FR-031). The copy belongs to whoever made it and
 * starts at version 1: it is a new pipeline, not a branch of the old one, so
 * nothing that runs the original is affected by editing the copy.
 */
export async function duplicatePipeline(
  database: Database,
  pipelineId: string,
  user: SessionUser,
): Promise<{ id: string; name: string }> {
  const [source] = await database
    .select()
    .from(pipelines)
    .where(eq(pipelines.id, pipelineId))
    .limit(1);
  if (!source) throw notFound(m.error.noSuchPipeline);

  const versions = await database
    .select()
    .from(pipelineVersions)
    .where(eq(pipelineVersions.pipelineId, pipelineId))
    .orderBy(desc(pipelineVersions.version));
  const current = versions.find((row) => row.version === source.currentVersion) ?? versions[0];

  const [copy] = await database
    .insert(pipelines)
    .values({
      name: nextCopyName(source.name),
      description: source.description,
      ownerId: user.id,
      currentVersion: 1,
    })
    .returning();
  if (!copy) throw conflict(m.conflicts.couldNotDuplicatePipeline);

  await database.insert(pipelineVersions).values({
    pipelineId: copy.id,
    version: 1,
    steps: (current?.steps ?? []) as Step[],
    createdBy: user.id,
  });

  return { id: copy.id, name: copy.name };
}

/** The constraint name lives on the cause chain, not the message. */
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

function nextCopyName(name: string): string {
  const base = name.replace(/ \(copy(?: \d+)?\)$/, '');
  return `${base} (copy)`;
}

/** A new, empty pipeline someone can build in. */
export async function createPipeline(
  database: Database,
  input: { name: string; description?: string },
  user: SessionUser,
): Promise<{ id: string }> {
  const name = input.name.trim();
  if (!name) throw invalidInput(m.form.pipelineName);

  const [created] = await database
    .insert(pipelines)
    .values({
      name,
      description: input.description ?? null,
      ownerId: user.id,
      currentVersion: 1,
    })
    .returning();
  if (!created) throw conflict(m.conflicts.couldNotCreatePipeline);

  // Version 1 is empty on purpose: a save is what validates, and refusing to
  // create an empty pipeline would leave nowhere to build one.
  await database.insert(pipelineVersions).values({
    pipelineId: created.id,
    version: 1,
    steps: [],
    createdBy: user.id,
  });
  return { id: created.id };
}

/** What the builder shows beside a conditional step, in words (FR-032f). */
export { conditionWords };
