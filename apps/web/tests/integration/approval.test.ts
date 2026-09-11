import { afterAll, beforeEach, expect, test } from 'bun:test';
import { approvals, users } from '@factory/db/schema';
import type { Callback, ResumeRequest } from '@factory/shared';
import { eq } from 'drizzle-orm';
import { applyCallback } from '../../src/lib/services/callbacks';
import { decide, gateView } from '../../src/lib/services/gate';
import { startRun } from '../../src/lib/services/run';
import { connect, type Scenario, seed, withCheckpoint } from '../fixtures';

/**
 * One decision per gate (FR-064a). The unique key on (run_id, step_index)
 * makes it a database guarantee, so two people deciding at once cannot both
 * win — the second insert fails and that person is told so.
 */

const { db, sql: raw } = connect();
let scenario: Scenario;
let runId: string;
let sent: ResumeRequest[] = [];

const resume = async (_url: string, body: ResumeRequest) => {
  sent.push(body);
  return { ok: true };
};

/**
 * A second member of the same workspace, so both may decide. The id can be
 * given up front, because naming someone in a gate's approver list means
 * knowing their id before the pipeline exists.
 */
async function secondMember(id?: string) {
  const [row] = await db
    .insert(users)
    .values({ ...(id ? { id } : {}), name: 'Saraa', email: 'saraa@netgroup.mn' })
    .returning();
  if (!row) throw new Error('no second member');
  return { id: row.id, name: row.name, email: row.email, role: 'member' as const };
}

async function pauseAtGate(steps: ReturnType<typeof withCheckpoint>) {
  scenario = await seed(db, { steps });
  const started = await startRun(db, {
    ticketId: scenario.ticketId,
    callbackBaseUrl: 'https://factory.example',
  });
  runId = started.run.id;
  await applyCallback(db, {
    run_id: runId,
    attempt: 1,
    step_index: 0,
    event: 'step_finished',
    status: 'done',
    duration_s: 4,
    cost_usd: '0.2000',
    artifacts: [{ kind: 'document', path: 'docs/spec.md', version: 1 }],
  } as Callback);
  await applyCallback(db, {
    run_id: runId,
    attempt: 1,
    step_index: 1,
    event: 'waiting_approval',
    resume_url: 'https://n8n.example/resume/abc',
    approvers: [],
  } as Callback);
}

beforeEach(async () => {
  sent = [];
  await pauseAtGate(withCheckpoint('anyone'));
});
afterAll(async () => {
  await raw.end();
});

test('the second decider is told the checkpoint is already decided', async () => {
  const first = {
    id: scenario.userId,
    name: 'Bat',
    email: 'bat@netgroup.mn',
    role: 'member' as const,
  };
  const second = await secondMember();

  await decide(db, { runId, stepIndex: 1, decision: 'approved' }, first, { resume });

  let refused: Error | null = null;
  try {
    await decide(db, { runId, stepIndex: 1, decision: 'cancelled' }, second, { resume });
  } catch (error) {
    refused = error as Error;
  }

  expect(refused?.message).toBe('Someone has already decided this checkpoint.');
  // The run was resumed once, by the decision that landed.
  expect(sent).toEqual([{ decision: 'approved', feedback: undefined, edited_paths: undefined }]);

  const rows = await db.select().from(approvals).where(eq(approvals.runId, runId));
  expect(rows).toHaveLength(1);
  expect(rows[0]?.decision).toBe('approved');
  expect(rows[0]?.decidedBy).toBe(first.id);
});

test('deciding twice yourself is refused in your own words', async () => {
  const me = {
    id: scenario.userId,
    name: 'Bat',
    email: 'bat@netgroup.mn',
    role: 'member' as const,
  };
  await decide(db, { runId, stepIndex: 1, decision: 'approved' }, me, { resume });

  let refused: Error | null = null;
  try {
    await decide(db, { runId, stepIndex: 1, decision: 'approved' }, me, { resume });
  } catch (error) {
    refused = error as Error;
  }
  expect(refused?.message).toBe('You have already decided this checkpoint.');
});

test('two simultaneous decisions leave exactly one', async () => {
  const first = {
    id: scenario.userId,
    name: 'Bat',
    email: 'bat@netgroup.mn',
    role: 'member' as const,
  };
  const second = await secondMember();

  // Neither read the other's decision before writing: both saw an open gate.
  const outcomes = await Promise.allSettled([
    decide(db, { runId, stepIndex: 1, decision: 'approved' }, first, { resume }),
    decide(db, { runId, stepIndex: 1, decision: 'cancelled' }, second, { resume }),
  ]);

  const won = outcomes.filter((o) => o.status === 'fulfilled');
  const lost = outcomes.filter((o) => o.status === 'rejected');
  expect(won).toHaveLength(1);
  expect(lost).toHaveLength(1);
  expect((lost[0] as PromiseRejectedResult).reason.message).toContain(
    'already decided this checkpoint',
  );

  const rows = await db.select().from(approvals).where(eq(approvals.runId, runId));
  expect(rows).toHaveLength(1);
  // And the run went the way the winner sent it, not both ways.
  expect(sent).toHaveLength(1);
});

test('a non-approver cannot decide a gate reserved for the ticket author', async () => {
  await pauseAtGate(withCheckpoint('ticket_creator'));
  const author = {
    id: scenario.userId,
    name: 'Bat',
    email: 'bat@netgroup.mn',
    role: 'member' as const,
  };
  const other = await secondMember();

  let refused: Error | null = null;
  try {
    await decide(db, { runId, stepIndex: 1, decision: 'approved' }, other, { resume });
  } catch (error) {
    refused = error as Error;
  }
  expect(refused?.message).toBe('this checkpoint is not yours to decide');
  // Nothing was recorded, so the gate is still the author's to decide.
  expect(await db.select().from(approvals).where(eq(approvals.runId, runId))).toHaveLength(0);
  expect((await gateView(db, runId, 1)).decided).toBeNull();

  await decide(db, { runId, stepIndex: 1, decision: 'approved' }, author, { resume });
  expect((await gateView(db, runId, 1)).decided?.by).toBe(author.id);
});

test('an administrator is not an approver by virtue of being an administrator', async () => {
  await pauseAtGate(withCheckpoint('ticket_creator'));
  const admin = { ...(await secondMember()), role: 'admin' as const };

  let refused: Error | null = null;
  try {
    await decide(db, { runId, stepIndex: 1, decision: 'approved' }, admin, { resume });
  } catch (error) {
    refused = error as Error;
  }
  expect(refused?.message).toBe('this checkpoint is not yours to decide');
});

test('a named approver list admits only the people on it', async () => {
  // Seeding resets the workspace, so the invited approver is created after it
  // with the id the gate already names.
  const invitedId = crypto.randomUUID();
  await pauseAtGate(withCheckpoint([invitedId]));
  const invited = await secondMember(invitedId);
  const author = {
    id: scenario.userId,
    name: 'Bat',
    email: 'bat@netgroup.mn',
    role: 'member' as const,
  };

  let refused: Error | null = null;
  try {
    await decide(db, { runId, stepIndex: 1, decision: 'approved' }, author, { resume });
  } catch (error) {
    refused = error as Error;
  }
  // Even the ticket's author, when the gate names someone else.
  expect(refused?.message).toBe('this checkpoint is not yours to decide');

  await decide(db, { runId, stepIndex: 1, decision: 'approved' }, invited, { resume });
  expect((await gateView(db, runId, 1)).decided?.by).toBe(invited.id);
});
