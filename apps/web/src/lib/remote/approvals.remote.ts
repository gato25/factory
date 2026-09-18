import { FactoryError, type GateDecision, notAuthorised } from '@factory/shared';
import * as v from 'valibot';
import { form, getRequestEvent, query } from '$app/server';
import { db } from '$lib/db';
import { formIndex } from '$lib/forms';
import { editArtifact } from '$lib/services/artifact';
import { canDecide } from '$lib/services/authz';
import { decide, designReview, gateDetail } from '$lib/services/gate';
import { artifactContent } from '$lib/services/run-view';

/**
 * A form per decision, so a submission does not depend on JavaScript
 * (contracts/ui-data.md). The screen itself still needs it to render — see
 * the divergence recorded in spec.md. Thin: validate, check authorisation,
 * call a service.
 */

function requireUser() {
  const user = getRequestEvent().locals.user;
  if (!user) throw notAuthorised('та нэвтэрсэн байх ёстой');
  return user;
}

/** What a decision form gives back: what happened, or why it did not. */
interface Outcome {
  decided?: GateDecision;
  version?: number;
  problem?: string;
}

/**
 * A decision can be refused for a reason the person has to read — someone
 * decided first, or the gate is not theirs. That is returned rather than
 * thrown, so the screen says so instead of failing silently.
 */
async function attempt(work: () => Promise<Outcome>): Promise<Outcome> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof FactoryError) return { problem: error.message };
    throw error;
  }
}

const GateArgs = v.object({
  runId: v.pipe(v.string(), v.uuid()),
  // A hidden input sends this as a string; the schema has to accept one.
  stepIndex: formIndex('Энэ бол уг ажиллагааны алхам биш байна.'),
});

export const gate = query(GateArgs, async ({ runId, stepIndex }) => {
  const user = requireUser();
  const detail = await gateDetail(db(), runId, stepIndex);
  return {
    ...detail,
    // Anyone may read; only the gate's approvers may act (FR-064). The
    // predicate travels with the data so the screen shows the object without
    // its actions rather than erroring after the fact.
    mayDecide: canDecide(user, detail.gate.approvers, detail.gate.ticketCreatedBy),
  };
});

/**
 * A gate that follows a design step (FR-064d, FR-064e). Same authorisation as
 * any gate: anyone may look, only an approver may decide.
 */
export const design = query(GateArgs, async ({ runId, stepIndex }) => {
  const user = requireUser();
  const detail = await designReview(db(), runId, stepIndex);
  return {
    ...detail,
    mayDecide: canDecide(user, detail.gate.approvers, detail.gate.ticketCreatedBy),
  };
});

export const document = query(v.pipe(v.string(), v.uuid()), async (artifactId) => {
  requireUser();
  const row = await artifactContent(db(), artifactId);
  return { id: row.id, path: row.path, version: row.version, content: row.content };
});

export const approve = form(GateArgs, async ({ runId, stepIndex }) => {
  const user = requireUser();
  return attempt(async () => {
    await decide(db(), { runId, stepIndex, decision: 'approved' }, user);
    await gate({ runId, stepIndex }).refresh();
    return { decided: 'approved' as const };
  });
});

export const requestChanges = form(
  v.object({
    ...GateArgs.entries,
    feedback: v.pipe(
      v.string(),
      v.trim(),
      v.minLength(1, 'Юу өөрчлөгдөхийг бичнэ үү — агент энэ тэмдэглэлийг уншина.'),
    ),
  }),
  async ({ runId, stepIndex, feedback }) => {
    const user = requireUser();
    return attempt(async () => {
      await decide(db(), { runId, stepIndex, decision: 'changes_requested', feedback }, user);
      await gate({ runId, stepIndex }).refresh();
      return { decided: 'changes_requested' as const };
    });
  },
);

/** Editing writes a new version, then continues as approved (FR-062). */
export const editAndApprove = form(
  v.object({
    ...GateArgs.entries,
    path: v.pipe(v.string(), v.minLength(1)),
    content: v.pipe(v.string(), v.minLength(1, 'Баримтыг хоосолж болохгүй.')),
  }),
  async ({ runId, stepIndex, path, content }) => {
    const user = requireUser();
    return attempt(async () => {
      const edited = await editArtifact(db(), runId, path, content, user);
      await decide(db(), { runId, stepIndex, decision: 'edited', editedPaths: [path] }, user);
      await gate({ runId, stepIndex }).refresh();
      return { decided: 'edited' as const, version: edited.version };
    });
  },
);

export const cancelRun = form(GateArgs, async ({ runId, stepIndex }) => {
  const user = requireUser();
  return attempt(async () => {
    await decide(db(), { runId, stepIndex, decision: 'cancelled' }, user);
    await gate({ runId, stepIndex }).refresh();
    return { decided: 'cancelled' as const };
  });
});
