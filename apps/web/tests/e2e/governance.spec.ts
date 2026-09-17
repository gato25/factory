import { createHmac, randomUUID } from 'node:crypto';
import type { BrowserContext } from '@playwright/test';
import { expect, test } from '@playwright/test';
import postgres from 'postgres';

/**
 * User Story 8's Independent Test (quickstart.md scenario H): set the
 * ceilings, start more tickets than the concurrency ceiling allows, and
 * confirm runs beyond it wait with a position (FR-082); that no stored
 * credential is readable back (FR-011); and that a member cannot change
 * credentials, connections or ceilings (FR-004).
 */

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/factory';
const SESSION_SECRET = process.env.SESSION_SECRET ?? '';

const sql = postgres(DATABASE_URL, { max: 4, idle_timeout: 2, onnotice: () => {} });

type Seeded = {
  tag: string;
  adminId: string;
  memberId: string;
  ticketIds: string[];
  /** This seed's own ticket references, to pick its rows out of a shared queue. */
  references: string[];
};

/**
 * The queue is workspace-wide, so a test can only make an exact claim about
 * positions if the runs in it are its own. Earlier specs leave runs mid-flight
 * — abandoned when their test ended — so those are marked finished rather than
 * deleted: nothing here owns their rows, and the queue reads a run's status.
 */
async function emptyTheQueue() {
  await sql`update runs set status = 'done', finished_at = now()
            where status in ('queued', 'running', 'waiting_approval', 'opening_mr')`;
}

async function seed(options: { tickets?: number; cap?: number } = {}): Promise<Seeded> {
  const tag = randomUUID().slice(0, 8);

  // One workspace per deployment: reuse it rather than adding a second, or
  // a read and a write could land on different rows.
  const existing = await sql`select id from workspaces order by created_at limit 1`;
  if (existing.length === 0) {
    await sql`insert into workspaces (name) values ('E2E')`;
  }
  // The addresses are cleared as well as the ceilings. A test that asserts
  // nothing claims to be reachable is otherwise asserting that nothing
  // happens to be running on this machine, which is not a fact about the
  // product — the five connection states are pinned in
  // tests/integration/connections.test.ts, against a stub.
  await sql`update workspaces set max_concurrent_runs = ${options.cap ?? 2},
              default_cost_ceiling_usd = '5.0000', default_time_ceiling_minutes = 45,
              model_credential_id = null, design_credential_id = null,
              orchestrator_base_url = null, orchestrator_workflow_id = null,
              runner_base_url = null`;

  const [admin] = await sql`
    insert into users (name, email, role)
    values (${`Admin ${tag}`}, ${`admin-${tag}@x.dev`}, 'admin') returning id`;
  const [member] = await sql`
    insert into users (name, email, role)
    values (${`Member ${tag}`}, ${`member-${tag}@x.dev`}, 'member') returning id`;
  const [credential] = await sql`
    insert into credentials (kind, ciphertext, key_version, status)
    values ('git', 'sealed-opaque-value', 'v1', 'valid') returning id`;
  const [repo] = await sql`
    insert into repositories (name, full_path, provider, clone_url, default_branch,
      credential_id, status)
    values ('shop', ${`netgroup/shop-${tag}`}, 'gitlab',
      'https://gitlab.com/netgroup/shop.git', 'main', ${credential!.id}, 'connected')
    returning id`;
  const [agent] = await sql`
    insert into agents (name, kind, engine, model, system_prompt, allowed_tools)
    values (${`Spec ${tag}`}, 'custom', 'claude_cli', 'claude-sonnet-5', 'spec', '{Read,Write}')
    returning id`;
  const [pipeline] = await sql`
    insert into pipelines (name, current_version) values (${`P ${tag}`}, 1) returning id`;
  const steps = [
    { type: 'agent', condition: 'always', agent_id: agent!.id, output_files: ['docs/spec.md'] },
    { type: 'agent', condition: 'always', agent_id: agent!.id, output_files: [] },
  ];
  await sql`insert into pipeline_versions (pipeline_id, version, steps)
            values (${pipeline!.id}, 1, ${sql.json(steps)})`;

  const ticketIds: string[] = [];
  const references: string[] = [];
  if ((options.tickets ?? 0) > 0) await emptyTheQueue();
  for (let i = 0; i < (options.tickets ?? 0); i++) {
    const runId = randomUUID();
    const reference = `#${Math.floor(Math.random() * 90_000) + 10_000}-${i}`;
    const [ticket] = await sql`
      insert into tickets (repository_id, created_by, reference, title, acceptance_criteria,
        pipeline_id, pipeline_version, status, branch_name, current_run_id)
      values (${repo!.id}, ${member!.id}, ${reference}, ${`Queued ticket ${i}`},
        ${sql.array(['It works'])}, ${pipeline!.id}, 1, 'queued', ${`factory/${tag}-${i}`},
        ${runId})
      returning id`;
    const snapshot = {
      run_id: runId,
      attempt: 1,
      ticket: {
        reference,
        title: `Queued ticket ${i}`,
        description: null,
        acceptance_criteria: ['It works'],
      },
      repo: {
        clone_url: 'https://gitlab.com/netgroup/shop.git',
        default_branch: 'main',
        branch: `factory/${tag}-${i}`,
        provider: 'gitlab',
        credential_ref: credential!.id,
      },
      pipeline: { id: pipeline!.id, version: 1, name: `P ${tag}`, steps },
      limits: { cost_ceiling_usd: '5.0000', time_ceiling_minutes: 45 },
      agents: [],
      callback_url: 'http://localhost:5173/api/hooks/orchestrator',
      resume_secret: `e2e-${randomUUID()}`,
    };
    // The first two hold sandboxes; the rest are the queue.
    const status = i < (options.cap ?? 2) ? 'running' : 'queued';
    await sql`insert into runs (id, ticket_id, attempt, snapshot, status, cost_ceiling_usd,
                time_ceiling_minutes, created_at, started_at)
              values (${runId}, ${ticket!.id}, 1, ${sql.json(snapshot)}, ${status}, '5.0000', 45,
                now() + (${i} || ' seconds')::interval, now())`;
    ticketIds.push(ticket!.id);
    references.push(reference);
  }

  return { tag, adminId: admin!.id, memberId: member!.id, ticketIds, references };
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

test.describe('setting up and governing the workspace', () => {
  test.skip(
    !SESSION_SECRET,
    'Needs SESSION_SECRET, to mint the same session cookie the app issues.',
  );

  test('an administrator sets the ceilings, and each connection test says which fault it is', async ({
    page,
    context,
  }) => {
    const seeded = await seed();
    await signIn(context, seeded.adminId);
    await page.goto('/settings');

    // The ceilings that make unattended execution financially safe.
    await page.getByLabel('Most a run may spend, in dollars').fill('2.5000');
    await page.getByLabel('Longest a run may take, in minutes').fill('30');
    await page.getByLabel('Runs that may execute at once').fill('3');
    await page.getByLabel('Lifetime, in minutes').fill('120');
    await page.getByLabel("Keep a failed run's sandbox for, in hours").fill('6');
    await page.getByRole('button', { name: 'Save', exact: true }).click();

    await expect(page.getByRole('main')).toContainText(
      'Runs already in flight keep the ceilings they started with',
      { timeout: 15_000 },
    );

    const [w] = await sql`
      select default_cost_ceiling_usd, default_time_ceiling_minutes, max_concurrent_runs,
             sandbox_wall_clock_minutes, retain_failed_sandboxes_hours from workspaces`;
    expect(w!.default_cost_ceiling_usd).toBe('2.5000');
    expect(w!.default_time_ceiling_minutes).toBe(30);
    expect(w!.max_concurrent_runs).toBe(3);
    expect(w!.sandbox_wall_clock_minutes).toBe(120);
    expect(w!.retain_failed_sandboxes_hours).toBe(6);

    // A connection test reports each dependency separately (FR-005a). This
    // seed configured none of them, so each must say so rather than "ok" —
    // and none may claim to have had a credential accepted, since none was
    // ever presented.
    await page.getByRole('button', { name: 'Test connection' }).click();
    const results = page.locator('.results li');
    await expect(results).toHaveCount(3, { timeout: 20_000 });
    await expect(page.locator('.results')).toContainText('Orchestration service');
    await expect(page.locator('.results')).toContainText('Container host');
    await expect(page.locator('.results')).toContainText('Design service');
    await expect(page.locator('.results')).not.toContainText('Reachable, and it accepted');
    // "Not configured yet" is a step not taken, and the screen must not
    // dress it up as a fault an administrator should go looking for.
    await expect(results.filter({ hasText: 'Not configured yet.' })).toHaveCount(2);
  });

  test('a ceiling of zero is refused, because it would stop every run', async ({
    page,
    context,
  }) => {
    const seeded = await seed();
    await signIn(context, seeded.adminId);
    await page.goto('/settings');

    await page.getByLabel('Most a run may spend, in dollars').fill('0');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('main')).toContainText(
      'A cost ceiling of zero would stop every run before it began',
      { timeout: 15_000 },
    );

    const [w] = await sql`select default_cost_ceiling_usd from workspaces`;
    expect(w!.default_cost_ceiling_usd).toBe('5.0000');
  });

  test('runs beyond the concurrency ceiling wait, and show their position (FR-082)', async ({
    page,
    context,
  }) => {
    const seeded = await seed({ tickets: 5, cap: 2 });
    await signIn(context, seeded.memberId);

    // Two runs hold sandboxes and three wait, so the positions are 1, 2, 3.
    // On their own ticket, the author sees which one they are — a number,
    // because "still queued" is not actionable and a number is.
    await page.goto(`/tickets/${seeded.ticketIds[4]}`);
    await expect(page.locator('.queued')).toContainText(
      'Waiting for a free sandbox — position 3 in the queue',
    );

    // And the third in line sees position 1, not "queued": first come, first
    // served, so the number follows creation order.
    await page.goto(`/tickets/${seeded.ticketIds[2]}`);
    await expect(page.locator('.queued')).toContainText('position 1 in the queue');

    // A run holding a sandbox shows no position at all.
    await page.goto(`/tickets/${seeded.ticketIds[0]}`);
    await expect(page.locator('.queued')).toHaveCount(0);

    // And the dashboard says the same thing, rather than the bare word
    // "queued" that a reader can do nothing with (FR-082).
    await page.goto('/');
    const waiting = page.locator('.card', { hasText: 'Active runs' });
    await expect(waiting).toContainText('position 3 in the queue');
    await expect(waiting).toContainText('position 1 in the queue');
    await expect(waiting).not.toContainText('queued');
  });

  test('an administrator sees the whole queue, in order', async ({ page, context }) => {
    const seeded = await seed({ tickets: 4, cap: 2 });
    await signIn(context, seeded.adminId);
    await page.goto('/settings');

    // Scoped to the queue: the members list on the same screen is also a
    // `.people`, so an unscoped locator would number the wrong rows.
    const queue = page.locator('.queue');
    await expect(queue).toContainText('executing', { timeout: 15_000 });

    // An interpolated number is its own text node, so assert on the region.
    await expect(queue).toContainText('2 of 2 executing');
    await expect(queue).toContainText('2 waiting');

    const rows = queue.locator('.people li');
    await expect(rows).toHaveCount(4);
    // Holders first, then waiters numbered from one: what makes the list
    // readable as a queue rather than a set.
    await expect(rows.nth(0)).toContainText(seeded.references[0] as string);
    await expect(rows.nth(0)).toContainText('executing');
    await expect(rows.nth(1)).toContainText('executing');
    await expect(rows.nth(2)).toContainText('position 1');
    await expect(rows.nth(3)).toContainText('position 2');
    await expect(rows.nth(3)).toContainText(seeded.references[3] as string);
  });

  test('a member cannot change credentials, connections or ceilings (FR-004)', async ({
    page,
    context,
  }) => {
    const seeded = await seed();
    await signIn(context, seeded.memberId);
    await page.goto('/settings');

    // The screen says why, and says what is NOT restricted.
    await expect(page.getByRole('main')).toContainText(
      'Workspace settings — credentials, connections, ceilings and membership — are for',
    );
    await expect(page.getByRole('main')).toContainText('anyone can make their own');

    // Nothing to change.
    await expect(page.getByLabel('Most a run may spend, in dollars')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Test connection' })).toHaveCount(0);

    // And the rule is not merely hidden: the remote function refuses too.
    const refused = await page.request.post('http://localhost:5173/settings', {
      failOnStatusCode: false,
      form: { name: 'Hijacked', defaultCostCeilingUsd: '999.0000' },
    });
    expect(refused.status()).toBeGreaterThanOrEqual(400);
    const [w] = await sql`select name, default_cost_ceiling_usd from workspaces`;
    expect(w!.default_cost_ceiling_usd).toBe('5.0000');
    expect(w!.name).not.toBe('Hijacked');
  });

  test('no stored credential is readable back in full (FR-011)', async ({ page, context }) => {
    const seeded = await seed();
    await signIn(context, seeded.adminId);

    // Store one through the interface.
    await page.goto('/settings');
    await page.getByLabel('Model credential').fill('sk-ant-supersecret-abcdefghij');
    await page.getByRole('button', { name: 'Store', exact: true }).click();
    // The success message, not the card's standing copy: a card that always
    // says "never shown again" would make this assertion prove nothing.
    await expect(page.getByRole('status').last()).toContainText('encrypted at rest', {
      timeout: 15_000,
    });

    // What is stored is not the value.
    const stored = await sql`
      select ciphertext from credentials where kind = 'model' order by created_at desc limit 1`;
    expect(stored[0]!.ciphertext).not.toContain('supersecret');

    // And nothing on the page holds it, on this visit or a fresh one.
    await page.reload();
    const body = await page.locator('body').innerText();
    expect(body).not.toContain('supersecret');
    expect(body).not.toContain('sk-ant');
    // The screen says one exists, which is the most it may say.
    await expect(page.getByRole('main')).toContainText('One is stored');
  });

  test("an administrator changes somebody else's role, and the change lands", async ({
    page,
    context,
  }) => {
    const seeded = await seed();
    await signIn(context, seeded.adminId);
    await page.goto('/settings');

    // Promoting rather than demoting: whether the LAST administrator may be
    // demoted depends on how many administrators the workspace has, which
    // every other spec is also seeding. That invariant is asserted in
    // tests/integration/members.test.ts, where the database is emptied first.
    await page.getByLabel(`Role for Member ${seeded.tag}`).selectOption('admin');
    // The select would show 'admin' from the click alone, so the assertion is
    // on the message, which only the server produces.
    await expect(page.getByRole('status').first()).toContainText('Now an administrator', {
      timeout: 15_000,
    });

    const [row] = await sql`select role from users where id = ${seeded.memberId}`;
    expect(row!.role).toBe('admin');
  });

  test('an administrator invites somebody, who arrives as a member', async ({ page, context }) => {
    const seeded = await seed();
    await signIn(context, seeded.adminId);
    await page.goto('/settings');

    await page.locator('form.invite').getByLabel('Name').fill(`Invited ${seeded.tag}`);
    await page.locator('form.invite').getByLabel('Email').fill(`invited-${seeded.tag}@x.dev`);
    await page.locator('form.invite').getByRole('button', { name: 'Invite' }).click();

    await expect(page.getByRole('main')).toContainText(`invited-${seeded.tag}@x.dev`, {
      timeout: 15_000,
    });
    const [row] = await sql`
      select role, password_hash from users where email = ${`invited-${seeded.tag}@x.dev`}`;
    expect(row!.role).toBe('member');
    // No password: signing in through a provider is the intended path, and an
    // unused invited account is not a credential anyone could guess.
    expect(row!.password_hash).toBeNull();
  });
});
