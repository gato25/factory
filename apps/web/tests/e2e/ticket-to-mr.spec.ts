import { createHmac, randomUUID } from 'node:crypto';
import type { BrowserContext } from '@playwright/test';
import { expect, test } from '@playwright/test';
import postgres from 'postgres';

/**
 * User Story 1's Independent Test (quickstart.md scenario A).
 *
 * The full journey needs four things this repository cannot provide on its
 * own: a real GitLab.com or GitHub.com repository with a test suite, a token
 * that can push and open merge requests, a model credential, and a reachable
 * n8n instance and container host. Those parts are gated on environment
 * variables and SKIP with a stated reason rather than passing vacuously — a
 * green test that proved nothing would be worse than an honest skip.
 *
 * Everything that does not need them runs unconditionally.
 */

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/factory';
const SESSION_SECRET = process.env.SESSION_SECRET ?? '';
const sql = postgres(DATABASE_URL, { max: 4, idle_timeout: 2, onnotice: () => {} });

const E2E_REPO_URL = process.env.E2E_REPO_URL;
const E2E_REPO_TOKEN = process.env.E2E_REPO_TOKEN;
const full = Boolean(E2E_REPO_URL && E2E_REPO_TOKEN && process.env.E2E_ORCHESTRATOR_READY);

test.describe('the parts that need no external service', () => {
  test('an unauthenticated visitor is sent to sign in, and can return', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.url()).toContain('/login');
    expect(response?.url()).toContain('next=%2F');
  });

  test('the sign-in screen offers both providers and explains the pipeline', async ({ page }) => {
    await page.goto('/login');
    // Both are offered because playwright.config.ts configures both. A
    // provider with no client id and secret is not offered at all, rather
    // than offered as a link that fails — asserted against the environment
    // directly in tests/integration/oauth.test.ts.
    const gitlab = page.getByRole('link', { name: /Continue with GitLab/ });
    await expect(gitlab).toBeVisible();
    await expect(gitlab).toHaveAttribute('href', '/login/gitlab');
    await expect(page.getByRole('link', { name: /Continue with GitHub/ })).toBeVisible();
    await expect(page.getByText(/Turn a ticket into a reviewable merge request/)).toBeVisible();
    // The design step is conditional, and the screen says so (FR-032b).
    await expect(page.getByText(/only when a ticket changes the interface/i)).toBeVisible();
  });

  test('wrong credentials are refused without revealing whether the account exists', async ({
    page,
  }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill('nobody@example.com');
    await page.getByLabel('Password').fill('definitely-not-right');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('alert')).toContainText(/do not match/);
    // No session was created.
    expect(await page.context().cookies()).not.toContainEqual(
      expect.objectContaining({ name: 'factory_session' }),
    );
  });
});

/**
 * The form itself needs no external service: saving a draft starts nothing.
 * Worth its own test because the two buttons are one form — Save as draft
 * and Create & start differ only in the value they submit, and a form that
 * started a run when you meant to save a draft would be a bad surprise.
 */
test.describe('the ticket form', () => {
  test.skip(!SESSION_SECRET, 'Needs SESSION_SECRET, to mint the session cookie the app issues.');

  test('saving a draft creates the ticket and starts nothing (FR-016)', async ({
    page,
    context,
  }) => {
    const tag = randomUUID().slice(0, 8);
    await sql`insert into workspaces (name) values ('E2E') on conflict do nothing`;
    const [user] = await sql`
      insert into users (name, email, role)
      values ('Drafter', ${`draft-${tag}@x.dev`}, 'member') returning id`;
    const [credential] = await sql`
      insert into credentials (kind, ciphertext, key_version, status)
      values ('git', 'sealed', 'v1', 'valid') returning id`;
    const [repo] = await sql`
      insert into repositories (name, full_path, provider, clone_url, default_branch,
        credential_id, status)
      values (${`shop-${tag}`}, ${`netgroup/shop-${tag}`}, 'gitlab',
        'https://gitlab.com/netgroup/shop.git', 'main', ${credential!.id}, 'connected')
      returning id`;
    const [pipeline] = await sql`
      insert into pipelines (name, description, current_version)
      values (${`Standard ${tag}`}, 'Spec then implement', 1) returning id`;
    const [agent] = await sql`
      insert into agents (name, kind, engine, model, system_prompt, allowed_tools)
      values (${`Builder ${tag}`}, 'default', 'claude_cli', 'claude-opus-5', 'code', '{Read,Edit}')
      returning id`;
    await sql`
      insert into pipeline_versions (pipeline_id, version, steps)
      values (${pipeline!.id}, 1, ${sql.json([
        { type: 'agent', condition: 'always', agent_id: agent!.id, output_files: [] },
      ])})`;

    const base = `${user!.id}.${Math.floor(Date.now() / 1000) + 3600}`;
    await context.addCookies([
      {
        name: 'factory_session',
        value: `${base}.${createHmac('sha256', SESSION_SECRET).update(base).digest('base64url')}`,
        domain: 'localhost',
        path: '/',
        httpOnly: true,
        secure: false,
        sameSite: 'Lax',
      },
    ]);

    await page.goto('/tickets/new');
    await page
      .getByLabel('Repository')
      .selectOption({ label: `shop-${tag} · netgroup/shop-${tag}` });
    await page.getByLabel('Title').fill(`Paginate the list ${tag}`);
    await page.getByLabel('Acceptance criteria').fill('The list pages\nTests still pass');
    // Choosing the pipeline shows what would happen before anything does.
    await page.getByText(`Standard ${tag}`, { exact: true }).click();
    await expect(page.getByText(`Builder ${tag}`)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Open merge request')).toBeVisible();

    await page.getByRole('button', { name: 'Save as draft' }).click();
    await expect(page.getByRole('status')).toContainText('saved as a draft', { timeout: 15_000 });

    const [saved] = await sql`
      select status, current_run_id, acceptance_criteria, pipeline_id from tickets
      where title = ${`Paginate the list ${tag}`}`;
    expect(saved!.status).toBe('draft');
    // Nothing was started: a draft has no run.
    expect(saved!.current_run_id).toBeNull();
    expect(saved!.acceptance_criteria).toEqual(['The list pages', 'Tests still pass']);
    expect(saved!.pipeline_id).toBe(pipeline!.id);
  });
});

test.describe('the whole journey', () => {
  test.skip(
    !full,
    'Needs E2E_REPO_URL, E2E_REPO_TOKEN and E2E_ORCHESTRATOR_READY: a real repository with a ' +
      'test suite, a token that can push and open merge requests, and a reachable orchestrator ' +
      'and container host.',
  );

  test('a ticket becomes an open merge request', async ({ page }) => {
    await page.goto('/repositories');
    await page.getByRole('button', { name: 'Connect repository' }).click();
    await page.getByLabel(/Repository URL/).fill(E2E_REPO_URL as string);
    await page.getByLabel(/Access token/).fill(E2E_REPO_TOKEN as string);
    await page.getByRole('button', { name: 'Test & connect' }).click();
    await expect(page.getByText('Connected')).toBeVisible({ timeout: 30_000 });

    await page.goto('/tickets/new');
    await page.getByLabel(/Repository/).selectOption({ index: 1 });
    await page.getByLabel(/Title/).fill('Add a health endpoint');
    await page
      .getByLabel(/Acceptance criteria/)
      .fill('GET /health returns 200\nThe existing test suite still passes');
    await page.getByRole('button', { name: /Create & start pipeline/ }).click();

    // The run page shows a merge request once the pipeline finishes.
    await expect(page.getByText(/merge request/i)).toBeVisible({ timeout: 20 * 60_000 });
  });

  test('a token missing a permission is refused, naming which one (FR-009)', async ({ page }) => {
    test.skip(!process.env.E2E_READONLY_TOKEN, 'Needs E2E_READONLY_TOKEN — a read-only token.');
    await page.goto('/repositories');
    await page.getByRole('button', { name: 'Connect repository' }).click();
    await page.getByLabel(/Repository URL/).fill(E2E_REPO_URL as string);
    await page.getByLabel(/Access token/).fill(process.env.E2E_READONLY_TOKEN as string);
    await page.getByRole('button', { name: 'Test & connect' }).click();
    await expect(page.getByRole('alert')).toContainText(/missing (write_repository|Contents)/);
  });
});

test.describe('the refusals', () => {
  test.skip(!full, 'Needs a signed-in session; see the gate above.');

  test('a repository hosted anywhere else is refused, naming the host (FR-014b)', async ({
    page,
  }) => {
    await page.goto('/repositories');
    await page.getByRole('button', { name: 'Connect repository' }).click();
    await page.getByLabel(/Repository URL/).fill('https://git.internal.example/team/thing');
    await page.getByLabel(/Access token/).fill('irrelevant');
    await page.getByRole('button', { name: 'Test & connect' }).click();
    await expect(page.getByRole('alert')).toContainText(/git\.internal\.example is not supported/);
  });
});
