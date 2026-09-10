import { afterAll, beforeEach, expect, test } from 'bun:test';
import { approvals, artifacts, runs, tickets } from '@factory/db/schema';
import type { Callback, ResumeRequest } from '@factory/shared';
import { eq } from 'drizzle-orm';
import { editArtifact } from '../../src/lib/services/artifact';
import { applyCallback } from '../../src/lib/services/callbacks';
import { decide, gateDetail } from '../../src/lib/services/gate';
import { startRun } from '../../src/lib/services/run';
import { connect, type Scenario, seed, withCheckpoint } from '../fixtures';

/** contracts/orchestrator.md §4 — the resume hand-off, all four decisions. */

const { db, sql: raw } = connect();
let scenario: Scenario;
let runId: string;
let sent: { url: string; body: ResumeRequest }[] = [];

const approver = { id: '', name: 'Bat', email: 'bat@netgroup.mn', role: 'member' as const };
const resume = async (url: string, body: ResumeRequest) => {
  sent.push({ url, body });
  return { ok: true };
};

beforeEach(async () => {
  sent = [];
  scenario = await seed(db, { steps: withCheckpoint('anyone') });
  approver.id = scenario.userId;
  const started = await startRun(db, {
    ticketId: scenario.ticketId,
    callbackBaseUrl: 'https://factory.example',
  });
  runId = started.run.id;

  // The specification step finishes, then the gate is reached and the
  // orchestrator hands over its resume address (FR-056).
  await applyCallback(db, {
    run_id: runId,
    attempt: 1,
    step_index: 0,
    event: 'step_finished',
    status: 'done',
    duration_s: 5,
    cost_usd: '0.2000',
    artifacts: [{ kind: 'document', path: 'docs/spec.md', version: 1 }],
  } as Callback);
  await db
    .update(artifacts)
    .set({ content: '# Spec\n\nOriginal text.' })
    .where(eq(artifacts.runId, runId));
  await applyCallback(db, {
    run_id: runId,
    attempt: 1,
    step_index: 1,
    event: 'waiting_approval',
    resume_url: 'https://n8n.example/resume/abc',
    approvers: [],
  } as Callback);
});
afterAll(async () => {
  await raw.end();
});

test('reaching a gate pauses BOTH the run and the ticket (FR-057)', async () => {
  const [run] = await db.select().from(runs).where(eq(runs.id, runId)).limit(1);
  const [ticket] = await db
    .select()
    .from(tickets)
    .where(eq(tickets.id, scenario.ticketId))
    .limit(1);
  expect(run?.status).toBe('waiting_approval');
  expect(ticket?.status).toBe('waiting_approval');
  // The resume address is stored, so the gate stays drivable if the
  // orchestrator execution is lost (research.md risk 2).
  expect(run?.resumeUrl).toBe('https://n8n.example/resume/abc');
});

test('approve continues at the next step', async () => {
  await decide(db, { runId, stepIndex: 1, decision: 'approved' }, approver, { resume });
  expect(sent).toHaveLength(1);
  expect(sent[0]?.url).toBe('https://n8n.example/resume/abc');
  expect(sent[0]?.body).toEqual({ decision: 'approved' });
  const [run] = await db.select().from(runs).where(eq(runs.id, runId)).limit(1);
  expect(run?.status).toBe('running');
});

test('request changes carries the feedback the agent will read', async () => {
  await decide(
    db,
    {
      runId,
      stepIndex: 1,
      decision: 'changes_requested',
      feedback: 'The plan misses the callback screen.',
    },
    approver,
    { resume },
  );
  expect(sent[0]?.body.decision).toBe('changes_requested');
  expect(sent[0]?.body.feedback).toBe('The plan misses the callback screen.');
});

test('request changes without feedback is refused — the feedback IS the payload', async () => {
  await expect(
    decide(db, { runId, stepIndex: 1, decision: 'changes_requested', feedback: '  ' }, approver, {
      resume,
    }),
  ).rejects.toThrow(/Say what should change/);
  expect(sent).toHaveLength(0);
});

test('edit writes a new version and names the edited path on resume (FR-062)', async () => {
  const edited = await editArtifact(
    db,
    runId,
    'docs/spec.md',
    '# Spec\n\nRewritten by a human.',
    approver,
  );
  expect(edited.version).toBe(2);

  await decide(
    db,
    { runId, stepIndex: 1, decision: 'edited', editedPaths: ['docs/spec.md'] },
    approver,
    { resume },
  );
  expect(sent[0]?.body).toEqual({ decision: 'edited', edited_paths: ['docs/spec.md'] });

  // The previous version is retained (FR-054), and the new one is what a
  // later step reads.
  const versions = await db.select().from(artifacts).where(eq(artifacts.runId, runId));
  expect(versions.map((a) => a.version).sort()).toEqual([1, 2]);
  const latest = versions.find((a) => a.version === 2);
  expect(latest?.content).toContain('Rewritten by a human');
  expect(latest?.createdBy).toBe(approver.id);
});

test('cancel releases the run and leaves the branch alone (FR-097)', async () => {
  await decide(db, { runId, stepIndex: 1, decision: 'cancelled' }, approver, { resume });
  expect(sent[0]?.body).toEqual({ decision: 'cancelled' });
  const [run] = await db.select().from(runs).where(eq(runs.id, runId)).limit(1);
  const [ticket] = await db
    .select()
    .from(tickets)
    .where(eq(tickets.id, scenario.ticketId))
    .limit(1);
  expect(run?.status).toBe('cancelled');
  expect(ticket?.status).toBe('cancelled');
  // The branch name survives — the code pushed so far is not discarded.
  expect(ticket?.branchName).toBe('factory/142-add-google-oauth-sign-in');
});

test('every decision records who, what, any feedback, and when (FR-063)', async () => {
  await decide(
    db,
    { runId, stepIndex: 1, decision: 'changes_requested', feedback: 'Needs the empty state.' },
    approver,
    { resume },
  );
  const [record] = await db.select().from(approvals).where(eq(approvals.runId, runId)).limit(1);
  expect(record?.decidedBy).toBe(approver.id);
  expect(record?.decision).toBe('changes_requested');
  expect(record?.feedback).toBe('Needs the empty state.');
  expect(record?.decidedAt).toBeInstanceOf(Date);
  expect(record?.timedOut).toBe(false);
});

test('the gate names the step a change request will re-run (FR-061)', async () => {
  const detail = await gateDetail(db, runId, 1);
  expect(detail.gate.precedingStepIndex).toBe(0);
  expect(detail.gate.precedingLabel).toBe('Spec');
  expect(detail.gate.precedingIsDesign).toBe(false);
});

test('a decision still records when no resume address is stored', async () => {
  await db.update(runs).set({ resumeUrl: null }).where(eq(runs.id, runId));
  await decide(db, { runId, stepIndex: 1, decision: 'approved' }, approver, { resume });
  expect(sent).toHaveLength(0);
  const [record] = await db.select().from(approvals).where(eq(approvals.runId, runId)).limit(1);
  expect(record?.decision).toBe('approved');
});
