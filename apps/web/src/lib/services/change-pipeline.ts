import type { Database } from '@factory/db';
import { artifacts, pipelines, runs, stepResults, tickets } from '@factory/db/schema';
import {
  conflict,
  notFound,
  type PipelineSnapshot,
  type RunFacts,
  type Step,
} from '@factory/shared';
import { desc, eq, inArray } from 'drizzle-orm';
import type { ContinuingSnapshot } from './continue';
import { cancelRunNow, startRun } from './run';
import type { ReleaseSandbox } from './sandbox';
import { m } from '$lib/i18n';

/**
 * Moving a ticket onto another pipeline — or onto a newer version of its own
 * — while it is being worked.
 *
 * A run pins its pipeline version when it starts (FR-027, FR-044), and a
 * retry reuses that pin, so nothing a person did to a pipeline could reach a
 * ticket already going. This is the deliberate way through: the current
 * attempt is cancelled (branch left intact, FR-097), the ticket is pinned to
 * the chosen pipeline at its CURRENT version, and a new attempt starts.
 *
 * What the earlier attempts already produced is kept. The new pipeline's
 * leading steps whose every output an earlier attempt wrote — the
 * specification, the plan, the design — are carried over rather than paid
 * for again: their documents are copied onto the new run, so a gate and the
 * merge request read them exactly as if this run had written them, and the
 * run picks up at the first step that still has work. It takes the branch,
 * which is where those files are.
 *
 * Carrying stops at the first step that is anything else. A checkpoint is
 * never carried — approving a plan under one pipeline is not approving it
 * under another — and neither is a shell step or the step that writes code.
 */

export interface ChangePipelineInput {
  ticketId: string;
  pipelineId: string;
  callbackBaseUrl: string;
  releaseSandbox?: ReleaseSandbox;
}

type Artifact = typeof artifacts.$inferSelect;

export async function changePipeline(database: Database, input: ChangePipelineInput) {
  const [ticket] = await database
    .select()
    .from(tickets)
    .where(eq(tickets.id, input.ticketId))
    .limit(1);
  if (!ticket) throw notFound(m.error.noSuchTicket);

  const [pipeline] = await database
    .select({ id: pipelines.id, version: pipelines.currentVersion })
    .from(pipelines)
    .where(eq(pipelines.id, input.pipelineId))
    .limit(1);
  if (!pipeline) throw notFound(m.error.pipelineDoesNotExist);

  const attempts = await database
    .select({ id: runs.id, attempt: runs.attempt, status: runs.status })
    .from(runs)
    .where(eq(runs.ticketId, ticket.id))
    .orderBy(desc(runs.attempt));
  const latest = attempts[0];
  if (latest?.status === 'done' || latest?.status === 'opening_mr') {
    throw conflict(m.changePipeline.finished(ticket.reference));
  }
  if (latest && ['queued', 'running', 'waiting_approval'].includes(latest.status)) {
    await cancelRunNow(database, latest.id, { releaseSandbox: input.releaseSandbox });
  }

  // What every earlier attempt produced, newest first: the latest attempt's
  // highest version of each path is the one that stands.
  const produced = new Map<string, Artifact>();
  if (attempts.length > 0) {
    const rows = await database
      .select()
      .from(artifacts)
      .where(
        inArray(
          artifacts.runId,
          attempts.map((a) => a.id),
        ),
      );
    const order = new Map(attempts.map((a) => [a.id, a.attempt]));
    rows
      .filter((row) => row.kind !== 'commits')
      .sort(
        (a, b) => (order.get(b.runId) ?? 0) - (order.get(a.runId) ?? 0) || b.version - a.version,
      )
      .forEach((row) => {
        if (!produced.has(row.path)) produced.set(row.path, row);
      });
  }

  await database
    .update(tickets)
    .set({ pipelineId: pipeline.id, pipelineVersion: pipeline.version, updatedAt: new Date() })
    .where(eq(tickets.id, ticket.id));

  const { run, snapshot } = await startRun(database, {
    ticketId: ticket.id,
    callbackBaseUrl: input.callbackBaseUrl,
  });

  const carried = carryOver(snapshot.pipeline.steps, produced, ticket.hasUi);
  if (carried.length === 0) return { run, snapshot, carried: [] as string[] };

  const now = new Date();
  const from = latest?.attempt ?? 0;
  for (const step of carried) {
    if (step.outputs.length > 0) {
      await database.insert(artifacts).values(
        step.outputs.map((artifact) => ({
          runId: run.id,
          stepIndex: step.index,
          kind: artifact.kind,
          path: artifact.path,
          version: 1,
          content: artifact.content,
          bytes: artifact.bytes,
          screenName: artifact.screenName,
          createdBy: artifact.createdBy,
        })),
      );
    }
    await database.insert(stepResults).values({
      runId: run.id,
      stepIndex: step.index,
      status: step.skipped ? 'skipped' : 'done',
      conditionNotMet: step.skipped ? m.changePipeline.noInterface : null,
      summary: step.skipped ? null : m.changePipeline.carriedFrom(from),
      startedAt: now,
      finishedAt: now,
      durationS: 0,
    });
  }

  const facts: RunFacts = ticket.hasUi === null ? {} : { hasUi: ticket.hasUi };
  const continuing: ContinuingSnapshot = {
    ...(snapshot as PipelineSnapshot),
    resume: { index: carried.length, facts, spent_usd: 0 },
  };
  return {
    run,
    snapshot: continuing,
    carried: carried.map((step) => step.name(snapshot)),
  };
}

interface Carried {
  index: number;
  outputs: Artifact[];
  /** A design step on a ticket that changes no interface: skipped, not carried. */
  skipped: boolean;
  name: (snapshot: PipelineSnapshot) => string;
}

/** The leading steps whose work is already on the branch. Exported for its tests. */
export function carryOver(
  steps: Step[],
  produced: ReadonlyMap<string, Artifact>,
  hasUi: boolean | null,
): Carried[] {
  const carried: Carried[] = [];
  for (const [index, step] of steps.entries()) {
    const name = (snapshot: PipelineSnapshot) =>
      snapshot.agents.find((agent) => agent.id === step.agent_id)?.name ?? step.type;

    if (step.type === 'agent' && (step.output_files?.length ?? 0) > 0) {
      const outputs = (step.output_files ?? []).map((path) => produced.get(path));
      if (outputs.some((artifact) => !artifact)) break;
      carried.push({ index, outputs: outputs as Artifact[], skipped: false, name });
      continue;
    }

    if (step.type === 'design') {
      if (hasUi === false && step.condition === 'ticket_has_ui') {
        carried.push({ index, outputs: [], skipped: true, name });
        continue;
      }
      const source = step.design?.source_path ?? 'docs/design/ui.pen';
      const screens = `${step.design?.export_dir ?? 'docs/design/screens'}/`;
      const design = produced.get(source);
      if (!design) break;
      const outputs = [design, ...[...produced.values()].filter((a) => a.path.startsWith(screens))];
      carried.push({ index, outputs, skipped: false, name });
      continue;
    }

    break;
  }
  return carried;
}
