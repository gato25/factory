import type { Database } from '@factory/db';
import { logChunks, runs, tickets } from '@factory/db/schema';
import {
  type Callback,
  createLogger,
  createRedactor,
  FactoryError,
  notAuthorised,
  type PipelineSnapshot,
} from '@factory/shared';
import { eq } from 'drizzle-orm';
import { addCost, captureArtifacts, recordStep } from '$lib/ledger/record';
import { matches } from '$lib/secrets/store';
import { notifyApprovers, notifyDashboard, notifyRun, type RunEvent } from './notify';
import { markCredentialExpired } from './repository';
import { setRunStatus } from './run';
import {
  classifyingStepIndex,
  noteMissingClassification,
  recordClassification,
  setTicketStatus,
} from './ticket';

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
  // One constant-time comparison in the codebase, not one per call site: a
  // second implementation is a second chance to write `===` by accident.
  const ok = expected.length > 0 && matches(presented, expected);
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
      // The run has started, so "not started yet: the orchestrator could not
      // be reached" — recorded when the trigger's answer was late or wrong —
      // is no longer true, and was left standing over a running run.
      await database
        .update(runs)
        .set({ containerId: callback.container_id, failureReason: null, updatedAt: new Date() })
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
      // Named, not swallowed. The first version of the workflow posted this
      // event with none of these fields, the insert failed on a null status,
      // and the orchestrator was told `internal error` — which said nothing
      // about which side was wrong or what was missing.
      const missing = [
        callback.status === 'done' || callback.status === 'failed' ? null : 'status',
        typeof callback.cost_usd === 'string' ? null : 'cost_usd',
        Array.isArray(callback.artifacts) ? null : 'artifacts',
      ].filter((field): field is string => field !== null);
      if (missing.length > 0) {
        throw new FactoryError(
          'invalid_input',
          `a step_finished callback needs ${missing.join(', ')} — the orchestrator posted none`,
        );
      }
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
        // The step that was expected to classify has now finished. If no
        // usable decision arrived, that absence becomes a field rather than
        // a line in step output, and the run carries on (FR-102).
        await noteClassificationIfMissing(database, runId, stepIndex, callback.status);
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
      await recordClassification(database, run.ticketId, {
        hasUi: callback.has_ui,
        rationale: callback.rationale,
      });
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

    /**
     * A pause took effect: the step that was running concluded and nothing
     * further began (FR-096). The resume address is stored so continuing does
     * not depend on holding the execution in memory.
     */
    case 'paused': {
      await database
        .update(runs)
        .set({
          resumeUrl: callback.resume_url,
          currentStepIndex: stepIndex,
          updatedAt: new Date(),
        })
        .where(eq(runs.id, runId));
      await announce(database, runId, { event: 'run_changed' });
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
      // The STEP is recorded as failed too, carrying the engine's own words.
      // Without this the run knows it failed but nothing knows where, so the
      // step tracker cannot point at it and the reason has no detail to
      // stand behind it (FR-087).
      await recordStep(database, {
        runId,
        stepIndex: callback.step_index,
        status: 'failed',
        errorDetail: callback.detail ?? callback.reason,
      });
      await setRunStatus(database, runId, 'failed', {
        failureReason: callback.reason,
        failureStepIndex: callback.step_index,
      });
      await mirrorTicket(database, runId, 'failed');

      // A rejected credential is the repository's problem, not this run's:
      // every future run against it will fail the same way until somebody
      // replaces the token. Recording it on the repository is what stops new
      // runs and puts the fix in front of an administrator (FR-013). Nothing
      // set this status before, so the screen could show it and never did.
      if (callback.reason === 'credential_invalid') {
        const [ticket] = await database
          .select({ repositoryId: tickets.repositoryId })
          .from(tickets)
          .where(eq(tickets.id, run.ticketId))
          .limit(1);
        if (ticket) {
          await markCredentialExpired(
            database,
            ticket.repositoryId,
            callback.detail ??
              'A run could not authenticate with this repository. Replace the access token.',
          );
        }
      }

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

/**
 * FR-102 — the specification step finished without a usable decision. The
 * ticket is left with `has_ui` null, because "could not tell" is not the same
 * claim as "decided no", and the warning is what the difference is for.
 *
 * Only the step expected to classify is judged: a later document-producing
 * step finding no classification says nothing new.
 */
async function noteClassificationIfMissing(
  database: Database,
  runId: string,
  stepIndex: number,
  status: 'done' | 'failed',
) {
  if (status !== 'done') return;
  const run = await runFor(database, runId);
  const snapshot = run.snapshot as PipelineSnapshot;
  if (classifyingStepIndex(snapshot.pipeline.steps) !== stepIndex) return;

  const { noted } = await noteMissingClassification(database, run.ticketId);
  if (noted) {
    log.warn('the specification step produced no usable classification', {
      run_id: runId,
      step_index: stepIndex,
    });
  }
}
