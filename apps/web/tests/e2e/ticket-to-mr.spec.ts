import { expect, test } from '@playwright/test';

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
    await page.getByLabel(/Repository address/).fill(E2E_REPO_URL as string);
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
    await page.getByLabel(/Repository address/).fill(E2E_REPO_URL as string);
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
    await page.getByLabel(/Repository address/).fill('https://git.internal.example/team/thing');
    await page.getByLabel(/Access token/).fill('irrelevant');
    await page.getByRole('button', { name: 'Test & connect' }).click();
    await expect(page.getByRole('alert')).toContainText(/git\.internal\.example is not supported/);
  });
});
