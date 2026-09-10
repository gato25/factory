import { timingSafeEqual } from 'node:crypto';
import type { Database } from '@factory/db';
import { logChunks, runs, tickets } from '@factory/db/schema';
import {
  type Callback,
  createLogger,
  createRedactor,
  notAuthorised,
  type PipelineSnapshot,
} from '@factory/shared';
import { eq } from 'drizzle-orm';
import { addCost, captureArtifacts, recordStep } from '$lib/ledger/record';
import { notifyApprovers, notifyDashboard, notifyRun, type RunEvent } from './notify';
import { setRunStatus } from './run';
import { setTicketStatus } from './ticket';

const log = createLogger('web');

/**
 * Applying a callback. Every event is idempotent on (run_id, step_index): a
 * repeat must not create a second step record and must not advance the run
 * twice (FR-095).
 */

/**
 * Authentication deliberately gives the same answer for an unknown run and a
 * wrong secret, so a caller cannot learn whether a run exists
 * (contracts/orchestrator.md §3).
 */
export async function authenticateCallback(
  database: Database,
  runId: string,
  presented: string,
): Promise<{ snapshot: PipelineSnapshot }> {
  const [run] = await database.select().from(runs).where(eq(runs.id, runId)).limit(1);
  const expected = (run?.snapshot as PipelineSnapshot | undefined)?.resume_secret ?? '';
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  const ok = expected.length > 0 && a.length === b.length && timingSafeEqual(a, b);
  if (!run || !ok) throw notAuthorised('unauthorised');
  return { snapshot: run.snapshot as PipelineSnapshot };
}

export async function applyCallback(
  database: Database,
  callback: Callback,
): Promise<{ applied: boolean }> {
  const { run_id: runId, step_index: stepIndex } = callback;

  switch (callback.event) {
    case 'started': {
      await database
        .update(runs)
        .set({ containerId: callback.container_id, updatedAt: new Date() })
        .where(eq(runs.id, runId));
      await setRunStatus(database, runId, 'running');
      await mirrorTicket(database, runId, 'running');
      await announce(database, runId, { event: 'run_changed' });
      return { applied: true };
    }

    case 'step_started': {
      const { applied } = await recordStep(database, { runId, stepIndex, status: 'running' });
      if (applied) {
        await setRunStatus(database, runId, 'running', { currentStepIndex: stepIndex });
        await announce(database, runId, { event: 'step_changed', stepIndex });
      }
      return { applied };
    }

    case 'step_finished': {
      const { applied } = await recordStep(database, {
        runId,
        stepIndex,
        status: callback.status,
        durationS: callback.duration_s,
        costUsd: callback.cost_usd,
        engineSessionId: callback.engine_session_id,
        summary: callback.summary,
      });
      // Cost is added ONLY when this call recorded the outcome, so a duplicate
      // cannot charge twice (FR-095, SC-006).
      if (applied) {
        await addCost(database, runId, callback.cost_usd);
        await captureArtifacts(database, runId, stepIndex, callback.artifacts);
        await announce(database, runId, { event: 'step_changed', stepIndex });
        for (const artifact of callback.artifacts) {
          await notifyRun(database, runId, {
            event: 'artifact_added',
            stepIndex,
            path: artifact.path,
          });
        }
      } else {
        log.info('ignored a duplicate step_finished', { run_id: runId, step_index: stepIndex });
      }
      return { applied };
    }

    case 'step_skipped': {
      // A skipped step never fails the run; it continues (FR-110, FR-111).
      const { applied } = await recordStep(database, {
        runId,
        stepIndex,
        status: 'skipped',
        conditionNotMet: callback.condition_not_met,
      });
      if (applied) await announce(database, runId, { event: 'step_changed', stepIndex });
      return { applied };
    }

    case 'ticket_classified': {
      const run = await runFor(database, runId);
      await database
        .update(tickets)
        .set({
          hasUi: callback.has_ui,
          uiRationale: callback.rationale,
          classificationMissing: false,
          updatedAt: new Date(),
        })
        .where(eq(tickets.id, run.ticketId));
      await announce(database, runId, { event: 'run_changed' });
      return { applied: true };
    }

    case 'waiting_approval': {
      await database
        .update(runs)
        .set({
          resumeUrl: callback.resume_url,
          currentStepIndex: stepIndex,
          status: 'waiting_approval',
          updatedAt: new Date(),
        })
        .where(eq(runs.id, runId));
      await mirrorTicket(database, runId, 'waiting_approval');
      await announce(database, runId, { event: 'run_changed' });

      // The gate's configured approvers are told it is waiting (FR-058).
      const run = await runFor(database, runId);
      const snapshot = run.snapshot as PipelineSnapshot;
      const step = snapshot.pipeline.steps[stepIndex];
      const [ticket] = await database
        .select()
        .from(tickets)
        .where(eq(tickets.id, run.ticketId))
        .limit(1);
      if (ticket) {
        await notifyApprovers(database, {
          runId,
          stepIndex,
          ticketReference: ticket.reference,
          ticketTitle: ticket.title,
          gateLabel: step?.type === 'checkpoint' ? 'checkpoint' : null,
          url: `/tickets/${ticket.id}/approve`,
          approvers: step?.approvers ?? 'anyone',
          ticketCreatedBy: ticket.createdBy,
        });
      }
      return { applied: true };
    }

    case 'log_chunk': {
      // Redacted at ingest, never at display (Principle V).
      const run = await runFor(database, runId);
      const snapshot = run.snapshot as PipelineSnapshot;
      const redact = createRedactor([snapshot.resume_secret]);
      await database
        .insert(logChunks)
        .values({
          runId,
          stepIndex,
          seq: callback.seq,
          stream: callback.stream,
          text: redact(callback.text),
        })
        .onConflictDoNothing({
          target: [logChunks.runId, logChunks.stepIndex, logChunks.seq],
        });
      // Log chunks ride the stream as payloads rather than signals (D4).
      await notifyRun(database, runId, {
        event: 'log_chunk',
        stepIndex,
        seq: callback.seq,
        stream: callback.stream,
        text: redact(callback.text),
      });
      return { applied: true };
    }

    case 'mr_opened': {
      const run = await runFor(database, runId);
      await database
        .update(tickets)
        .set({ mergeRequestUrl: callback.merge_request_url, updatedAt: new Date() })
        .where(eq(tickets.id, run.ticketId));
      await setRunStatus(database, runId, 'opening_mr');
      await announce(database, runId, { event: 'run_changed' });
      return { applied: true };
    }

    case 'done': {
      const run = await runFor(database, runId);
      if (run.status === 'done') return { applied: false };
      await setRunStatus(database, runId, 'done');
      await database
        .update(tickets)
        .set({
          status: 'done',
          mergeRequestUrl: callback.merge_request_url,
          updatedAt: new Date(),
        })
        .where(eq(tickets.id, run.ticketId));
      await announce(database, runId, { event: 'finished', status: 'done' });
      return { applied: true };
    }

    case 'failed': {
      const run = await runFor(database, runId);
      if (run.status === 'failed') return { applied: false };
      await setRunStatus(database, runId, 'failed', {
        failureReason: callback.reason,
        failureStepIndex: callback.step_index,
      });
      await mirrorTicket(database, runId, 'failed');
      await announce(database, runId, { event: 'finished', status: 'failed' });
      return { applied: true };
    }

    case 'cancelled': {
      const run = await runFor(database, runId);
      if (run.status === 'cancelled') return { applied: false };
      await setRunStatus(database, runId, 'cancelled');
      await mirrorTicket(database, runId, 'cancelled');
      await announce(database, runId, { event: 'finished', status: 'cancelled' });
      return { applied: true };
    }
  }
}

/** A change reaches the run's own viewers and the dashboard (FR-072, FR-074). */
async function announce(database: Database, runId: string, message: RunEvent) {
  await notifyRun(database, runId, message);
  await notifyDashboard(database, message);
}

async function runFor(database: Database, runId: string) {
  const [run] = await database.select().from(runs).where(eq(runs.id, runId)).limit(1);
  if (!run) throw notAuthorised('unauthorised');
  return run;
}

/** A ticket's status mirrors its current run's status (spec §6). */
async function mirrorTicket(
  database: Database,
  runId: string,
  status: 'running' | 'waiting_approval' | 'failed' | 'cancelled',
) {
  const run = await runFor(database, runId);
  await setTicketStatus(database, run.ticketId, status);
}
