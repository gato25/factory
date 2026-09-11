import { createHmac, randomUUID } from 'node:crypto';
import type { BrowserContext } from '@playwright/test';
import { expect, test } from '@playwright/test';
import postgres from 'postgres';

/**
 * User Story 7's Independent Test (quickstart.md scenario G): as a MEMBER,
 * not an administrator, create an agent, change its instructions and model,
 * withhold a tool, attach a skill, and swap it into your own pipeline —
 * with no administrator involvement anywhere (SC-015).
 */

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/factory';
const SESSION_SECRET = process.env.SESSION_SECRET ?? '';

const sql = postgres(DATABASE_URL, { max: 4, idle_timeout: 2, onnotice: () => {} });

type Seeded = {
  tag: string;
  memberId: string;
  otherId: string;
  theirAgentId: string;
  shippedAgentId: string;
  pipelineId: string;
};

async function seed(): Promise<Seeded> {
  const tag = randomUUID().slice(0, 8);

  await sql`insert into workspaces (name) values ('E2E') on conflict do nothing`;
  const [member] = await sql`
    insert into users (name, email, role)
    values (${`Member ${tag}`}, ${`member-${tag}@x.dev`}, 'member') returning id`;
  const [other] = await sql`
    insert into users (name, email, role)
    values (${`Other ${tag}`}, ${`other-${tag}@x.dev`}, 'member') returning id`;

  // Someone else's agent: readable and usable, not changeable (FR-006c).
  const [theirs] = await sql`
    insert into agents (name, kind, owner_id, engine, model, system_prompt, allowed_tools)
    values (${`Theirs ${tag}`}, 'custom', ${other!.id}, 'claude_cli', 'claude-sonnet-5',
      'their instructions', '{Read}')
    returning id`;

  // A shipped default: no owner, and a stored configuration to go back to.
  const shippedConfig = {
    name: `Shipped ${tag}`,
    description: null,
    engine: 'claude_cli',
    model: 'claude-sonnet-5',
    systemPrompt: 'the shipped instructions',
    allowedTools: ['Read', 'Write'],
  };
  const [shipped] = await sql`
    insert into agents (name, kind, owner_id, engine, model, system_prompt, allowed_tools,
      default_config)
    values (${`Shipped ${tag}`}, 'default', null, 'claude_cli', 'claude-sonnet-5',
      'the shipped instructions', '{Read,Write}', ${sql.json(shippedConfig)})
    returning id`;

  // The member's own pipeline, so swapping an agent in needs nobody's help.
  const [pipeline] = await sql`
    insert into pipelines (name, owner_id, current_version)
    values (${`Mine ${tag}`}, ${member!.id}, 1) returning id`;
  await sql`insert into pipeline_versions (pipeline_id, version, steps, created_by)
            values (${pipeline!.id}, 1,
              ${sql.json([
                {
                  type: 'agent',
                  condition: 'always',
                  agent_id: shipped!.id,
                  output_files: ['docs/spec.md'],
                },
                { type: 'agent', condition: 'always', agent_id: shipped!.id, output_files: [] },
              ])},
              ${member!.id})`;

  return {
    tag,
    memberId: member!.id,
    otherId: other!.id,
    theirAgentId: theirs!.id,
    shippedAgentId: shipped!.id,
    pipelineId: pipeline!.id,
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

/**
 * The Skills screen decides what to open once it is running in the browser —
 * the artboard opens with a skill in the editor — so a click sent before
 * then lands on markup with no handler behind it. Waiting for that decision
 * is waiting for the page to be live.
 */
async function skillsReady(page: import('@playwright/test').Page) {
  await page.goto('/skills');
  await expect(page.getByText('Pick a skill on the left')).toHaveCount(0, { timeout: 15_000 });
}

test.describe('configuring the agents and their skills', () => {
  test.skip(
    !SESSION_SECRET,
    'Needs SESSION_SECRET, to mint the same session cookie the app issues.',
  );

  test('a member creates an agent, configures it, and swaps it in — alone (SC-015)', async ({
    page,
    context,
  }) => {
    const seeded = await seed();
    await signIn(context, seeded.memberId);

    // --- a skill first, so there is one to attach ---
    await skillsReady(page);
    await page.getByRole('button', { name: 'New' }).click();
    await page.getByLabel('Name').fill(`house-style-${seeded.tag}`);
    await page
      .getByLabel('Description (shown to the agent so it knows when to use this)')
      .fill('When writing anything a customer will read');
    await page.getByLabel('Content (Markdown)').fill('Write plainly. No exclamation marks.');
    await page.getByRole('button', { name: 'Create skill' }).click();
    await expect(page.getByText(`house-style-${seeded.tag}`).first()).toBeVisible({
      timeout: 15_000,
    });

    // --- their own agent ---
    await page.goto('/agents');
    await page.locator('form').getByLabel('Name').fill(`Planner ${seeded.tag}`);
    await page.locator('form').getByLabel('What it is for').fill('Turns a spec into a plan');
    await page.locator('form').getByRole('button', { name: 'Create' }).click();
    await expect(page.getByText(`Planner ${seeded.tag}`)).toBeVisible({ timeout: 15_000 });

    const [created] = await sql`
      select id, owner_id from agents where name = ${`Planner ${seeded.tag}`}`;
    // Owned by the member who made it — no administrator anywhere (FR-006a).
    expect(created!.owner_id).toBe(seeded.memberId);

    // --- change its instructions, model, tools and skills ---
    await page.goto(`/agents/${created!.id}`);
    await page.getByLabel('Instructions').fill('Read docs/spec.md and write docs/plan.md.');
    await page.getByLabel('Model').selectOption('claude-opus-5');

    // Withhold Bash: everything but it.
    for (const tool of ['Read', 'Write', 'Edit']) {
      await page.getByRole('checkbox', { name: new RegExp(`^${tool}\\b`) }).check();
    }
    await expect(page.getByRole('checkbox', { name: /^Bash\b/ })).not.toBeChecked();

    await page.getByRole('checkbox', { name: new RegExp(`house-style-${seeded.tag}`) }).check();
    await page.getByLabel('Most turns it may take').fill('25');

    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('status').first()).toContainText(
      'Runs already in flight are unaffected',
      { timeout: 15_000 },
    );

    const [saved] = await sql`
      select system_prompt, model, allowed_tools, max_turns from agents
      where id = ${created!.id}`;
    expect(saved!.system_prompt).toBe('Read docs/spec.md and write docs/plan.md.');
    expect(saved!.model).toBe('claude-opus-5');
    expect(saved!.allowed_tools.sort()).toEqual(['Edit', 'Read', 'Write']);
    // The withheld tool is absent, not merely discouraged (FR-039).
    expect(saved!.allowed_tools).not.toContain('Bash');
    expect(saved!.max_turns).toBe(25);

    const attached = await sql`
      select s.name from agent_skills a join skills s on s.id = a.skill_id
      where a.agent_id = ${created!.id}`;
    expect(attached.map((row) => row.name)).toEqual([`house-style-${seeded.tag}`]);

    // --- swap it into their own pipeline, still alone ---
    await page.goto(`/pipelines/${seeded.pipelineId}`);
    await page.getByRole('button', { name: /^Step 1 —/ }).click();
    await page
      .getByRole('combobox', { name: 'Agent', exact: true })
      .selectOption({ label: `Planner ${seeded.tag} — claude-opus-5` });
    await page.getByRole('button', { name: 'Save as version 2' }).click();
    await expect(page.getByRole('status').first()).toContainText('Saved as version 2', {
      timeout: 15_000,
    });

    const versions = await sql`
      select steps from pipeline_versions
      where pipeline_id = ${seeded.pipelineId} order by version`;
    expect(versions[1]!.steps[0].agent_id).toBe(created!.id);
    // And the version the run would have used before is untouched.
    expect(versions[0]!.steps[0].agent_id).toBe(seeded.shippedAgentId);
  });

  test("another member's agent is readable and usable, not changeable (FR-006c, FR-006d)", async ({
    page,
    context,
  }) => {
    const seeded = await seed();
    await signIn(context, seeded.memberId);
    await page.goto(`/agents/${seeded.theirAgentId}`);

    // Its owner is named (FR-006d).
    await expect(page.getByText(`Other ${seeded.tag}`).first()).toBeVisible();
    // An interpolated value is its own text node, which a getByText regex
    // will not span — the containing region is what to assert on.
    await expect(page.getByRole('main')).toContainText(`Changing it is for Other ${seeded.tag}`);

    // Readable: the instructions are there.
    await expect(page.getByLabel('Instructions')).toHaveValue('their instructions');
    // Not changeable.
    await expect(page.getByLabel('Instructions')).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);

    // Usable: it can still be chosen in a pipeline the member owns.
    await page.goto(`/pipelines/${seeded.pipelineId}`);
    await page.getByRole('button', { name: /^Step 1 —/ }).click();
    await expect(
      page.getByRole('combobox', { name: 'Agent', exact: true }).getByRole('option', {
        name: new RegExp(`Theirs ${seeded.tag}`),
      }),
    ).toHaveCount(1);
  });

  test('a design-engine agent offers that service models and no tool toggles (FR-036a)', async ({
    page,
    context,
  }) => {
    const seeded = await seed();
    await signIn(context, seeded.memberId);

    await page.goto('/agents');
    await page.locator('form').getByLabel('Name').fill(`Designer ${seeded.tag}`);
    await page.locator('form').getByLabel('Engine').selectOption('design_cli');
    await page.locator('form').getByRole('button', { name: 'Create' }).click();
    await expect(page.getByText(`Designer ${seeded.tag}`)).toBeVisible({ timeout: 15_000 });

    const [created] = await sql`
      select id from agents where name = ${`Designer ${seeded.tag}`}`;
    await page.goto(`/agents/${created!.id}`);

    // That service's own models, not the coding agent's.
    const models = page.getByLabel('Model');
    await expect(models.getByRole('option', { name: 'pen-default' })).toHaveCount(1);
    await expect(models.getByRole('option', { name: 'claude-opus-5' })).toHaveCount(0);

    // And no tool toggles at all — they do not apply.
    await expect(
      page.getByText('Tool permissions do not apply to the design service'),
    ).toBeVisible();
    await expect(page.getByRole('checkbox', { name: /^Bash\b/ })).toHaveCount(0);
  });

  test('resetting a modified default restores what shipped (FR-040)', async ({ page, context }) => {
    const seeded = await seed();
    // A shipped agent is administrator-only to change, so this is the one
    // place an administrator is needed — which is FR-006b, not a gap.
    const [admin] = await sql`
      insert into users (name, email, role)
      values (${`Admin ${seeded.tag}`}, ${`admin-${seeded.tag}@x.dev`}, 'admin') returning id`;
    await signIn(context, admin!.id);

    await page.goto(`/agents/${seeded.shippedAgentId}`);
    // Nothing to reset yet, and the button says so rather than lying.
    await expect(page.getByRole('button', { name: 'Reset to default' })).toBeDisabled();

    await page.getByLabel('Instructions').fill('my own version');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('status').first()).toContainText('Saved', { timeout: 15_000 });

    await expect(page.getByRole('button', { name: 'Reset to default' })).toBeEnabled();
    await page.getByRole('button', { name: 'Reset to default' }).click();
    await expect(page.getByRole('status').first()).toContainText(
      'Back to the configuration this agent shipped with',
      { timeout: 15_000 },
    );

    const [row] = await sql`
      select system_prompt, model, allowed_tools from agents where id = ${seeded.shippedAgentId}`;
    expect(row!.system_prompt).toBe('the shipped instructions');
    expect(row!.model).toBe('claude-sonnet-5');
    expect(row!.allowed_tools.sort()).toEqual(['Read', 'Write']);
  });

  test('a member cannot change a shipped agent, and is told what they can do (FR-006b)', async ({
    page,
    context,
  }) => {
    const seeded = await seed();
    await signIn(context, seeded.memberId);
    await page.goto(`/agents/${seeded.shippedAgentId}`);

    await expect(page.getByText('Shipped').first()).toBeVisible();
    await expect(page.getByRole('main')).toContainText('Changing it is for an administrator');
    await expect(page.getByLabel('Instructions')).toBeDisabled();

    // Duplicating is the way through, and the copy is theirs.
    await page.goto('/agents');
    await page
      .locator('.cell', { hasText: `Shipped ${seeded.tag}` })
      .getByRole('button', { name: 'Duplicate' })
      .click();
    await expect(page.getByRole('status')).toContainText('yours to change', { timeout: 15_000 });

    const [copy] = await sql`
      select owner_id, system_prompt from agents where name = ${`Shipped ${seeded.tag} (copy)`}`;
    expect(copy!.owner_id).toBe(seeded.memberId);
    expect(copy!.system_prompt).toBe('the shipped instructions');
  });

  test('a skill keeps what it said, and an old version can be brought back (T210)', async ({
    page,
    context,
  }) => {
    const seeded = await seed();
    await signIn(context, seeded.memberId);

    await skillsReady(page);
    await page.getByRole('button', { name: 'New' }).click();
    await page.getByLabel('Name').fill(`house-voice-${seeded.tag}`);
    await page
      .getByLabel('Description (shown to the agent so it knows when to use this)')
      .fill('When writing anything a customer will read');
    await page.getByLabel('Content (Markdown)').fill('# First\n- Write plainly.');
    await page.getByRole('button', { name: 'Create skill' }).click();
    await expect(
      page.getByRole('button', { name: new RegExp(`house-voice-${seeded.tag}`) }).first(),
    ).toBeVisible({ timeout: 15_000 });

    // --- change it ---
    await page
      .getByRole('button', { name: new RegExp(`house-voice-${seeded.tag}`) })
      .first()
      .click();
    await expect(page.getByLabel('Content (Markdown)')).toHaveValue('# First\n- Write plainly.');
    await page.getByLabel('Content (Markdown)').fill('# Second\n- No exclamation marks.');
    await page.getByRole('button', { name: 'Save skill' }).click();
    await expect(page.getByRole('status').first()).toContainText('Saved as version 2', {
      timeout: 15_000,
    });

    // --- the history holds both, and says who wrote each ---
    await page.getByRole('button', { name: 'History' }).click();
    await expect(page.getByRole('button', { name: /^v2 / })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: /^v1 / }).click();
    await expect(page.getByTestId('version-content')).toContainText('- Write plainly.');

    // --- bringing an old one back is a new version, not a rewrite ---
    await page.getByRole('button', { name: /Put version 1 in the editor/ }).click();
    await expect(page.getByLabel('Content (Markdown)')).toHaveValue('# First\n- Write plainly.');
    await page.getByRole('button', { name: 'Save skill' }).click();
    await expect(page.getByRole('status').first()).toContainText('Saved as version 3', {
      timeout: 15_000,
    });

    const kept = await sql`
      select v.version, v.content from skill_versions v join skills s on s.id = v.skill_id
      where s.name = ${`house-voice-${seeded.tag}`} order by v.version`;
    expect(kept.map((row) => row.content)).toEqual([
      '# First\n- Write plainly.',
      '# Second\n- No exclamation marks.',
      '# First\n- Write plainly.',
    ]);
  });
});
