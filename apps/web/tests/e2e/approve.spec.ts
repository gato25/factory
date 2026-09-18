import { createHmac, randomUUID } from 'node:crypto';
import type { APIRequestContext, BrowserContext } from '@playwright/test';
import { expect, test } from '@playwright/test';
import postgres from 'postgres';

/**
 * User Story 3's Independent Test (quickstart.md scenario C): a gate after the
 * planning step, one decision each. Approve continues; an edit carries the
 * edited document forward with the previous version retained; a change request
 * re-runs the preceding step with the feedback and comes back to the same gate.
 * A non-approver reads everything and decides nothing. A second decider on an
 * already-decided gate is told so (FR-064a).
 */

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/factory';
const SESSION_SECRET = process.env.SESSION_SECRET ?? '';

// Idle connections close themselves, so the pool is never explicitly
// ended: with fully-parallel runs a worker can be handed another test
// from this file after an `afterAll` already fired.
const sql = postgres(DATABASE_URL, { max: 4, idle_timeout: 2, onnotice: () => {} });

const SPEC_TEXT = '# Plan\n\nAdd a Google button to the sign-in screen.\n';

type Seeded = {
  ticketId: string;
  runId: string;
  secret: string;
  authorId: string;
  outsiderId: string;
};

/** A pipeline of plan -> checkpoint -> build, paused at the checkpoint. */
async function seed(approvers: 'anyone' | 'ticket_creator'): Promise<Seeded> {
  const secret = `e2e-${randomUUID()}`;
  const runId = randomUUID();
  const tag = randomUUID().slice(0, 8);

  await sql`insert into workspaces (name) values ('E2E') on conflict do nothing`;
  const [author] = await sql`
    insert into users (name, email, role)
    values ('Author', ${`author-${tag}@x.dev`}, 'member') returning id`;
  // An administrator on purpose: being one is not being an approver (FR-064).
  const [outsider] = await sql`
    insert into users (name, email, role)
    values ('Outsider', ${`outsider-${tag}@x.dev`}, 'admin') returning id`;
  const [credential] = await sql`
    insert into credentials (kind, ciphertext, key_version, status)
    values ('git', 'sealed', 'v1', 'valid') returning id`;
  const [repo] = await sql`
    insert into repositories (name, full_path, provider, clone_url, default_branch,
      credential_id, status)
    values ('shop', ${`netgroup/shop-${tag}`}, 'gitlab',
      'https://gitlab.com/netgroup/shop.git', 'main', ${credential!.id}, 'connected')
    returning id`;
  const [plan] = await sql`
    insert into agents (name, kind, engine, model, system_prompt, allowed_tools)
    values ('Planner', 'default', 'claude_cli', 'claude-sonnet-5', 'write the plan', '{Read,Write}')
    returning id`;
  const [build] = await sql`
    insert into agents (name, kind, engine, model, system_prompt, allowed_tools)
    values ('Builder', 'default', 'claude_cli', 'claude-opus-5', 'write the code', '{Read,Edit}')
    returning id`;
  const [pipeline] = await sql`
    insert into pipelines (name, current_version) values ('Reviewed', 1) returning id`;

  const steps = [
    { type: 'agent', condition: 'always', agent_id: plan!.id, output_files: ['docs/plan.md'] },
    { type: 'checkpoint', condition: 'always', approvers, on_timeout: 'wait' },
    { type: 'agent', condition: 'always', agent_id: build!.id, output_files: [] },
  ];
  await sql`insert into pipeline_versions (pipeline_id, version, steps)
            values (${pipeline!.id}, 1, ${sql.json(steps)})`;

  const reference = `#${Math.floor(Math.random() * 90_000) + 10_000}`;
  const [ticket] = await sql`
    insert into tickets (repository_id, created_by, reference, title, description,
      acceptance_criteria, pipeline_id, pipeline_version, status, branch_name, current_run_id)
    values (${repo!.id}, ${author!.id}, ${reference}, 'Add Google OAuth sign-in',
      'Users should sign in with Google.', ${sql.array(['A Google button appears'])},
      ${pipeline!.id}, 1, 'running', ${`factory/${tag}-oauth`}, ${runId})
    returning id`;

  const agent = (id: string, name: string, model: string, prompt: string) => ({
    id,
    name,
    engine: 'claude_cli',
    model,
    system_prompt: prompt,
    allowed_tools: ['Read', 'Write'],
    skills: [],
    limits: {},
  });

  const snapshot = {
    run_id: runId,
    attempt: 1,
    ticket: {
      reference,
      title: 'Add Google OAuth sign-in',
      description: 'Users should sign in with Google.',
      acceptance_criteria: ['A Google button appears'],
    },
    repo: {
      clone_url: 'https://gitlab.com/netgroup/shop.git',
      default_branch: 'main',
      branch: `factory/${tag}-oauth`,
      provider: 'gitlab',
      credential_ref: credential!.id,
    },
    pipeline: { id: pipeline!.id, version: 1, name: 'Reviewed', steps },
    limits: { cost_ceiling_usd: '5.0000', time_ceiling_minutes: 45 },
    agents: [
      agent(plan!.id, 'Planner', 'claude-sonnet-5', 'write the plan'),
      agent(build!.id, 'Builder', 'claude-opus-5', 'write the code'),
    ],
    callback_url: 'http://localhost:5173/api/hooks/orchestrator',
    resume_secret: secret,
  };

  await sql`insert into runs (id, ticket_id, attempt, snapshot, status, cost_ceiling_usd,
              time_ceiling_minutes)
            values (${runId}, ${ticket!.id}, 1, ${sql.json(snapshot)}, 'running', '5.0000', 45)`;

  return {
    ticketId: ticket!.id,
    runId,
    secret,
    authorId: author!.id,
    outsiderId: outsider!.id,
  };
}

/** The same signed cookie the app issues, so no password round-trip is needed. */
function sessionToken(userId: string): string {
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  const body = `${userId}.${expiresAt}`;
  const signature = createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
  return `${body}.${signature}`;
}

async function signIn(context: BrowserContext, userId: string) {
  await context.addCookies([
    {
      name: 'factory_session',
      value: sessionToken(userId),
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      secure: false,
      sameSite: 'Lax',
    },
  ]);
}

test.describe('approving before work continues', () => {
  test.skip(
    !SESSION_SECRET,
    'Needs SESSION_SECRET, to mint the same session cookie the app issues.',
  );

  /** Runs the planning step and pauses at the gate, through the real endpoint. */
  async function runToGate(request: APIRequestContext, seeded: Seeded, step = 0) {
    const post = (body: Record<string, unknown>) =>
      request.post('http://localhost:5173/api/hooks/orchestrator', {
        headers: { authorization: `Bearer ${seeded.secret}` },
        data: { run_id: seeded.runId, attempt: 1, ...body },
      });

    await post({ step_index: step, event: 'step_started' });
    const finished = await post({
      step_index: step,
      event: 'step_finished',
      status: 'done',
      duration_s: 11,
      cost_usd: '0.3000',
      artifacts: [{ kind: 'document', path: 'docs/plan.md', version: step === 0 ? 1 : 2 }],
    });
    expect(finished.ok()).toBe(true);
    // The orchestrator does not send content; the runner uploads it.
    await sql`update artifacts set content = ${SPEC_TEXT}
              where run_id = ${seeded.runId} and content is null`;
    const paused = await post({
      step_index: 1,
      event: 'waiting_approval',
      // A POST the app answers immediately: nothing is really orchestrating,
      // and the decision must be recorded whatever the resume address says.
      resume_url: 'http://localhost:5173/api/hooks/orchestrator',
      approvers: [],
    });
    expect(paused.ok()).toBe(true);
    return post;
  }

  test('approve continues at the next step (FR-060, FR-061)', async ({ page, context }) => {
    const seeded = await seed('anyone');
    await signIn(context, seeded.authorId);
    await runToGate(page.request, seeded);

    await page.goto(`/tickets/${seeded.ticketId}/approve`);

    // The banner says what is paused and after which step.
    await expect(page.getByRole('heading', { name: /Add Google OAuth sign-in/ })).toBeVisible();
    await expect(page.getByText(/paused at step 2/)).toBeVisible();
    await expect(page.getByText(/Planner finished/)).toBeVisible();
    // Every document produced so far is readable here (FR-064c).
    await page.getByRole('button', { name: /docs\/plan\.md/ }).click();
    await expect(page.getByText('Add a Google button')).toBeVisible();
    // And a chronological record of the run.
    await expect(page.getByText('Planner done')).toBeVisible();

    await page.getByRole('button', { name: 'Батлаад үргэлжлүүлэх' }).click();

    await expect(page.getByText(/Already decided:\s*approved/)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('checkpoint approved')).toBeVisible();

    // The run left the gate and the decision is on the record with who and when.
    const [run] = await sql`select status from runs where id = ${seeded.runId}`;
    expect(run!.status).toBe('running');
    const [decision] = await sql`
      select decided_by, decision, timed_out, decided_at from approvals
      where run_id = ${seeded.runId} and step_index = 1`;
    expect(decision!.decision).toBe('approved');
    expect(decision!.decided_by).toBe(seeded.authorId);
    expect(decision!.timed_out).toBe(false);
    expect(decision!.decided_at).toBeTruthy();

    // The decision buttons are gone: the gate is no longer open.
    await expect(page.getByRole('button', { name: 'Батлаад үргэлжлүүлэх' })).toHaveCount(0);
  });

  test('an edit continues with the edited document, keeping the previous version (FR-062)', async ({
    page,
    context,
  }) => {
    const seeded = await seed('anyone');
    await signIn(context, seeded.authorId);
    await runToGate(page.request, seeded);

    await page.goto(`/tickets/${seeded.ticketId}/approve`);
    await page.getByRole('button', { name: /docs\/plan\.md/ }).click();
    await expect(page.getByText('Хувилбар 1')).toBeVisible();

    await page.getByRole('button', { name: 'plan засах' }).click();
    const edited = '# Plan\n\nUse the existing OAuth helper, not a new one.\n';
    await page.locator('textarea[name="content"]').fill(edited);
    await page.getByRole('button', { name: 'Хадгалаад үргэлжлүүлэх' }).click();

    await expect(page.getByText(/Already decided:\s*edited/)).toBeVisible({ timeout: 10_000 });

    // Two versions: the agent's, and the human's on top of it.
    const versions = await sql`
      select version, content, created_by from artifacts
      where run_id = ${seeded.runId} and path = 'docs/plan.md' order by version`;
    expect(versions).toHaveLength(2);
    expect(versions[0]!.version).toBe(1);
    expect(versions[0]!.content).toBe(SPEC_TEXT);
    expect(versions[0]!.created_by).toBeNull();
    expect(versions[1]!.version).toBe(2);
    expect(versions[1]!.content).toBe(edited);
    expect(versions[1]!.created_by).toBe(seeded.authorId);

    // The edited version is the one carried forward, and it is marked as edited.
    await expect(page.getByText('засварласан').first()).toBeVisible();
    await page.getByRole('button', { name: /docs\/plan\.md/ }).click();
    await expect(page.getByText('Use the existing OAuth helper')).toBeVisible();
    await expect(page.getByText('Хувилбар 2')).toBeVisible();
  });

  test('requested changes re-run the preceding step and come back to the same gate (FR-061)', async ({
    page,
    context,
  }) => {
    const seeded = await seed('anyone');
    await signIn(context, seeded.authorId);
    const post = await runToGate(page.request, seeded);

    await page.goto(`/tickets/${seeded.ticketId}/approve`);
    // The screen says which step will run again, so the decision is informed.
    await expect(page.getByText(/sent back to Planner/)).toBeVisible();

    // Empty feedback is refused: the text is what the agent reads.
    await page.getByRole('button', { name: 'Өөрчлөлт хүсэх' }).click();
    await expect(page.getByRole('alert')).toContainText('Юу өөрчлөгдөхийг бичнэ үү', {
      timeout: 10_000,
    });
    expect(await sql`select 1 from approvals where run_id = ${seeded.runId}`).toHaveLength(0);

    await page
      .locator('textarea[name="feedback"]')
      .fill('The plan skips the token refresh. Cover it.');
    await page.getByRole('button', { name: 'Өөрчлөлт хүсэх' }).click();

    await expect(page.getByText(/Already decided:\s*changes requested/)).toBeVisible({
      timeout: 10_000,
    });
    const [decision] = await sql`
      select decision, feedback, decided_by from approvals
      where run_id = ${seeded.runId} and step_index = 1`;
    expect(decision!.decision).toBe('changes_requested');
    expect(decision!.feedback).toBe('The plan skips the token refresh. Cover it.');
    expect(decision!.decided_by).toBe(seeded.authorId);
    // The feedback is part of the record of the run (FR-064c).
    await expect(page.getByText('The plan skips the token refresh. Cover it.')).toBeVisible();

    // The orchestrator re-runs the PRECEDING step, not the gate, then returns
    // to the same gate — which is step 1 again, on a second attempt.
    await post({ step_index: 0, event: 'step_started' });
    await post({
      step_index: 0,
      event: 'step_finished',
      status: 'done',
      duration_s: 9,
      cost_usd: '0.2000',
      artifacts: [{ kind: 'document', path: 'docs/plan.md', version: 2 }],
    });
    await post({
      step_index: 1,
      event: 'waiting_approval',
      resume_url: 'http://localhost:5173/api/hooks/orchestrator',
      approvers: [],
    });

    const [run] = await sql`select status, current_step_index from runs where id = ${seeded.runId}`;
    expect(run!.status).toBe('waiting_approval');
    expect(run!.current_step_index).toBe(1);
  });

  test('cancelling at a gate stops the run and leaves the branch alone (FR-064c, FR-097)', async ({
    page,
    context,
  }) => {
    const seeded = await seed('anyone');
    await signIn(context, seeded.authorId);
    await runToGate(page.request, seeded);

    await page.goto(`/tickets/${seeded.ticketId}/approve`);
    await expect(page.getByText(/releases the sandbox/)).toBeVisible();
    await page.getByRole('button', { name: 'Ажиллагаа цуцлах' }).click();

    await expect(page.getByText(/Already decided:\s*cancelled/)).toBeVisible({ timeout: 10_000 });

    const [run] = await sql`select status from runs where id = ${seeded.runId}`;
    const [ticket] =
      await sql`select status, branch_name from tickets where id = ${seeded.ticketId}`;
    expect(run!.status).toBe('cancelled');
    expect(ticket!.status).toBe('cancelled');
    // The branch the run pushed is untouched by the cancellation.
    expect(ticket!.branch_name).toContain('-oauth');
  });

  test('a non-approver reads everything and decides nothing (FR-064)', async ({
    page,
    context,
  }) => {
    const seeded = await seed('ticket_creator');
    // Signed in as an administrator who is not the ticket's author.
    await signIn(context, seeded.outsiderId);
    await runToGate(page.request, seeded);

    await page.goto(`/tickets/${seeded.ticketId}/approve`);

    // Everything is readable.
    await expect(page.getByRole('heading', { name: /Add Google OAuth sign-in/ })).toBeVisible();
    await expect(page.getByText('A Google button appears')).toBeVisible();
    await page.getByRole('button', { name: /docs\/plan\.md/ }).click();
    await expect(page.getByText('Add a Google button')).toBeVisible();
    await expect(page.getByText('Planner done')).toBeVisible();

    // Nothing is decidable — the buttons are absent, not merely disabled.
    await expect(page.getByText('Энэ хяналтын цэгийг та шийдэхгүй')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Батлаад үргэлжлүүлэх' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Өөрчлөлт хүсэх' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Ажиллагаа цуцлах' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'plan засах' })).toHaveCount(0);

    // And the gate is still open for the person it belongs to.
    const [run] = await sql`select status from runs where id = ${seeded.runId}`;
    expect(run!.status).toBe('waiting_approval');
    expect(await sql`select 1 from approvals where run_id = ${seeded.runId}`).toHaveLength(0);
  });

  test('a second decider is told the gate is already decided (FR-064a)', async ({
    page,
    context,
    browser,
  }) => {
    const seeded = await seed('anyone');
    await signIn(context, seeded.authorId);
    await runToGate(page.request, seeded);

    // Someone else opens the same gate, with the live-update stream blocked
    // so no event tells them what happens next: their page stays as it was.
    const second = await browser.newContext();
    await signIn(second, seeded.outsiderId);
    const otherPage = await second.newPage();
    await otherPage.route('**/api/events/**', (route) => route.abort());
    await otherPage.goto(`/tickets/${seeded.ticketId}/approve`);
    await expect(otherPage.getByRole('button', { name: 'Ажиллагаа цуцлах' })).toBeVisible();

    // The author decides first.
    await page.goto(`/tickets/${seeded.ticketId}/approve`);
    await page.getByRole('button', { name: 'Батлаад үргэлжлүүлэх' }).click();
    await expect(page.getByText(/Already decided:\s*approved/)).toBeVisible({ timeout: 10_000 });

    // The stale page submits anyway, and is told why nothing happened rather
    // than appearing to succeed or failing silently.
    await otherPage.getByRole('button', { name: 'Ажиллагаа цуцлах' }).click();
    await expect(otherPage.getByText(/already decided this checkpoint/)).toBeVisible({
      timeout: 10_000,
    });

    // One decision, the first one.
    const rows = await sql`
      select decision, decided_by from approvals where run_id = ${seeded.runId}`;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.decision).toBe('approved');
    expect(rows[0]!.decided_by).toBe(seeded.authorId);
    // And the run went where the winner sent it.
    const [run] = await sql`select status from runs where id = ${seeded.runId}`;
    expect(run!.status).toBe('running');
    await second.close();
  });

  test('a live page follows the decision someone else made (FR-074)', async ({
    page,
    context,
    browser,
  }) => {
    const seeded = await seed('anyone');
    await signIn(context, seeded.authorId);
    await runToGate(page.request, seeded);

    const second = await browser.newContext();
    await signIn(second, seeded.outsiderId);
    const otherPage = await second.newPage();
    await otherPage.goto(`/tickets/${seeded.ticketId}/approve`);
    await expect(otherPage.getByRole('button', { name: 'Ажиллагаа цуцлах' })).toBeVisible();

    await page.goto(`/tickets/${seeded.ticketId}/approve`);
    await page.getByRole('button', { name: 'Батлаад үргэлжлүүлэх' }).click();
    await expect(page.getByText(/Already decided:\s*approved/)).toBeVisible({ timeout: 10_000 });

    // Without a reload, the other person's decision panel goes away: the gate
    // is decided, so there is nothing left for them to decide.
    await expect(otherPage.getByRole('button', { name: 'Ажиллагаа цуцлах' })).toHaveCount(0, {
      timeout: 10_000,
    });
    await expect(otherPage.getByText(/Already decided:\s*approved/)).toBeVisible();
    await second.close();
  });
});
