import type { Database } from '@factory/db';
import { artifacts, runs, stepResults } from '@factory/db/schema';
import type { ArtifactRef, TokenUsage } from '@factory/shared';
import { eq, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

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
  /** What the engine said the step processed; absent is zero. Shown, never enforced. */
  tokens?: TokenUsage;
  engineSessionId?: string;
  summary?: string;
  conditionNotMet?: string;
  errorDetail?: string;
}

/** The most a 32-bit `integer` column holds. */
const INTEGER_MAX = 2_147_483_647;

/**
 * The four counts as the columns that hold them; zeros when the engine
 * reported none.
 *
 * Clamped to what the column can hold. A count past two billion for one step
 * is not a real one — the dollar ceiling stops a step long before — but if an
 * engine ever sent one, the insert would fail and the step's outcome, its
 * artifacts and the run's progress with it. Counts are for showing.
 */
function tokenColumns(tokens: TokenUsage | undefined) {
  const held = (count: number | undefined) => Math.min(count ?? 0, INTEGER_MAX);
  return {
    inputTokens: held(tokens?.input),
    outputTokens: held(tokens?.output),
    cacheReadTokens: held(tokens?.cache_read),
    cacheCreationTokens: held(tokens?.cache_creation),
  };
}

/**
 * The same counts, added to what the step already holds.
 *
 * A step that runs again — a change request sent the run back to it, or a
 * failed run was continued from it — starts a new pass on the SAME row, and
 * the run's dollar cost already adds the passes together (`addCost`). Its
 * tokens do too, or a run that had to redo a step would report fewer than it
 * used. The row is only promoted while it is `running`, so a pass's report
 * repeated is still dropped, never added twice.
 */
function addedTokenColumns(tokens: TokenUsage | undefined) {
  const added = (column: AnyPgColumn, count: number) =>
    sql`least(${column}::bigint + ${count}, ${INTEGER_MAX})::integer`;
  const now = tokenColumns(tokens);
  return {
    inputTokens: added(stepResults.inputTokens, now.inputTokens),
    outputTokens: added(stepResults.outputTokens, now.outputTokens),
    cacheReadTokens: added(stepResults.cacheReadTokens, now.cacheReadTokens),
    cacheCreationTokens: added(stepResults.cacheCreationTokens, now.cacheCreationTokens),
  };
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
      ...tokenColumns(record.tokens),
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
      ...addedTokenColumns(record.tokens),
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
  /**
   * The screens' bytes, base64, by path, as the execution service read them.
   *
   * Decoded here rather than stored encoded: `screenBytes` hands the column
   * straight to an `<img>`, so what goes in is a PNG or the picture does not
   * load. An image absent from this map — too large to carry, or unreadable —
   * still gets its row, because the artifact existing is true whether or not
   * its bytes made the journey.
   */
  images: Record<string, string> = {},
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
        bytes: decodeImage(images[ref.path], ref.path),
      })
      .onConflictDoNothing({
        target: [artifacts.runId, artifacts.path, artifacts.version],
      });
  }
}

/**
 * A base64 image as bytes, or undefined when there is nothing to store.
 *
 * Tolerant on purpose. What arrives here came over the wire from another
 * service, and a malformed string is a reason to keep the row without a
 * picture, not a reason to fail the callback that also carries the step's
 * cost and outcome.
 */
function decodeImage(encoded: string | undefined, path: string): Buffer | undefined {
  if (!encoded) return undefined;
  try {
    const bytes = Buffer.from(encoded, 'base64');
    return bytes.byteLength > 0 ? bytes : undefined;
  } catch {
    console.warn(`artifact ${path}: its image could not be decoded, so the row has no picture`);
    return undefined;
  }
}
