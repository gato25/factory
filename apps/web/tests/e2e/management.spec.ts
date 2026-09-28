import { createHmac, randomUUID } from 'node:crypto';
import type { BrowserContext } from '@playwright/test';
import { expect, test } from '@playwright/test';
import postgres from 'postgres';
import { m } from '../../src/lib/i18n';
import { STEP_KIND_LABEL } from '../../src/lib/services/pipeline';

/**
 * User Story 6's Independent Test (specs/004-bento-redesign): the management
 * screens, rebuilt, still do what they did — and say it in the new look.
 *
 * 1. A repository whose token has expired is marked as needing attention on
 *    its own tile, with the way to replace the token right there.
 * 2. The connect dialog opens over the repositories page with its four
 *    numbered steps; settings carries the execution service's section — the
 *    address, a credential that is masked and never on the page, the
 *    callback address and a connection check — and no orchestration section.
 * 3. The builder tells agent, checkpoint, design, custom agent, shell and
 *    notify steps apart, by colour and in words.
 * Plus: an agent and a skill are edited and saved, and each agent tile names
 * the engine it runs on.
 *
 * Connecting, reordering and inserting steps are walked by ticket-to-mr and
 * pipeline-builder; this does not repeat them.
 */

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/factory';
const SESSION_SECRET = process.env.SESSION_SECRET ?? '';
const sql = postgres(DATABASE_URL, { max: 2, idle_timeout: 2, onnotice: () => {} });

type Seeded = {
  tag: string;
  adminId: string;
  expiredRepoId: string;
  pipelineId: string;
  shippedAgentId: string;
  customAgentId: string;
  designAgentId: string;
  skillId: string;
};

async function seed(): Promise<Seeded> {
  const tag = randomUUID().slice(0, 8);
  await sql`insert into workspaces (name) values ('E2E') on conflict do nothing`;
  const [admin] = await sql`
    insert into users (name, email, role)
    values (${`Manager ${tag}`}, ${`manager-${tag}@x.dev`}, 'admin') returning id`;
  const adminId = admin!.id as string;

  const [credential] = await sql`
    insert into credentials (kind, ciphertext, key_version, status)
    values ('git', 'sealed', 'v1', 'invalid') returning id`;
  const [repo] = await sql`
    insert into repositories (name, full_path, provider, clone_url, default_branch, credential_id, status)
    values (${`stale-${tag}`}, ${`netgroup/stale-${tag}`}, 'gitlab',
            'https://gitlab.com/netgroup/stale.git', 'main', ${credential!.id}, 'credential_expired')
    returning id`;

  const agent = async (name: string, engine: string, owner: string | null) => {
    const [row] = await sql`
      insert into agents (name, kind, owner_id, engine, model, system_prompt, allowed_tools)
      values (${`${name} ${tag}`}, ${owner ? 'custom' : 'default'}, ${owner}, ${engine},
              ${engine === 'design_cli' ? 'pen-default' : 'claude-sonnet-5'}, 'do the step', '{Read}')
      returning id`;
    return row!.id as string;
  };
  const shippedAgentId = await agent('Shipped', 'claude_cli', null);
  const customAgentId = await agent('Mine', 'claude_cli', adminId);
  const designAgentId = await agent('Drawer', 'design_cli', adminId);

  const steps = [
    {
      type: 'agent',
      condition: 'always',
      agent_id: shippedAgentId,
      output_files: ['docs/spec.md'],
    },
    { type: 'checkpoint', condition: 'always', approvers: 'anyone', on_timeout: 'wait' },
    { type: 'design', condition: 'ticket_has_ui', agent_id: designAgentId },
    { type: 'agent', condition: 'always', agent_id: customAgentId, output_files: [] },
    { type: 'shell', condition: 'always', command: 'bun test' },
    { type: 'notify', condition: 'always', channel: '#builds', template: 'done' },
  ];
  const [pipeline] = await sql`
    insert into pipelines (name, owner_id, current_version) values (${`Managed ${tag}`}, ${adminId}, 1)
    returning id`;
  await sql`insert into pipeline_versions (pipeline_id, version, steps)
            values (${pipeline!.id}, 1, ${sql.json(steps)})`;
  const [skill] = await sql`
    insert into skills (name, description, content, owner_id)
    values (${`managed-${tag}`}, 'How this workspace writes things down.', '# Rules', ${adminId})
    returning id`;

  return {
    tag,
    adminId,
    expiredRepoId: repo!.id as string,
    pipelineId: pipeline!.id as string,
    shippedAgentId,
    customAgentId,
    designAgentId,
    skillId: skill!.id as string,
  };
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

test.describe('managing the workspace in the new look', () => {
  test.skip(
    !SESSION_SECRET,
    'Needs SESSION_SECRET, to mint the same session cookie the app issues.',
  );
  test.afterAll(async () => {
    await sql.end();
  });

  test('an expired token marks its repository tile and offers the fix there (scenario 1)', async ({
    page,
    context,
  }) => {
    const seeded = await seed();
    await signIn(context, seeded.adminId);
    await page.goto('/repositories');

    const tile = page.locator(`[data-repository="${seeded.expiredRepoId}"]`);
    await expect(tile).toBeVisible({ timeout: 15_000 });
    // Needing attention, in colour and in words: the tile is tinted, and it
    // says what is wrong rather than leaving the colour to say it alone.
    await expect(tile).toHaveClass(/tile--danger/);
    await expect(tile.locator('.pill--fail')).toBeVisible();
    await expect(
      tile.getByRole('button', { name: m.repositories.replaceTokenShort }),
    ).toBeVisible();
  });

  test('the connect dialog opens over the repositories page with four numbered steps (scenario 2)', async ({
    page,
    context,
  }) => {
    const seeded = await seed();
    await signIn(context, seeded.adminId);
    await page.goto('/repositories');
    // The list arriving is the page being live; a click before it lands on
    // markup with no handler behind it.
    await expect(page.locator(`[data-repository="${seeded.expiredRepoId}"]`)).toBeVisible({
      timeout: 15_000,
    });

    await page.getByRole('button', { name: m.connect.open }).first().click();
    const dialog = page.locator('.modal');
    await expect(dialog).toBeVisible();
    // Over the page, not instead of it.
    await expect(page.locator(`[data-repository="${seeded.expiredRepoId}"]`)).toBeAttached();
    await expect(dialog.locator('.num')).toHaveText(['1', '2', '3', '4']);
    for (const title of [
      m.connect.stepProvider,
      m.connect.stepUrl,
      m.connect.stepToken,
      m.connect.stepPipeline,
    ]) {
      await expect(dialog.locator('.step-title', { hasText: title })).toBeVisible();
    }
  });

  test('settings has the execution service, its credential masked, and no orchestration section (scenario 2)', async ({
    page,
    context,
  }) => {
    const seeded = await seed();
    await signIn(context, seeded.adminId);
    await page.goto('/settings');

    const runner = page.locator('#runner');
    await expect(runner).toBeVisible({ timeout: 15_000 });
    await expect(runner.getByRole('heading', { name: m.settings.runner })).toBeVisible();
    // The address is the same field it always was, moved here.
    await expect(runner.locator('input[name="runnerBaseUrl"]')).toBeVisible();
    await expect(runner.getByText(m.settings.runnerToken, { exact: true })).toBeVisible();
    await expect(runner.getByText(m.settings.callback, { exact: true })).toBeVisible();
    await expect(runner).toContainText('/api/hooks/orchestrator');
    await expect(runner.getByRole('button', { name: m.settings.testConnection })).toBeVisible();

    // Whether the token is set, and never any part of it (Constitution V).
    const token = process.env.RUNNER_AUTH_TOKEN ?? '';
    const html = await page.content();
    if (token.length >= 8) {
      for (let at = 0; at + 8 <= token.length; at += 1) {
        expect(html).not.toContain(token.slice(at, at + 8));
      }
    }

    // The orchestration service is gone: no section, no menu entry, no word of it.
    await expect(page.locator('#orchestration')).toHaveCount(0);
    await expect(page.getByRole('main')).not.toContainText('n8n');
    await expect(page.getByRole('main')).not.toContainText(/orchestration service/i);
  });

  test('the builder tells its six kinds of step apart, by colour and in words (scenario 3)', async ({
    page,
    context,
  }) => {
    const seeded = await seed();
    await signIn(context, seeded.adminId);
    await page.goto(`/pipelines/${seeded.pipelineId}`);

    const nodes = page.locator('.node');
    await expect(nodes).toHaveCount(6, { timeout: 15_000 });
    const tones = ['plain', 'gate', 'design', 'custom', 'shell', 'notify'];
    for (const [index, tone] of tones.entries()) {
      await expect(nodes.nth(index)).toHaveClass(new RegExp(`\\b${tone}\\b`));
    }
    // Six colours, and words that do not depend on them.
    const backgrounds = await nodes.evaluateAll((all) =>
      all.map((node) => getComputedStyle(node.querySelector('.ic') as Element).backgroundImage),
    );
    expect(new Set(backgrounds).size).toBe(6);
    await expect(nodes.nth(1)).toContainText(STEP_KIND_LABEL.checkpoint);
    await expect(nodes.nth(3)).toContainText(m.stepNode.custom);
    await expect(nodes.nth(4)).toContainText(STEP_KIND_LABEL.shell);
    await expect(nodes.nth(5)).toContainText(STEP_KIND_LABEL.notify);
    // The design step's condition in words, never as a code (FR-032f).
    await expect(nodes.nth(2)).toContainText(m.newTicket.condition.ticket_has_ui);
    await expect(nodes.nth(2)).not.toContainText('ticket_has_ui');
  });

  test('an agent and a skill are edited and saved; each agent tile names its engine', async ({
    page,
    context,
  }) => {
    const seeded = await seed();
    await signIn(context, seeded.adminId);

    await page.goto('/agents');
    const mine = page.locator(`[data-agent="${seeded.customAgentId}"]`);
    const drawer = page.locator(`[data-agent="${seeded.designAgentId}"]`);
    await expect(mine.getByRole('img', { name: m.agentCard.claudeCli })).toBeVisible({
      timeout: 15_000,
    });
    await expect(drawer.getByRole('img', { name: m.agentCard.penCli })).toBeVisible();
    await expect(drawer).toContainText(m.agentCard.penCli);

    // The agent.
    await page.goto(`/agents/${seeded.customAgentId}`);
    await page.getByLabel(m.agentEditor.systemPrompt).fill('Plan the change, then stop.');
    await page.getByRole('button', { name: m.agentEditor.saveChanges }).click();
    await expect(page.getByRole('status').first()).toContainText(m.notice.agentSaved, {
      timeout: 15_000,
    });
    const [agent] = await sql`select system_prompt from agents where id = ${seeded.customAgentId}`;
    expect(agent!.system_prompt).toBe('Plan the change, then stop.');

    // The skill.
    await page.goto('/skills');
    await page.getByRole('button', { name: new RegExp(`managed-${seeded.tag}`) }).click();
    await expect(page.getByLabel(m.skills.content)).toHaveValue('# Rules', { timeout: 15_000 });
    await page.getByLabel(m.skills.content).fill('# Rules\n- Write plainly.');
    await page.getByRole('button', { name: m.skills.saveSkill }).click();
    // Seeded straight into the table, it has no history yet: this save is its first version.
    await expect(page.getByRole('status').first()).toContainText(m.skills.savedAs(1), {
      timeout: 15_000,
    });
    const [skill] = await sql`select content from skills where id = ${seeded.skillId}`;
    expect(skill!.content).toBe('# Rules\n- Write plainly.');
  });
});
