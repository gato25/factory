import { createHmac, randomUUID } from 'node:crypto';
import type { APIRequestContext, BrowserContext } from '@playwright/test';
import { expect, test } from '@playwright/test';
import postgres from 'postgres';

/**
 * User Story 4's Independent Test (quickstart.md scenario D): force a failure
 * two ways — a ticket whose criteria cannot be met, and a deliberately low
 * cost ceiling — confirm the reason is legible without reading raw output
 * (FR-087, SC-008), then retry and confirm a second attempt exists while the
 * first stays readable (FR-090, SC-009).
 */

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/factory';
const SESSION_SECRET = process.env.SESSION_SECRET ?? '';

// Idle connections close themselves rather than being ended in a hook a
// fully-parallel worker may run before its last test from this file.
const sql = postgres(DATABASE_URL, { max: 4, idle_timeout: 2, onnotice: () => {} });

type Seeded = { ticketId: string; runId: string; secret: string; userId: string };

async function seed(options: { ceilingUsd?: string } = {}): Promise<Seeded> {
  const secret = `e2e-${randomUUID()}`;
  const runId = randomUUID();
  const tag = randomUUID().slice(0, 8);

  await sql`insert into workspaces (name) values ('E2E') on conflict do nothing`;
  const [user] = await sql`
    insert into users (name, email, role)
    values ('Recoverer', ${`recover-${tag}@x.dev`}, 'member') returning id`;
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
    insert into pipelines (name, current_version) values ('Standard', 1) returning id`;

  const steps = [
    { type: 'agent', condition: 'always', agent_id: plan!.id, output_files: ['docs/plan.md'] },
    { type: 'agent', condition: 'always', agent_id: build!.id, output_files: [] },
  ];
  await sql`insert into pipeline_versions (pipeline_id, version, steps)
            values (${pipeline!.id}, 1, ${sql.json(steps)})`;

  const reference = `#${Math.floor(Math.random() * 90_000) + 10_000}`;
  const [ticket] = await sql`
    insert into tickets (repository_id, created_by, reference, title, description,
      acceptance_criteria, pipeline_id, pipeline_version, status, branch_name, current_run_id)
    values (${repo!.id}, ${user!.id}, ${reference}, 'Make the app faster',
      'It should feel quicker.', ${sql.array(['It feels quicker'])},
      ${pipeline!.id}, 1, 'running', ${`factory/${tag}-faster`}, ${runId})
    returning id`;

  const agent = (id: string, name: string, model: string) => ({
    id,
    name,
    engine: 'claude_cli',
    model,
    system_prompt: 'do the work',
    allowed_tools: ['Read', 'Write'],
    skills: [],
    limits: {},
  });

  const ceiling = options.ceilingUsd ?? '5.0000';
  const snapshot = {
    run_id: runId,
    attempt: 1,
    ticket: {
      reference,
      title: 'Make the app faster',
      description: 'It should feel quicker.',
      acceptance_criteria: ['It feels quicker'],
    },
    repo: {
      clone_url: 'https://gitlab.com/netgroup/shop.git',
      default_branch: 'main',
      branch: `factory/${tag}-faster`,
      provider: 'gitlab',
      credential_ref: credential!.id,
    },
    pipeline: { id: pipeline!.id, version: 1, name: 'Standard', steps },
    limits: { cost_ceiling_usd: ceiling, time_ceiling_minutes: 45 },
    agents: [
      agent(plan!.id, 'Planner', 'claude-sonnet-5'),
      agent(build!.id, 'Builder', 'claude-opus-5'),
    ],
    callback_url: 'http://localhost:5173/api/hooks/orchestrator',
    resume_secret: secret,
  };

  await sql`insert into runs (id, ticket_id, attempt, snapshot, status, cost_ceiling_usd,
              time_ceiling_minutes, started_at)
            values (${runId}, ${ticket!.id}, 1, ${sql.json(snapshot)}, 'running', ${ceiling}, 45,
              now())`;

  return { ticketId: ticket!.id, runId, secret, userId: user!.id };
}

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

function callbacks(request: APIRequestContext, seeded: Seeded) {
  return (body: Record<string, unknown>) =>
    request.post('http://localhost:5173/api/hooks/orchestrator', {
      headers: { authorization: `Bearer ${seeded.secret}` },
      data: { run_id: seeded.runId, attempt: 1, ...body },
    });
}

test.describe('recovering from a failed run', () => {
  test.skip(
    !SESSION_SECRET,
    'Needs SESSION_SECRET, to mint the same session cookie the app issues.',
  );

  test('a ticket whose criteria cannot be met fails legibly, and one click retries it', async ({
    page,
    context,
  }) => {
    // Delivery retries with increasing delays before reporting that the run
    // has not begun (FR-094), which is most of this test's duration.
    test.setTimeout(120_000);
    const seeded = await seed();
    await signIn(context, seeded.userId);
    const post = callbacks(page.request, seeded);

    // The planning step produces its document, then the build step gives up.
    await post({
      step_index: 0,
      event: 'step_finished',
      status: 'done',
      duration_s: 9,
      cost_usd: '0.2500',
      artifacts: [{ kind: 'document', path: 'docs/plan.md', version: 1 }],
    });
    await post({ step_index: 1, event: 'step_started' });
    await post({
      step_index: 1,
      event: 'failed',
      reason: 'missing_output',
      detail: 'Traceback: AssertionError at line 41 of the harness',
    });

    await page.goto(`/tickets/${seeded.ticketId}`);

    // Which step, and why — without opening anything (FR-087, SC-008).
    await expect(page.getByText('Builder — step 2 did not finish')).toBeVisible();
    await expect(
      page.getByText('The step finished without producing the document it was supposed to write.'),
    ).toBeVisible();
    await expect(
      page.getByText(/Add detail to the description or the acceptance criteria/),
    ).toBeVisible();
    // The document the attempt did produce is named, so a retry is informed.
    await expect(page.getByText(/docs\/plan\.md/).first()).toBeVisible();

    // The raw output is available but not in the way: it is behind a summary.
    const raw = page.getByText('Traceback: AssertionError at line 41 of the harness');
    await expect(raw).toBeHidden();
    await page.getByText('What the step itself reported').click();
    await expect(raw).toBeVisible();

    // The failed step is the one highlighted, with the retry beside it.
    await expect(page.getByRole('button', { name: 'Retry from here' })).toBeVisible();

    // SC-009 — one interaction. No orchestrator is running here, so what
    // comes back is FR-094's message: the attempt exists and has not begun.
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect(page.getByText(/Attempt 2 is queued but has not begun/)).toBeVisible({
      timeout: 60_000,
    });

    const attempts = await sql`
      select attempt, status, cost_usd, failure_reason from runs
      where ticket_id = ${seeded.ticketId} order by attempt`;
    expect(attempts).toHaveLength(2);
    expect(attempts[0]!.attempt).toBe(1);
    expect(attempts[0]!.status).toBe('failed');
    expect(attempts[0]!.cost_usd).toBe('0.2500');
    expect(attempts[1]!.attempt).toBe(2);

    // FR-090 — the first attempt's records and documents are still there.
    const kept = await sql`
      select count(*)::int as n from step_results where run_id = ${seeded.runId}`;
    expect(kept[0]!.n).toBe(2);
    const docs = await sql`
      select path from artifacts where run_id = ${seeded.runId}`;
    expect(docs.map((d) => d.path)).toEqual(['docs/plan.md']);
  });

  test('a deliberately low ceiling names the ceiling and what was consumed (FR-081)', async ({
    page,
    context,
  }) => {
    // A ceiling one step cannot fit inside.
    const seeded = await seed({ ceilingUsd: '0.2000' });
    await signIn(context, seeded.userId);
    const post = callbacks(page.request, seeded);

    await post({ step_index: 0, event: 'step_started' });
    await post({
      step_index: 0,
      event: 'step_finished',
      status: 'done',
      duration_s: 30,
      cost_usd: '0.3400',
      artifacts: [],
    });
    // The orchestrator checks the ceiling after every step and stops the run.
    await post({
      step_index: 0,
      event: 'failed',
      reason: 'the run reached its ceiling of $0.2000',
    });

    await page.goto(`/tickets/${seeded.ticketId}`);

    await expect(page.getByText('The run reached the most it was allowed to spend.')).toBeVisible();
    // What was consumed, against what was allowed.
    await expect(page.getByText('Spent $0.3400 of a $0.2000 ceiling.')).toBeVisible();
    await expect(page.getByText(/Split it, or raise the ceiling on the pipeline/)).toBeVisible();
    // And the reason is not a stack trace or an exit code.
    await expect(page.getByText(/Traceback|exit code|exited [0-9]/)).toHaveCount(0);
  });

  test('editing and retrying is one action, and the edit reaches the new attempt (FR-089)', async ({
    page,
    context,
  }) => {
    test.setTimeout(120_000);
    const seeded = await seed();
    await signIn(context, seeded.userId);
    const post = callbacks(page.request, seeded);
    await post({ step_index: 0, event: 'failed', reason: 'missing_output' });

    await page.goto(`/tickets/${seeded.ticketId}`);

    // SC-009 — two interactions: open the editor, then save and retry.
    await page.getByRole('button', { name: 'Edit & retry' }).click();
    await page
      .locator('textarea')
      .first()
      .fill('Make the ticket list load in under 300ms on a cold cache.');
    await page.locator('textarea').last().fill('The ticket list loads in under 300ms');
    await page.getByRole('button', { name: 'Save & retry' }).click();

    await expect(
      page.getByText(/Ticket updated\. Attempt 2 is queued but has not begun/),
    ).toBeVisible({ timeout: 60_000 });

    const [ticket] = await sql`
      select description, acceptance_criteria from tickets where id = ${seeded.ticketId}`;
    expect(ticket!.description).toBe('Make the ticket list load in under 300ms on a cold cache.');
    expect(ticket!.acceptance_criteria).toEqual(['The ticket list loads in under 300ms']);

    // The new attempt's snapshot reads the edit; the old one still reads what
    // it was asked at the time.
    const runs = await sql`
      select attempt, snapshot from runs where ticket_id = ${seeded.ticketId} order by attempt`;
    expect(runs[1]!.snapshot.ticket.acceptance_criteria).toEqual([
      'The ticket list loads in under 300ms',
    ]);
    expect(runs[0]!.snapshot.ticket.acceptance_criteria).toEqual(['It feels quicker']);
  });

  test('pausing lets the step conclude and stops the next one (FR-096)', async ({
    page,
    context,
  }) => {
    const seeded = await seed();
    await signIn(context, seeded.userId);
    const post = callbacks(page.request, seeded);
    await post({ step_index: 0, event: 'step_started' });

    await page.goto(`/tickets/${seeded.ticketId}`);
    await page.getByRole('button', { name: 'Pause' }).click();

    await expect(
      page.getByText('Pausing. The step running now will finish, and nothing further will start.'),
    ).toBeVisible({ timeout: 15_000 });

    // The run keeps its status: it is still running the step it was running.
    const [run] = await sql`
      select status, pause_requested_at, pause_requested_by from runs where id = ${seeded.runId}`;
    expect(run!.status).toBe('running');
    expect(run!.pause_requested_at).not.toBeNull();
    expect(run!.pause_requested_by).toBe(seeded.userId);

    // The step in flight concludes and is recorded, and the reply to that
    // very callback is what tells the orchestrator to hold.
    const reply = await post({
      step_index: 0,
      event: 'step_finished',
      status: 'done',
      duration_s: 7,
      cost_usd: '0.1000',
      artifacts: [],
    });
    expect(await reply.json()).toMatchObject({ applied: true, paused: true, continue: false });

    // Continuing withdraws the request.
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByText(/Continuing from where it stopped/)).toBeVisible({
      timeout: 15_000,
    });
    const [after] = await sql`select pause_requested_at from runs where id = ${seeded.runId}`;
    expect(after!.pause_requested_at).toBeNull();
  });

  test('cancelling releases the sandbox and leaves the branch alone (FR-097)', async ({
    page,
    context,
  }) => {
    const seeded = await seed();
    await signIn(context, seeded.userId);
    await sql`update runs set container_id = 'container-e2e' where id = ${seeded.runId}`;

    await page.goto(`/tickets/${seeded.ticketId}`);
    await page.getByRole('button', { name: 'Cancel run' }).click();

    await expect(page.getByText(/the branch pushed so far is untouched/)).toBeVisible({
      timeout: 15_000,
    });

    const [run] = await sql`select status from runs where id = ${seeded.runId}`;
    const [ticket] = await sql`
      select status, branch_name from tickets where id = ${seeded.ticketId}`;
    expect(run!.status).toBe('cancelled');
    expect(ticket!.status).toBe('cancelled');
    expect(ticket!.branch_name).toContain('-faster');

    // A cancelled run is retryable, and says so rather than offering a pause.
    await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Pause' })).toHaveCount(0);
  });
});
