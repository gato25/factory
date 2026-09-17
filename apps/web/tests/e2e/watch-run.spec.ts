import { createHmac, randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import postgres from 'postgres';

/**
 * User Story 2's Independent Test (quickstart.md scenario B): from the ticket
 * page alone, state which step is executing, what has been spent, and what the
 * last agent produced — without reloading.
 *
 * This runs for real. It seeds a run, signs in, then drives the run forward
 * through the actual callback endpoint, so the whole path is exercised:
 * callback → NOTIFY → server-sent event → query refresh → rendered change.
 */

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/factory';
const SESSION_SECRET = process.env.SESSION_SECRET ?? '';

// Idle connections close themselves, so the pool is never explicitly
// ended: with fully-parallel runs a worker can be handed another test
// from this file after an `afterAll` already fired.
const sql = postgres(DATABASE_URL, { max: 2, idle_timeout: 2, onnotice: () => {} });

type Seeded = { ticketId: string; runId: string; secret: string; userId: string };

async function seed(): Promise<Seeded> {
  const secret = `e2e-${randomUUID()}`;
  const runId = randomUUID();

  await sql`insert into workspaces (name) values ('E2E') on conflict do nothing`;
  const [user] = await sql`
    insert into users (name, email, role) values ('Watcher', ${`watch-${randomUUID()}@x.dev`}, 'member')
    returning id`;
  const [credential] = await sql`
    insert into credentials (kind, ciphertext, key_version, status)
    values ('git', 'sealed', 'v1', 'valid') returning id`;
  const [repo] = await sql`
    insert into repositories (name, full_path, provider, clone_url, default_branch, credential_id, status)
    values ('shop', ${`netgroup/shop-${randomUUID().slice(0, 8)}`}, 'gitlab',
            'https://gitlab.com/netgroup/shop.git', 'main', ${credential!.id}, 'connected')
    returning id`;
  const [spec] = await sql`
    insert into agents (name, kind, engine, model, system_prompt, allowed_tools)
    values ('Spec', 'default', 'claude_cli', 'claude-sonnet-5', 'write the spec', '{Read,Write}')
    returning id`;
  const [pipeline] = await sql`
    insert into pipelines (name, current_version) values ('Standard', 1) returning id`;

  const steps = [
    { type: 'agent', condition: 'always', agent_id: spec!.id, output_files: ['docs/spec.md'] },
    { type: 'design', condition: 'ticket_has_ui' },
    { type: 'agent', condition: 'always', agent_id: spec!.id, output_files: [] },
  ];
  await sql`insert into pipeline_versions (pipeline_id, version, steps)
            values (${pipeline!.id}, 1, ${sql.json(steps)})`;

  const reference = `#${Math.floor(Math.random() * 90_000) + 10_000}`;
  const [ticket] = await sql`
    insert into tickets (repository_id, created_by, reference, title, description,
      acceptance_criteria, pipeline_id, pipeline_version, status, branch_name, current_run_id)
    values (${repo!.id}, ${user!.id}, ${reference}, 'Add Google OAuth sign-in',
      'Users should sign in with Google.', ${sql.array(['A Google button appears'])},
      ${pipeline!.id}, 1, 'queued', 'factory/e2e-oauth', ${runId})
    returning id`;

  const snapshot = {
    run_id: runId,
    attempt: 1,
    ticket: {
      reference,
      title: 'Add Google OAuth sign-in',
      description: null,
      acceptance_criteria: ['A Google button appears'],
    },
    repo: {
      clone_url: 'https://gitlab.com/netgroup/shop.git',
      default_branch: 'main',
      branch: 'factory/e2e-oauth',
      provider: 'gitlab',
      credential_ref: credential!.id,
    },
    pipeline: { id: pipeline!.id, version: 1, name: 'Standard', steps },
    limits: { cost_ceiling_usd: '5.0000', time_ceiling_minutes: 45 },
    agents: [
      {
        id: spec!.id,
        name: 'Spec',
        engine: 'claude_cli',
        model: 'claude-sonnet-5',
        system_prompt: 'write the spec',
        allowed_tools: ['Read', 'Write'],
        skills: [],
        limits: {},
      },
    ],
    callback_url: 'http://localhost:5173/api/hooks/orchestrator',
    resume_secret: secret,
  };

  await sql`insert into runs (id, ticket_id, attempt, snapshot, status, cost_ceiling_usd,
              time_ceiling_minutes)
            values (${runId}, ${ticket!.id}, 1, ${sql.json(snapshot)}, 'queued', '5.0000', 45)`;

  return { ticketId: ticket!.id, runId, secret, userId: user!.id };
}

/** The same signed cookie the app issues, so no password round-trip is needed. */
function sessionToken(userId: string): string {
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  const body = `${userId}.${expiresAt}`;
  const signature = createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
  return `${body}.${signature}`;
}

test.describe('watching a run', () => {
  test.skip(
    !SESSION_SECRET,
    'Needs SESSION_SECRET, to mint the same session cookie the app issues.',
  );

  test('a run reports where it is, and updates without a reload (FR-074, SC-004)', async ({
    page,
    context,
  }) => {
    const seeded = await seed();
    await context.addCookies([
      {
        name: 'factory_session',
        value: sessionToken(seeded.userId),
        domain: 'localhost',
        path: '/',
        httpOnly: true,
        secure: false,
        sameSite: 'Lax',
      },
    ]);

    const callback = (body: Record<string, unknown>) =>
      page.request.post('http://localhost:5173/api/hooks/orchestrator', {
        headers: { authorization: `Bearer ${seeded.secret}` },
        data: { run_id: seeded.runId, attempt: 1, ...body },
      });

    await page.goto(`/tickets/${seeded.ticketId}`);
    await expect(page.getByRole('heading', { name: /Add Google OAuth sign-in/ })).toBeVisible();
    await expect(page.getByText('Queued')).toBeVisible();
    // Three steps plus the implicit merge request.
    await expect(page.getByText('Merge request').first()).toBeVisible();

    // --- the run starts; the page must follow without a reload ---
    await callback({ step_index: 0, event: 'started', container_id: 'container-e2e' });
    await expect(page.getByText('Running').first()).toBeVisible({ timeout: 5_000 });

    await callback({ step_index: 0, event: 'step_started' });

    // --- output appears progressively (FR-076) ---
    await callback({
      step_index: 0,
      event: 'log_chunk',
      seq: 1,
      stream: 'stdout',
      text: 'reading the ticket…\n',
    });
    await expect(page.getByText('reading the ticket…')).toBeVisible({ timeout: 5_000 });

    // --- the step finishes; duration and cost are shown (FR-075) ---
    await callback({
      step_index: 0,
      event: 'step_finished',
      status: 'done',
      duration_s: 14,
      cost_usd: '0.4200',
      artifacts: [{ kind: 'document', path: 'docs/spec.md', version: 1 }],
    });
    await expect(page.getByText('$0.4200').first()).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText('14s')).toBeVisible();

    // --- what the last agent produced is readable in the application (FR-077) ---
    await expect(page.getByText('docs/spec.md').first()).toBeVisible();

    // --- a skipped step is shown WITH its reason, not omitted (FR-075a) ---
    await callback({
      step_index: 1,
      event: 'step_skipped',
      condition_not_met: 'ticket has no UI change',
    });
    await expect(page.getByText(/skipped — ticket has no UI change/)).toBeVisible({
      timeout: 5_000,
    });

    // --- the failure reason is legible without opening raw output (FR-087) ---
    await callback({
      step_index: 2,
      event: 'failed',
      reason: 'the step produced no document',
    });
    await expect(page.getByRole('alert')).toContainText('the step produced no document', {
      timeout: 5_000,
    });
  });

  test('the dashboard lists the run and its progress (FR-071, FR-072)', async ({
    page,
    context,
  }) => {
    const seeded = await seed();
    await context.addCookies([
      {
        name: 'factory_session',
        value: sessionToken(seeded.userId),
        domain: 'localhost',
        path: '/',
        httpOnly: true,
        secure: false,
        sameSite: 'Lax',
      },
    ]);

    await page.goto('/');
    await expect(page.getByText('tickets running')).toBeVisible();
    await expect(page.getByText('Active runs')).toBeVisible();
    await expect(page.getByText(/Add Google OAuth sign-in/).first()).toBeVisible();
  });
});
