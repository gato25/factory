import type { Database } from '@factory/db';
import { approvals, artifacts, runs, stepResults, tickets } from '@factory/db/schema';
import {
  type ApproverRule,
  conflict,
  createLogger,
  type GateDecision,
  invalidInput,
  notFound,
  type PipelineSnapshot,
  type ResumeRequest,
  type Step,
} from '@factory/shared';
import { and, desc, eq, sql } from 'drizzle-orm';
import { currentVersion } from './artifact';
import type { SessionUser } from './auth';
import { requireApprover } from './authz';
import { notifyRun } from './notify';
import { setRunStatus } from './run';
import { setTicketStatus } from './ticket';

const log = createLogger('web');

/**
 * A gate pauses a run until a human decides (FR-056). Four decisions, no more:
 * approve and continue, edit a document and continue, request changes with
 * feedback, or cancel (FR-060).
 */

export interface GateView {
  runId: string;
  stepIndex: number;
  approvers: ApproverRule;
  timeoutHours: number | null;
  onTimeout: 'wait' | 'continue' | 'fail';
  /** The step the gate follows — what a change request re-runs (FR-061). */
  precedingStepIndex: number | null;
  precedingLabel: string | null;
  /** True when the preceding step is a design step (FR-061a). */
  precedingIsDesign: boolean;
  ticketId: string;
  ticketCreatedBy: string;
  decided: { by: string | null; decision: GateDecision; at: Date } | null;
}

export interface ResumeDeps {
  /** Injected so the decision flow is testable without an orchestrator. */
  resume?: (url: string, body: ResumeRequest) => Promise<{ ok: boolean; detail?: string }>;
}

export async function gateView(
  database: Database,
  runId: string,
  stepIndex: number,
): Promise<GateView> {
  const [run] = await database.select().from(runs).where(eq(runs.id, runId)).limit(1);
  if (!run) throw notFound('тийм ажиллагаа алга');
  const snapshot = run.snapshot as PipelineSnapshot;
  const step = snapshot.pipeline.steps[stepIndex];
  if (step?.type !== 'checkpoint') {
    throw invalidInput(`энэ ажиллагааны ${stepIndex + 1}-р алхам хяналтын цэг биш байна`);
  }

  const [ticket] = await database
    .select()
    .from(tickets)
    .where(eq(tickets.id, run.ticketId))
    .limit(1);
  if (!ticket) throw notFound('тэр ажиллагаанд даалгавар алга');

  const [existing] = await database
    .select()
    .from(approvals)
    .where(and(eq(approvals.runId, runId), eq(approvals.stepIndex, stepIndex)))
    .limit(1);

  // The nearest preceding step that actually runs work — a change request
  // re-runs that one, not the gate itself (FR-061).
  const preceding = findPreceding(snapshot.pipeline.steps, stepIndex);

  return {
    runId,
    stepIndex,
    approvers: step.approvers ?? 'anyone',
    timeoutHours: step.timeout_hours ?? null,
    onTimeout: step.on_timeout ?? 'wait',
    precedingStepIndex: preceding?.index ?? null,
    precedingLabel: preceding
      ? (snapshot.agents.find((a) => a.id === preceding.step.agent_id)?.name ?? preceding.step.type)
      : null,
    precedingIsDesign: preceding?.step.type === 'design',
    ticketId: ticket.id,
    ticketCreatedBy: ticket.createdBy,
    decided: existing
      ? { by: existing.decidedBy, decision: existing.decision, at: existing.decidedAt }
      : null,
  };
}

function findPreceding(steps: Step[], stepIndex: number) {
  for (let i = stepIndex - 1; i >= 0; i--) {
    const step = steps[i] as Step;
    if (step.type === 'agent' || step.type === 'design' || step.type === 'shell') {
      return { index: i, step };
    }
  }
  return null;
}

export interface DecideInput {
  runId: string;
  stepIndex: number;
  decision: GateDecision;
  feedback?: string;
  /** Paths the human rewrote before approving (FR-062). */
  editedPaths?: string[];
}

/**
 * Records the decision and drives the run onward. The unique key on
 * (run_id, step_index) means the SECOND decider's insert fails, so
 * one-decision-per-gate is a database guarantee rather than a race (FR-064a).
 */
export async function decide(
  database: Database,
  input: DecideInput,
  user: SessionUser,
  deps: ResumeDeps = {},
): Promise<{ decision: GateDecision }> {
  const gate = await gateView(database, input.runId, input.stepIndex);

  // Only the gate's configured approvers may decide (FR-064).
  requireApprover(user, gate.approvers, gate.ticketCreatedBy);

  if (input.decision === 'changes_requested' && !input.feedback?.trim()) {
    throw invalidInput('Юу өөрчлөгдөхийг бичнэ үү — агент энэ тэмдэглэлийг уншина.');
  }

  try {
    await database.insert(approvals).values({
      runId: input.runId,
      stepIndex: input.stepIndex,
      decidedBy: user.id,
      decision: input.decision,
      feedback: input.feedback?.trim() || null,
    });
  } catch (error) {
    if (flatten(error).includes('approvals_run_step_key')) {
      const who = gate.decided?.by === user.id ? 'You have' : 'Someone has';
      throw conflict(`${who} энэ хяналтын цэгийг аль хэдийн шийдсэн байна.`);
    }
    throw error;
  }

  // A change request sends the run BACK: the preceding step will run again
  // and report again. Its existing outcome is what `(run_id, step_index)`
  // idempotency would reject that report as a duplicate of, so the rows from
  // that step onward are cleared first (FR-061, FR-095).
  //
  // Nothing is lost that the run needs: the money already spent stays on the
  // run's total, every document and screen keeps both versions (FR-054), and
  // the change request itself is on the record with its feedback (FR-063).
  if (input.decision === 'changes_requested' && gate.precedingStepIndex !== null) {
    await database.delete(stepResults).where(
      sql`${stepResults.runId} = ${input.runId}::uuid
          and ${stepResults.stepIndex} >= ${gate.precedingStepIndex}`,
    );
  }

  const [run] = await database.select().from(runs).where(eq(runs.id, input.runId)).limit(1);
  const resumeUrl = run?.resumeUrl ?? null;

  // Cancelling releases the sandbox and leaves the branch intact (FR-097).
  if (input.decision === 'cancelled') {
    await setRunStatus(database, input.runId, 'cancelled');
    await setTicketStatus(database, gate.ticketId, 'cancelled');
  } else {
    await setRunStatus(database, input.runId, 'running');
    await setTicketStatus(database, gate.ticketId, 'running');
  }
  await notifyRun(database, input.runId, { event: 'run_changed' });

  if (!resumeUrl) {
    // The decision is recorded either way; the run can be driven once the
    // orchestrator reports in again (research.md risk 2).
    log.warn('decided a gate with no resume address stored', {
      run_id: input.runId,
      step_index: input.stepIndex,
    });
    return { decision: input.decision };
  }

  /**
   * The edited documents themselves, not only their names.
   *
   * An edit is a new artifact version here; the workspace the next step reads
   * is on the execution service's disk, and nothing carried the text across.
   * So the paths arrived and the edit was ignored (FR-062).
   */
  const editedDocuments: Record<string, string> = {};
  for (const path of input.editedPaths ?? []) {
    const version = await currentVersion(database, input.runId, path);
    if (version?.content !== null && version?.content !== undefined) {
      editedDocuments[path] = version.content;
    }
  }

  const body: ResumeRequest = {
    decision: input.decision,
    feedback: input.feedback?.trim() || undefined,
    edited_paths: input.editedPaths?.length ? input.editedPaths : undefined,
    ...(Object.keys(editedDocuments).length > 0 ? { edited_documents: editedDocuments } : {}),
  };
  const send = deps.resume ?? defaultResume;
  const result = await send(resumeUrl, body);
  if (!result.ok) {
    log.error('could not resume the run', {
      run_id: input.runId,
      detail: result.detail ?? 'unknown',
    });
  }
  return { decision: input.decision };
}

async function defaultResume(url: string, body: ResumeRequest) {
  try {
    const response = await fetch(url, {
      method: 'POST',
      // The resume address is a route on the execution service, which
      // authenticates every operation with its own credential (FR-011).
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${process.env.RUNNER_AUTH_TOKEN ?? ''}`,
      },
      body: JSON.stringify(body),
    });
    return { ok: response.ok, detail: response.ok ? undefined : `answered ${response.status}` };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * A gate's expiry behaviour: wait indefinitely, continue, or fail (FR-064b).
 * Whichever happens is recorded, marked as having happened without a human.
 */
export async function applyTimeout(
  database: Database,
  runId: string,
  stepIndex: number,
  deps: ResumeDeps = {},
): Promise<{ action: 'wait' | 'continue' | 'fail' }> {
  const gate = await gateView(database, runId, stepIndex);
  if (gate.decided) return { action: 'wait' };
  if (gate.onTimeout === 'wait') return { action: 'wait' };

  const decision: GateDecision = gate.onTimeout === 'continue' ? 'approved' : 'cancelled';
  await database
    .insert(approvals)
    .values({ runId, stepIndex, decidedBy: null, decision, timedOut: true })
    .onConflictDoNothing({ target: [approvals.runId, approvals.stepIndex] });

  if (gate.onTimeout === 'continue') {
    await setRunStatus(database, runId, 'running');
    await setTicketStatus(database, gate.ticketId, 'running');
    const [run] = await database.select().from(runs).where(eq(runs.id, runId)).limit(1);
    if (run?.resumeUrl) {
      await (deps.resume ?? defaultResume)(run.resumeUrl, { decision: 'approved' });
    }
  } else {
    await setRunStatus(database, runId, 'failed', {
      failureReason: `nobody decided the checkpoint within ${gate.timeoutHours} hours`,
      failureStepIndex: stepIndex,
    });
    await setTicketStatus(database, gate.ticketId, 'failed');
  }
  await notifyRun(database, runId, { event: 'run_changed' });
  return { action: gate.onTimeout };
}

/**
 * Everything the checkpoint screen shows: the gate, every document and screen
 * produced so far, and a chronological record of the run (FR-064c).
 */
export interface GateDetail {
  gate: GateView;
  ticket: {
    id: string;
    reference: string;
    title: string;
    acceptanceCriteria: string[];
    hasUi: boolean | null;
    uiRationale: string | null;
    /** FR-102's warning: no usable decision ever arrived. */
    classificationMissing: boolean;
  };
  artifacts: {
    id: string;
    kind: string;
    path: string;
    version: number;
    screenName: string | null;
    editedByHuman: boolean;
  }[];
  timeline: {
    at: Date;
    kind: 'step' | 'decision';
    label: string;
    detail: string | null;
  }[];
}

export async function gateDetail(
  database: Database,
  runId: string,
  stepIndex: number,
): Promise<GateDetail> {
  const gate = await gateView(database, runId, stepIndex);
  const [run] = await database.select().from(runs).where(eq(runs.id, runId)).limit(1);
  if (!run) throw notFound('тийм ажиллагаа алга');
  const snapshot = run.snapshot as PipelineSnapshot;
  const [ticket] = await database
    .select()
    .from(tickets)
    .where(eq(tickets.id, gate.ticketId))
    .limit(1);
  if (!ticket) throw notFound('тэр ажиллагаанд даалгавар алга');

  // Latest version per path, so a human's edit is what is shown (FR-062).
  const rows = await database
    .select()
    .from(artifacts)
    .where(eq(artifacts.runId, runId))
    .orderBy(artifacts.path, desc(artifacts.version));
  const latest = new Map<string, (typeof rows)[number]>();
  for (const row of rows) if (!latest.has(row.path)) latest.set(row.path, row);

  const steps = await database
    .select()
    .from(stepResults)
    .where(eq(stepResults.runId, runId))
    .orderBy(stepResults.stepIndex);
  const decisions = await database
    .select()
    .from(approvals)
    .where(eq(approvals.runId, runId))
    .orderBy(approvals.decidedAt);

  const timeline: GateDetail['timeline'] = [
    ...steps.map((step) => {
      const definition = snapshot.pipeline.steps[step.stepIndex];
      const label =
        snapshot.agents.find((a) => a.id === definition?.agent_id)?.name ??
        definition?.type ??
        `step ${step.stepIndex + 1}`;
      return {
        at: step.finishedAt ?? step.startedAt ?? step.createdAt,
        kind: 'step' as const,
        label: `${label} ${step.status}`,
        detail:
          step.status === 'skipped'
            ? `skipped — ${step.conditionNotMet}`
            : (step.errorDetail ?? step.summary ?? null),
      };
    }),
    ...decisions.map((decision) => ({
      at: decision.decidedAt,
      kind: 'decision' as const,
      label: decision.timedOut
        ? `checkpoint ${decision.decision} on timeout`
        : `checkpoint ${decision.decision}`,
      detail: decision.feedback,
    })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime());

  return {
    gate,
    ticket: {
      id: ticket.id,
      reference: ticket.reference,
      title: ticket.title,
      acceptanceCriteria: ticket.acceptanceCriteria,
      hasUi: ticket.hasUi,
      uiRationale: ticket.uiRationale,
      classificationMissing: ticket.classificationMissing,
    },
    artifacts: [...latest.values()].map((row) => ({
      id: row.id,
      kind: row.kind,
      path: row.path,
      version: row.version,
      screenName: row.screenName,
      editedByHuman: row.createdBy !== null,
    })),
    timeline,
  };
}

/** Gates whose waiting time has expired, for whatever drives the timeouts. */
export async function expiredGates(database: Database) {
  const paused = await database.select().from(runs).where(eq(runs.status, 'waiting_approval'));
  const due: { runId: string; stepIndex: number }[] = [];
  for (const run of paused) {
    const stepIndex = run.currentStepIndex ?? 0;
    const snapshot = run.snapshot as PipelineSnapshot;
    const step = snapshot.pipeline.steps[stepIndex];
    if (step?.type !== 'checkpoint' || !step.timeout_hours) continue;
    const since = run.updatedAt.getTime();
    if (Date.now() - since >= step.timeout_hours * 3_600_000) {
      due.push({ runId: run.id, stepIndex });
    }
  }
  return due;
}

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

/**
 * A gate that follows a design step is a design review (FR-064d). It shows
 * the screens, the acceptance criteria beside them, why the ticket was
 * classified as interface work, and that no code has been written yet — and
 * it offers a link that opens the committed design source in the design
 * service (FR-064e).
 */
export interface DesignReview extends GateDetail {
  screens: {
    id: string;
    path: string;
    screenName: string | null;
    version: number;
  }[];
  designSource: { path: string; url: string | null } | null;
  /** True while no step after the design step has run. */
  noCodeYet: boolean;
}

export async function designReview(
  database: Database,
  runId: string,
  stepIndex: number,
): Promise<DesignReview> {
  const detail = await gateDetail(database, runId, stepIndex);
  const [run] = await database.select().from(runs).where(eq(runs.id, runId)).limit(1);
  if (!run) throw notFound('тийм ажиллагаа алга');
  const snapshot = run.snapshot as PipelineSnapshot;

  const screens = detail.artifacts
    .filter((artifact) => artifact.kind === 'screen')
    .map(({ id, path, screenName, version }) => ({ id, path, screenName, version }));
  const source = detail.artifacts.find((artifact) => artifact.kind === 'design_file') ?? null;

  // Nothing after the design step has run yet, so no code exists. This is
  // the statement FR-064d requires, and it is a fact about the run rather
  // than a reassuring sentence: a gate reached after an implementing step
  // must not claim it.
  const wroteCode = await database
    .select({ stepIndex: stepResults.stepIndex })
    .from(stepResults)
    .where(
      sql`${stepResults.runId} = ${runId}::uuid
        and ${stepResults.stepIndex} > ${detail.gate.precedingStepIndex ?? -1}
        and ${stepResults.status} in ('done', 'failed')`,
    )
    .limit(1);

  return {
    ...detail,
    screens,
    designSource: source
      ? { path: source.path, url: designSourceUrl(snapshot, source.path) }
      : null,
    noCodeYet: wroteCode.length === 0,
  };
}

/**
 * Where the committed design source can be opened (FR-064e). The source is
 * on the branch, so the address is the provider's own view of that file —
 * which is also the only address that is right for a self-hosted design
 * service we know nothing about.
 */
export function designSourceUrl(snapshot: PipelineSnapshot, path: string): string | null {
  const base = snapshot.repo.clone_url.replace(/\.git$/, '');
  if (!/^https:\/\//.test(base)) return null;
  const branch = encodeURIComponent(snapshot.repo.branch);
  return snapshot.repo.provider === 'gitlab'
    ? `${base}/-/blob/${branch}/${path}`
    : `${base}/blob/${branch}/${path}`;
}
