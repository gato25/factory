import { afterAll, beforeAll, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import { createClient } from '../src/client';
import {
  approvals,
  pipelines,
  pipelineVersions,
  repositories,
  runs,
  stepResults,
  tickets,
  users,
} from '../src/schema/index';

/**
 * Proves the invariants in data-model.md are enforced by the database rather
 * than by application logic (T021). Runs against a real Postgres, not a fake
 * (research.md D9).
 */
/** Drizzle builders are lazy thenables that bun's expect().rejects will not
 *  accept, and Drizzle wraps the driver error — the constraint name lives on
 *  the cause chain — so failures are captured and flattened explicitly. */
async function rejectsWith(run: () => Promise<unknown>, pattern: RegExp) {
  let text = '';
  try {
    await run();
  } catch (error) {
    const parts: string[] = [];
    let current: unknown = error;
    while (current instanceof Error) {
      parts.push(current.message);
      const detail = (current as { detail?: string }).detail;
      const constraint = (current as { constraint_name?: string }).constraint_name;
      if (detail) parts.push(detail);
      if (constraint) parts.push(constraint);
      current = current.cause;
    }
    text = parts.join(' | ');
  }
  expect(text).toMatch(pattern);
}

function first<T>(rows: T[], what: string): T {
  const row = rows[0];
  if (!row) throw new Error(`expected one ${what}`);
  return row;
}

const { db, sql: raw } = createClient();
let userId: string;
let repoId: string;
let ticketId: string;
let runId: string;

const snapshot = {
  run_id: 'r',
  attempt: 1,
  ticket: { reference: '#1', title: 't', description: null, acceptance_criteria: [] },
  repo: {
    clone_url: 'x',
    default_branch: 'main',
    branch: 'b',
    provider: 'github' as const,
    credential_ref: 'c',
  },
  pipeline: { id: 'p', version: 1, name: 'Standard', steps: [] },
  limits: { cost_ceiling_usd: '5.0000', time_ceiling_minutes: 45 },
  agents: [],
  callback_url: 'http://localhost/cb',
  resume_secret: 's',
};

beforeAll(async () => {
  await db.execute(sql`truncate table ${approvals}, ${stepResults}, ${runs}, ${tickets},
    ${pipelineVersions}, ${pipelines}, ${repositories}, ${users} cascade`);
  const inserted = await db
    .insert(users)
    .values({ name: 'A', email: `a${Date.now()}@x.dev` })
    .returning();
  userId = first(inserted, 'user').id;
  const r = await db
    .insert(repositories)
    .values({ name: 'shop', fullPath: 'n/shop', provider: 'github', cloneUrl: 'https://x' })
    .returning();
  repoId = first(r, 'repository').id;
  const t = await db
    .insert(tickets)
    .values({ repositoryId: repoId, createdBy: userId, reference: '#1', title: 'Add OAuth' })
    .returning();
  ticketId = first(t, 'ticket').id;
  const run = await db
    .insert(runs)
    .values({
      ticketId,
      attempt: 1,
      snapshot,
      status: 'running',
      costCeilingUsd: '5.0000',
      timeCeilingMinutes: 45,
    })
    .returning();
  runId = first(run, 'run').id;
});

afterAll(async () => {
  await raw.end();
});

test('at most one active run per ticket (FR-020)', async () => {
  await rejectsWith(
    () =>
      db.insert(runs).values({
        ticketId,
        attempt: 2,
        snapshot,
        status: 'queued',
        costCeilingUsd: '5.0000',
        timeCeilingMinutes: 45,
      }),
    /runs_one_active_per_ticket/,
  );
});

test('a terminal run frees the ticket for a retry (FR-088)', async () => {
  await db.execute(sql`update ${runs} set status = 'failed' where id = ${runId}::uuid`);
  const [retry] = await db
    .insert(runs)
    .values({
      ticketId,
      attempt: 2,
      snapshot,
      status: 'queued',
      costCeilingUsd: '5.0000',
      timeCeilingMinutes: 45,
    })
    .returning();
  expect(retry?.attempt).toBe(2);
  await db.execute(sql`delete from ${runs} where attempt = 2`);
  await db.execute(sql`update ${runs} set status = 'running' where id = ${runId}::uuid`);
});

test('attempts are sequential per ticket (FR-045)', async () => {
  await rejectsWith(
    () =>
      db.insert(runs).values({
        ticketId,
        attempt: 1,
        snapshot,
        status: 'failed',
        costCeilingUsd: '5.0000',
        timeCeilingMinutes: 45,
      }),
    /runs_ticket_attempt_key/,
  );
});

test('a repeated callback cannot create a second step result (FR-095)', async () => {
  await db.insert(stepResults).values({ runId, stepIndex: 0, status: 'done' });
  await rejectsWith(
    () => db.insert(stepResults).values({ runId, stepIndex: 0, status: 'done' }),
    /step_results_run_step_key/,
  );
});

test('skipped is a distinct terminal outcome, not a kind of done (FR-112)', async () => {
  const [skipped] = await db
    .insert(stepResults)
    .values({
      runId,
      stepIndex: 1,
      status: 'skipped',
      conditionNotMet: 'ticket has no UI change',
    })
    .returning();
  expect(skipped?.status).toBe('skipped');
  expect(skipped?.conditionNotMet).toBe('ticket has no UI change');
});

test('one decision per gate; the second decider is refused (FR-064a)', async () => {
  await db
    .insert(approvals)
    .values({ runId, stepIndex: 2, decision: 'approved', decidedBy: userId });
  await rejectsWith(
    () =>
      db
        .insert(approvals)
        .values({ runId, stepIndex: 2, decision: 'changes_requested', decidedBy: userId }),
    /approvals_run_step_key/,
  );
});

test('only two git providers exist (FR-014a, FR-014b)', async () => {
  await rejectsWith(
    () =>
      db.execute(
        sql`insert into ${repositories} (name, full_path, provider, clone_url)
            values ('x', 'n/x', 'self_hosted', 'https://x')`,
      ),
    /git_provider/,
  );
});

test('cost is exact, not floating point (SC-006)', async () => {
  await db.execute(sql`update ${runs} set cost_usd = '0.1000' where id = ${runId}::uuid`);
  for (let i = 0; i < 3; i++) {
    await db.execute(
      sql`update ${runs} set cost_usd = cost_usd + '0.1000' where id = ${runId}::uuid`,
    );
  }
  const [row] = await db.execute<{ cost_usd: string }>(
    sql`select cost_usd from ${runs} where id = ${runId}::uuid`,
  );
  expect(row?.cost_usd).toBe('0.4000');
});
