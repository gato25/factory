import type { Database } from '@factory/db';
import { stepResults } from '@factory/db/schema';
import type { PipelineSnapshot, Step, StepType } from '@factory/shared';
import { and, eq, inArray } from 'drizzle-orm';
import type { RunStatus } from '$lib/step-shape';
import { queueState } from './queue';

/**
 * What a ticket is doing right now, structured, so a screen can say it in
 * the catalogue's words and tick a running time without a refetch
 * (specs/004-bento-redesign data-model DashboardTicket.status).
 *
 * The dashboard's rows and the board's cards say the same thing about the
 * same ticket, so they read it from here rather than each deriving it — two
 * derivations would drift, and a ticket would be "waiting" in one place and
 * "running" in the other.
 */

export interface TicketState {
  kind: 'draft' | 'queued' | 'running' | 'waiting' | 'failed' | 'done' | 'cancelled';
  /**
   * The step it is on, under the name the pipeline stored — the screen says
   * a shipped default's in the catalogue's words (FR-028). For a run waiting
   * at a checkpoint, the step the checkpoint gates; for a failed one, the step
   * that failed. `null` while the merge request is being opened, and before
   * anything has started.
   */
  step: { name: string; type: StepType } | null;
  /** When the running step started, so its time can tick without a refetch. */
  since: string | null;
  /** Its place in the sandbox queue; `null` when it can start as soon as it is picked up. */
  queuePosition: number | null;
  failureReason: string | null;
  mergeRequestUrl: string | null;
}

export interface StateRow {
  ticketStatus: string;
  mergeRequestUrl: string | null;
  runId: string | null;
  runStatus: string | null;
  currentStepIndex: number | null;
  failureStepIndex: number | null;
  failureReason: string | null;
  snapshot: unknown;
}

export interface StateContext {
  positions: Map<string, number | null>;
  startedAt: Map<string, Date | null>;
}

/**
 * Everything `stateOf` needs beyond the row, for any number of rows: one pass
 * over the queue (001 FR-082 — "queued" alone says nothing a reader can act
 * on) and one query for when the running steps started. Neither is asked
 * when no row needs it.
 */
export async function stateContext(database: Database, rows: StateRow[]): Promise<StateContext> {
  const queued = rows.some((row) => row.runStatus === 'queued');
  const queue = queued ? await queueState(database) : null;
  const positions = new Map(queue?.entries.map((entry) => [entry.runId, entry.position]) ?? []);

  const runningIds = rows.flatMap((row) =>
    row.runStatus === 'running' && row.runId ? [row.runId] : [],
  );
  const started =
    runningIds.length === 0
      ? []
      : await database
          .select({
            runId: stepResults.runId,
            stepIndex: stepResults.stepIndex,
            startedAt: stepResults.startedAt,
          })
          .from(stepResults)
          .where(and(inArray(stepResults.runId, runningIds), eq(stepResults.status, 'running')));
  const startedAt = new Map(started.map((r) => [`${r.runId}:${r.stepIndex}`, r.startedAt]));

  return { positions, startedAt };
}

export function stateOf(row: StateRow, context: StateContext): TicketState {
  const snapshot = row.snapshot as PipelineSnapshot | null;
  const steps = snapshot?.pipeline.steps ?? [];
  const named = (index: number | null) => stepAt(snapshot, steps, index);
  const base: TicketState = {
    kind: 'draft',
    step: null,
    since: null,
    queuePosition: null,
    failureReason: null,
    mergeRequestUrl: null,
  };

  switch (row.runStatus as RunStatus | null) {
    case 'running': {
      const since = context.startedAt.get(`${row.runId}:${row.currentStepIndex}`);
      return {
        ...base,
        kind: 'running',
        step: named(row.currentStepIndex),
        since: since ? since.toISOString() : null,
      };
    }
    // Every step has run; what is left is the merge request itself.
    case 'opening_mr':
      return { ...base, kind: 'running' };
    case 'waiting_approval':
      return { ...base, kind: 'waiting', step: named(gatedIndex(steps, row.currentStepIndex)) };
    case 'failed':
      return {
        ...base,
        kind: 'failed',
        step: named(row.failureStepIndex ?? row.currentStepIndex),
        failureReason: row.failureReason,
      };
    case 'queued':
      return {
        ...base,
        kind: 'queued',
        queuePosition: row.runId ? (context.positions.get(row.runId) ?? null) : null,
      };
    default:
      break;
  }

  switch (row.ticketStatus) {
    case 'queued':
    case 'running':
      return { ...base, kind: 'queued' };
    case 'done':
      return { ...base, kind: 'done', mergeRequestUrl: row.mergeRequestUrl };
    case 'failed':
      return { ...base, kind: 'failed', failureReason: row.failureReason };
    case 'cancelled':
      return { ...base, kind: 'cancelled' };
    default:
      return base;
  }
}

/** A step as the pipeline names it: its agent's stored name, or what kind of step it is. */
function stepAt(
  snapshot: PipelineSnapshot | null,
  steps: Step[],
  index: number | null,
): TicketState['step'] {
  if (index === null || !steps[index]) return null;
  const step = steps[index];
  const agent = snapshot?.agents.find((a) => a.id === step.agent_id);
  return { name: agent?.name ?? step.command ?? step.type, type: step.type };
}

/**
 * A checkpoint is named by what it gates — "Төлөвлөгөө" rather than
 * "checkpoint", as the board's strip always named it: the nearest step before
 * it that did work.
 */
export function gatedIndex(steps: Step[], at: number | null): number | null {
  for (let index = (at ?? 0) - 1; index >= 0; index -= 1) {
    const type = steps[index]?.type;
    if (type !== 'checkpoint' && type !== 'notify') return index;
  }
  return at;
}
