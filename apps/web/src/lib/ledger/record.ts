import type { Database } from '@factory/db';
import { artifacts, runs, stepResults } from '@factory/db/schema';
import type { ArtifactRef } from '@factory/shared';
import { eq, sql } from 'drizzle-orm';

/**
 * Recording a step and adding its cost. The unique key on
 * (run_id, step_index) is the idempotency guarantee: a repeated callback is a
 * no-op rather than a second row or a double charge (FR-095).
 */

export interface StepRecord {
  runId: string;
  stepIndex: number;
  status: 'running' | 'done' | 'failed' | 'skipped';
  durationS?: number;
  costUsd?: string;
  engineSessionId?: string;
  summary?: string;
  conditionNotMet?: string;
  errorDetail?: string;
}

/**
 * Returns whether this call was the one that recorded the outcome. A caller
 * must only add cost, advance the run, or fan out an event when it is `true`.
 */
export async function recordStep(
  database: Database,
  record: StepRecord,
): Promise<{ applied: boolean }> {
  const inserted = await database
    .insert(stepResults)
    .values({
      runId: record.runId,
      stepIndex: record.stepIndex,
      status: record.status,
      durationS: record.durationS,
      costUsd: record.costUsd ?? '0.0000',
      engineSessionId: record.engineSessionId,
      summary: record.summary,
      conditionNotMet: record.conditionNotMet,
      errorDetail: record.errorDetail,
      startedAt: record.status === 'running' ? new Date() : undefined,
      finishedAt: record.status === 'running' ? undefined : new Date(),
    })
    .onConflictDoNothing({ target: [stepResults.runId, stepResults.stepIndex] })
    .returning({ id: stepResults.id });

  if (inserted.length > 0) return { applied: true };

  // A step already recorded as `running` may legitimately finish once. Any
  // other repeat — including a second finish — is the duplicate FR-095 drops.
  if (record.status === 'running') return { applied: false };

  const promoted = await database
    .update(stepResults)
    .set({
      status: record.status,
      durationS: record.durationS,
      costUsd: record.costUsd ?? '0.0000',
      engineSessionId: record.engineSessionId,
      summary: record.summary,
      conditionNotMet: record.conditionNotMet,
      errorDetail: record.errorDetail,
      finishedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(sql`${stepResults.runId} = ${record.runId}::uuid
      and ${stepResults.stepIndex} = ${record.stepIndex}
      and ${stepResults.status} = 'running'`)
    .returning({ id: stepResults.id });

  return { applied: promoted.length > 0 };
}

/**
 * Cost is added to the run only when the step outcome was actually applied,
 * so a duplicate callback cannot charge twice. Arithmetic stays in the
 * database on a numeric column, never in floating point (SC-006).
 */
export async function addCost(database: Database, runId: string, costUsd: string) {
  if (costUsd === '0.0000') return;
  await database
    .update(runs)
    .set({ costUsd: sql`${runs.costUsd} + ${costUsd}::numeric`, updatedAt: new Date() })
    .where(eq(runs.id, runId));
}

/** T069 — artifacts are additive: a new version, never an overwrite (FR-054). */
export async function captureArtifacts(
  database: Database,
  runId: string,
  stepIndex: number,
  refs: ArtifactRef[],
  contents: Record<string, string> = {},
) {
  for (const ref of refs) {
    const existing = await database
      .select({ version: artifacts.version })
      .from(artifacts)
      .where(sql`${artifacts.runId} = ${runId}::uuid and ${artifacts.path} = ${ref.path}`);
    const nextVersion = existing.reduce((max, row) => Math.max(max, row.version), 0) + 1;
    await database
      .insert(artifacts)
      .values({
        runId,
        stepIndex,
        kind: ref.kind,
        path: ref.path,
        version: nextVersion,
        screenName: ref.screen_name,
        content: contents[ref.path],
      })
      .onConflictDoNothing({
        target: [artifacts.runId, artifacts.path, artifacts.version],
      });
  }
}
