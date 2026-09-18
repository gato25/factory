import { createHmac, randomUUID } from 'node:crypto';
import type { BrowserContext } from '@playwright/test';
import { expect, test } from '@playwright/test';
import postgres from 'postgres';

/**
 * User Story 6's Independent Test (quickstart.md scenario F): build a
 * pipeline with a non-default order including a gate and a shell step, save
 * it, and confirm a run executes exactly those steps in that order — while a
 * run started before the edit continues on the old arrangement (SC-010).
 * Plus the three refusals, each with a stated reason.
 */

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/factory';
const SESSION_SECRET = process.env.SESSION_SECRET ?? '';

const sql = postgres(DATABASE_URL, { max: 4, idle_timeout: 2, onnotice: () => {} });

type Seeded = {
  tag: string;
  userId: string;
  pipelineId: string;
  ticketId: string;
  runId: string;
  specAgentId: string;
  implementAgentId: string;
  designAgentId: string;
};

/** A pipeline owned by the signed-in person, with a run already in flight. */
async function seed(): Promise<Seeded> {
  const tag = randomUUID().slice(0, 8);
  const runId = randomUUID();

  await sql`insert into workspaces (name) values ('E2E') on conflict do nothing`;
  const [user] = await sql`
    insert into users (name, email, role)
    values ('Lead', ${`lead-${tag}@x.dev`}, 'member') returning id`;
  const [credential] = await sql`
    insert into credentials (kind, ciphertext, key_version, status)
    values ('git', 'sealed', 'v1', 'valid') returning id`;
  const [repo] = await sql`
    insert into repositories (name, full_path, provider, clone_url, default_branch,
      credential_id, status)
    values ('shop', ${`netgroup/shop-${tag}`}, 'gitlab',
      'https://gitlab.com/netgroup/shop.git', 'main', ${credential!.id}, 'connected')
    returning id`;
  const [spec] = await sql`
    insert into agents (name, kind, engine, model, system_prompt, allowed_tools)
    values (${`Spec ${tag}`}, 'custom', 'claude_cli', 'claude-sonnet-5', 'spec', '{Read,Write}')
    returning id`;
  const [implement] = await sql`
    insert into agents (name, kind, engine, model, system_prompt, allowed_tools)
    values (${`Implement ${tag}`}, 'custom', 'claude_cli', 'claude-opus-5', 'build', '{Read,Edit}')
    returning id`;
  const [designer] = await sql`
    insert into agents (name, kind, engine, model, system_prompt, allowed_tools)
    values (${`Design ${tag}`}, 'custom', 'design_cli', 'pen-default', 'design', '{}')
    returning id`;
  const [pipeline] = await sql`
    insert into pipelines (name, description, owner_id, current_version)
    values (${`Pipeline ${tag}`}, 'Built in the builder', ${user!.id}, 1) returning id`;

  const steps = [
    { type: 'agent', condition: 'always', agent_id: spec!.id, output_files: ['docs/spec.md'] },
    { type: 'agent', condition: 'always', agent_id: implement!.id, output_files: [] },
  ];
  await sql`insert into pipeline_versions (pipeline_id, version, steps, created_by)
            values (${pipeline!.id}, 1, ${sql.json(steps)}, ${user!.id})`;
  await sql`update repositories set default_pipeline_id = ${pipeline!.id}
            where id = ${repo!.id}`;

  const reference = `#${Math.floor(Math.random() * 90_000) + 10_000}`;
  const [ticket] = await sql`
    insert into tickets (repository_id, created_by, reference, title, acceptance_criteria,
      pipeline_id, pipeline_version, status, branch_name, current_run_id)
    values (${repo!.id}, ${user!.id}, ${reference}, 'Something in flight',
      ${sql.array(['It works'])}, ${pipeline!.id}, 1, 'running', ${`factory/${tag}-x`}, ${runId})
    returning id`;

  const snapshot = {
    run_id: runId,
    attempt: 1,
    ticket: {
      reference,
      title: 'Something in flight',
      description: null,
      acceptance_criteria: ['It works'],
    },
    repo: {
      clone_url: 'https://gitlab.com/netgroup/shop.git',
      default_branch: 'main',
      branch: `factory/${tag}-x`,
      provider: 'gitlab',
      credential_ref: credential!.id,
    },
    pipeline: { id: pipeline!.id, version: 1, name: `Pipeline ${tag}`, steps },
    limits: { cost_ceiling_usd: '5.0000', time_ceiling_minutes: 45 },
    agents: [],
    callback_url: 'http://localhost:5173/api/hooks/orchestrator',
    resume_secret: `e2e-${randomUUID()}`,
  };
  await sql`insert into runs (id, ticket_id, attempt, snapshot, status, cost_ceiling_usd,
              time_ceiling_minutes, started_at)
            values (${runId}, ${ticket!.id}, 1, ${sql.json(snapshot)}, 'running', '5.0000', 45,
              now())`;

  return {
    tag,
    userId: user!.id,
    pipelineId: pipeline!.id,
    ticketId: ticket!.id,
    runId,
    specAgentId: spec!.id,
    implementAgentId: implement!.id,
    designAgentId: designer!.id,
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

test.describe('composing the pipeline', () => {
  test.skip(
    !SESSION_SECRET,
    'Needs SESSION_SECRET, to mint the same session cookie the app issues.',
  );

  test('a non-default order with a gate and a shell step saves, and the in-flight run is untouched', async ({
    page,
    context,
  }) => {
    const seeded = await seed();
    await signIn(context, seeded.userId);
    await page.goto(`/pipelines/${seeded.pipelineId}`);

    // The two steps it starts with, and the implicit last one (FR-029).
    await expect(page.getByText('Хувилбар 1')).toBeVisible();
    await expect(page.getByText('Нэгтгэх хүсэлт нээх')).toBeVisible();
    await expect(
      page.getByText('Дамжлага бүр эндээ дуусна. Үүнийг зөөх ч, устгах ч боломжгүй.'),
    ).toBeVisible();
    // How many repositories use it, before anyone changes it (FR-030).
    await expect(page.getByText('1 репозитори ашиглаж байна')).toBeVisible();
    // And the run in flight is named, with what saving will not do to it.
    await expect(page.getByText('1 ажиллагаа явагдаж байна')).toBeVisible();

    // --- add a review gate between the two steps, from the connector's + ---
    await page.getByLabel('2-р байрлалд алхам оруулах').click();
    // Scoped to the popover just opened: the side panel offers the same
    // palette, so an unscoped match is ambiguous.
    await page
      .locator('.picker')
      .getByRole('button', { name: 'Хүний хяналтын цэг', exact: true })
      .click();
    await expect(page.getByText('2-р алхам — Хүний хяналтын цэг')).toBeVisible();

    // Its approvers, waiting time and expiry behaviour (FR-032).
    await page.getByLabel('Энэ хяналтын цэгийг хэн шийдэх вэ?').selectOption('ticket_creator');
    await page.getByLabel('Хэдэн цаг хүлээх вэ').fill('8');
    await page.getByLabel('Тэр хугацаа дуусахад').selectOption('fail');

    // --- and a shell step at the end ---
    await page.getByLabel('Төгсгөлд алхам нэмэх').click();
    await page
      .locator('.picker')
      .getByRole('button', { name: 'Shell команд', exact: true })
      .click();
    await page.getByRole('textbox', { name: 'Команд' }).fill('bun test');

    // SC-010 is stated before the save, not discovered after it.
    await expect(page.getByRole('status')).toContainText(
      'Saving does not affect it: each continues on the version it started with',
    );

    await page.getByRole('button', { name: '2-р хувилбар болгон хадгалах' }).click();
    await expect(page.getByRole('status').first()).toContainText('2-р хувилбар болгон хадгаллаа', {
      timeout: 15_000,
    });
    await expect(page.getByRole('status').first()).toContainText(
      '1 run already in flight continues on the version it started with',
    );

    // Exactly those steps, in exactly that order.
    const saved = await sql`
      select version, steps from pipeline_versions
      where pipeline_id = ${seeded.pipelineId} order by version`;
    expect(saved).toHaveLength(2);
    expect(saved[1]!.steps.map((s: { type: string }) => s.type)).toEqual([
      'agent',
      'checkpoint',
      'agent',
      'shell',
    ]);
    const checkpoint = saved[1]!.steps[1];
    expect(checkpoint.approvers).toBe('ticket_creator');
    expect(checkpoint.timeout_hours).toBe(8);
    expect(checkpoint.on_timeout).toBe('fail');
    expect(saved[1]!.steps[3].command).toBe('bun test');

    // Version 1 is untouched, and the run in flight still reads it (SC-010).
    expect(saved[0]!.steps.map((s: { type: string }) => s.type)).toEqual(['agent', 'agent']);
    const [run] = await sql`select snapshot, status from runs where id = ${seeded.runId}`;
    expect(run!.status).toBe('running');
    expect(run!.snapshot.pipeline.version).toBe(1);
    expect(run!.snapshot.pipeline.steps.map((s: { type: string }) => s.type)).toEqual([
      'agent',
      'agent',
    ]);
  });

  test('the three refusals each state a reason (FR-028, FR-032d, FR-032e)', async ({
    page,
    context,
  }) => {
    const seeded = await seed();
    await signIn(context, seeded.userId);
    await page.goto(`/pipelines/${seeded.pipelineId}`);

    // --- FR-028: remove the code-producing step ---
    await page.getByRole('button', { name: '2-р алхмын үйлдэл' }).click();
    await page.getByRole('button', { name: '2-р алхмыг устгах' }).click();
    await expect(page.getByText(/This pipeline has no step that writes code/)).toBeVisible();
    await expect(page.getByRole('button', { name: /^Save as version/ })).toBeDisabled();

    // Put it back, and the refusal goes away.
    await page.getByLabel('Төгсгөлд алхам нэмэх').click();
    await page.locator('.picker').getByRole('button', { name: 'Агент алхам', exact: true }).click();
    await page
      .getByRole('combobox', { name: 'Агент', exact: true })
      .selectOption({ label: `Implement ${seeded.tag} — claude-opus-5` });
    await expect(page.getByText(/no step that writes code/)).toHaveCount(0);

    // --- FR-032e: a design step before the step that classifies ---
    await page.getByLabel('1-р байрлалд алхам оруулах').click();
    await page
      .locator('.picker')
      .getByRole('button', { name: 'Дизайн алхам', exact: true })
      .click();
    await expect(page.getByText(/Step 1 is a design step/)).toBeVisible();
    await expect(page.getByText(/before the specification step that decides/)).toBeVisible();
    await page.getByRole('button', { name: '1-р алхмын үйлдэл' }).click();
    await page.getByRole('button', { name: '1-р алхмыг устгах' }).click();

    // --- FR-032d: a condition before its fact is established ---
    await page.getByLabel('1-р байрлалд алхам оруулах').click();
    await page
      .locator('.picker')
      .getByRole('button', { name: 'Хүний хяналтын цэг', exact: true })
      .click();
    await page
      .getByLabel('Энэ алхам хэзээ ажиллах вэ?')
      .selectOption('зөвхөн энэ даалгавар интерфейс өөрчилдөг бол');
    await expect(
      page.getByText(/Step 1 runs only if this ticket changes the interface/),
    ).toBeVisible();
    // The fact, in words rather than as a code.
    await expect(
      page.getByText(/whether the ticket changes the interface is not known yet/),
    ).toBeVisible();
    await expect(page.getByText('ticket_has_ui')).toHaveCount(0);

    // Nothing was saved through any of it.
    const versions = await sql`
      select count(*)::int as n from pipeline_versions where pipeline_id = ${seeded.pipelineId}`;
    expect(versions[0]!.n).toBe(1);
  });

  test('a pipeline someone else owns can be read but not changed (FR-006c)', async ({
    page,
    context,
  }) => {
    const seeded = await seed();
    const [other] = await sql`
      insert into users (name, email, role)
      values ('Visitor', ${`visitor-${randomUUID().slice(0, 8)}@x.dev`}, 'member') returning id`;
    await signIn(context, other!.id);

    await page.goto(`/pipelines/${seeded.pipelineId}`);
    await expect(page.getByText(/you can use it, not change it/)).toBeVisible();
    // Readable: the steps are all there.
    await expect(page.getByText('Нэгтгэх хүсэлт нээх')).toBeVisible();
    // Not changeable: no save, no palette, no remove.
    await expect(page.getByRole('button', { name: /^Save as version/ })).toHaveCount(0);
    await expect(page.getByLabel('Төгсгөлд алхам нэмэх')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '1-р алхмыг устгах' })).toHaveCount(0);
  });

  test('a pipeline can be duplicated, and the copy is the copier own (FR-031)', async ({
    page,
    context,
  }) => {
    const seeded = await seed();
    await signIn(context, seeded.userId);
    await page.goto('/pipelines');

    const [name] = await sql`select name from pipelines where id = ${seeded.pipelineId}`;
    await page
      .locator('li', { hasText: name!.name })
      .getByRole('button', { name: 'Хуулбарлах' })
      .click();
    await expect(page.getByText(/Duplicated as/)).toBeVisible({ timeout: 15_000 });

    const copies = await sql`
      select id, name, owner_id, current_version from pipelines
      where name = ${`${name!.name} (copy)`}`;
    expect(copies).toHaveLength(1);
    expect(copies[0]!.owner_id).toBe(seeded.userId);
    expect(copies[0]!.current_version).toBe(1);
    // The steps came across.
    const copied = await sql`
      select steps from pipeline_versions where pipeline_id = ${copies[0]!.id}`;
    expect(copied[0]!.steps).toHaveLength(2);
  });
});
