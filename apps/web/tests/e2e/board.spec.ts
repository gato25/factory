import { createHmac, randomUUID } from 'node:crypto';
import type { BrowserContext, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import postgres from 'postgres';
import { m } from '../../src/lib/i18n';

/**
 * User Story 4's Independent Test (specs/004-bento-redesign): tickets on
 * pipelines of three, six and eight steps draw three, six and eight segments
 * on every surface — the board, the dashboard, the creation form and the run
 * page — and a checkpoint reads as waiting for a person, not as work.
 */

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/factory';
const SESSION_SECRET = process.env.SESSION_SECRET ?? '';
const sql = postgres(DATABASE_URL, { max: 2, idle_timeout: 2, onnotice: () => {} });

type Json = postgres.JSONValue;
type Pipeline = { id: string; name: string; steps: Json[] };
type Seeded = {
  userId: string;
  tag: string;
  repositoryId: string;
  pipelines: { three: Pipeline; six: Pipeline; eight: Pipeline };
  tickets: { three: string; six: string; eight: string; skipped: string };
  agents: { writer: string; drawer: string };
};

async function seed(): Promise<Seeded> {
  const tag = randomUUID().slice(0, 8);
  await sql`insert into workspaces (name) values ('E2E') on conflict do nothing`;
  const [user] = await sql`
    insert into users (name, email, role)
    values ('Board Reader', ${`board-${tag}@x.dev`}, 'admin') returning id`;
  const userId = user!.id as string;
  const [credential] = await sql`
    insert into credentials (kind, ciphertext, key_version, status)
    values ('git', 'sealed', 'v1', 'valid') returning id`;
  const [repo] = await sql`
    insert into repositories (name, full_path, provider, clone_url, default_branch, credential_id, status)
    values (${`steps-${tag}`}, ${`netgroup/steps-${tag}`}, 'gitlab',
            'https://gitlab.com/netgroup/steps.git', 'main', ${credential!.id}, 'connected')
    returning id`;
  const agent = async (name: string, engine: string) => {
    const [row] = await sql`
      insert into agents (name, kind, owner_id, engine, model, system_prompt, allowed_tools)
      values (${`${name} ${tag}`}, 'custom', ${userId}, ${engine}, 'claude-sonnet-5', 'do it', '{Read}')
      returning id, name, engine, model, system_prompt, allowed_tools`;
    return row!;
  };
  const writer = await agent('Writer', 'claude_cli');
  const drawer = await agent('Drawer', 'design_cli');

  const work = { type: 'agent', condition: 'always', agent_id: writer.id, output_files: [] };
  const gate = { type: 'checkpoint', condition: 'always', approvers: 'anyone', on_timeout: 'wait' };
  const design = { type: 'design', condition: 'ticket_has_ui', agent_id: drawer.id };

  const pipeline = async (name: string, steps: Json[]): Promise<Pipeline> => {
    const [row] = await sql`
      insert into pipelines (name, owner_id, current_version) values (${`${name} ${tag}`}, ${userId}, 1)
      returning id`;
    await sql`insert into pipeline_versions (pipeline_id, version, steps)
              values (${row!.id}, 1, ${sql.json(steps)})`;
    return { id: row!.id as string, name: `${name} ${tag}`, steps };
  };
  // Two, five and seven steps: three, six and eight segments with the merge request.
  const three = await pipeline('Three', [work, work]);
  const six = await pipeline('Six', [work, design, gate, work, work]);
  const eight = await pipeline('Eight', [work, gate, work, gate, work, work, work]);

  const ticket = async (
    title: string,
    on: Pipeline,
    run: { status: string; current: number },
    skipped: { index: number; reason: string }[] = [],
  ) => {
    const reference = `#${Math.floor(Math.random() * 900_000) + 100_000}`;
    const runId = randomUUID();
    const status = run.status;
    const [row] = await sql`
      insert into tickets (repository_id, created_by, reference, title, acceptance_criteria,
        pipeline_id, pipeline_version, status, branch_name, current_run_id, has_ui, ui_rationale)
      values (${repo!.id}, ${userId}, ${reference}, ${title}, ${sql.array(['It is drawn right'])},
              ${on.id}, 1, ${status}, ${`factory/${tag}-${reference.slice(1)}`}, ${runId},
              false, 'It only changes the server.')
      returning id`;
    const snapshot = {
      run_id: runId,
      attempt: 1,
      ticket: { reference, title, description: null, acceptance_criteria: ['It is drawn right'] },
      repo: {
        clone_url: 'https://gitlab.com/netgroup/steps.git',
        default_branch: 'main',
        branch: `factory/${tag}`,
        provider: 'gitlab',
        credential_ref: credential!.id,
      },
      pipeline: { id: on.id, version: 1, name: on.name, steps: on.steps },
      limits: { cost_ceiling_usd: '5.0000', time_ceiling_minutes: 45 },
      agents: [writer, drawer].map((a) => ({
        id: a.id,
        name: a.name,
        engine: a.engine,
        model: a.model,
        system_prompt: a.system_prompt,
        allowed_tools: a.allowed_tools,
        skills: [],
        limits: {},
      })),
      callback_url: 'http://localhost:5173/api/hooks/orchestrator',
      resume_secret: `e2e-${randomUUID()}`,
    };
    await sql`
      insert into runs (id, ticket_id, attempt, snapshot, status, current_step_index,
        cost_ceiling_usd, time_ceiling_minutes, started_at)
      values (${runId}, ${row!.id}, 1, ${sql.json(snapshot)}, ${status}, ${run.current},
              '5.0000', 45, ${new Date(Date.now() - 20 * 60_000)})`;
    for (let index = 0; index < run.current; index++) {
      const skip = skipped.find((s) => s.index === index);
      await sql`
        insert into step_results (run_id, step_index, status, condition_not_met, started_at, finished_at, duration_s)
        values (${runId}, ${index}, ${skip ? 'skipped' : 'done'}, ${skip?.reason ?? null},
                ${new Date(Date.now() - 15 * 60_000)}, ${new Date(Date.now() - 10 * 60_000)}, ${skip ? null : 120})`;
    }
    if (status === 'running') {
      await sql`insert into step_results (run_id, step_index, status, started_at)
                values (${runId}, ${run.current}, 'running', ${new Date(Date.now() - 2 * 60_000)})`;
    }
    return row!.id as string;
  };

  return {
    userId,
    tag,
    repositoryId: repo!.id as string,
    pipelines: { three, six, eight },
    agents: { writer: writer.name as string, drawer: drawer.name as string },
    tickets: {
      three: await ticket(`Three steps ${tag}`, three, { status: 'running', current: 1 }),
      six: await ticket(`Six steps ${tag}`, six, { status: 'running', current: 3 }, [
        { index: 1, reason: 'the ticket does not change the interface' },
        { index: 2, reason: 'the ticket does not change the interface' },
      ]),
      // Waiting at its SECOND checkpoint.
      eight: await ticket(`Eight steps ${tag}`, eight, { status: 'waiting_approval', current: 3 }),
      skipped: await ticket(`Skipped design ${tag}`, six, { status: 'running', current: 4 }, [
        { index: 1, reason: 'the ticket does not change the interface' },
        { index: 2, reason: 'the ticket does not change the interface' },
      ]),
    },
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

const card = (page: Page, ticketId: string) => page.locator(`[data-ticket="${ticketId}"]`);

test.describe('a ticket drawn against its own pipeline (US4)', () => {
  test.skip(
    !SESSION_SECRET,
    'Needs SESSION_SECRET, to mint the same session cookie the app issues.',
  );
  test.use({ viewport: { width: 1440, height: 1024 } });

  test('the board and the dashboard draw 3, 6 and 8 segments', async ({ page, context }) => {
    const seeded = await seed();
    await signIn(context, seeded.userId);

    for (const path of ['/tickets', '/']) {
      await page.goto(path, { waitUntil: 'networkidle' });
      await expect(card(page, seeded.tickets.three).locator('.segment')).toHaveCount(3);
      await expect(card(page, seeded.tickets.six).locator('.segment')).toHaveCount(6);
      await expect(card(page, seeded.tickets.eight).locator('.segment')).toHaveCount(8);
    }
  });

  test('an 8-step ticket at its second checkpoint is in the approval colour, and says so', async ({
    page,
    context,
  }) => {
    const seeded = await seed();
    await signIn(context, seeded.userId);

    // On the board: the fourth segment is current, golden, and the card
    // names what the checkpoint gates.
    await page.goto('/tickets', { waitUntil: 'networkidle' });
    const onBoard = card(page, seeded.tickets.eight);
    await expect(
      page
        .getByRole('region', { name: new RegExp(`^${m.board.waitingApproval}: \\d+$`) })
        .locator(onBoard),
    ).toBeVisible();
    await expect(onBoard.locator('.segment').nth(3)).toHaveClass(/\bwait\b/);
    await expect(onBoard.locator('.segment.wait')).toHaveCount(1);
    await expect(onBoard.getByRole('img', { name: m.stepBar.label(4, 8) })).toBeVisible();
    await expect(onBoard).toContainText(m.ticketCard.approve(seeded.agents.writer));

    // On the dashboard: the same bar, and "waiting for your approval" in words.
    await page.goto('/', { waitUntil: 'networkidle' });
    const onDashboard = card(page, seeded.tickets.eight);
    await expect(onDashboard.locator('.segment').nth(3)).toHaveClass(/\bwait\b/);
    await expect(onDashboard.locator('.status')).toHaveText(m.dashboard.status.waiting);
  });

  test('the creation form: each pipeline its own step count, and exactly its steps', async ({
    page,
    context,
  }) => {
    const seeded = await seed();
    await signIn(context, seeded.userId);
    await page.goto('/tickets/new', { waitUntil: 'networkidle' });
    await page.locator('#repositoryId').selectOption(seeded.repositoryId);

    const pick = (pipeline: Pipeline) => page.locator(`[data-pipeline="${pipeline.id}"]`);
    const { three, six, eight } = seeded.pipelines;
    await expect(pick(three)).toContainText(m.newTicket.stepCount(3));
    await expect(pick(six)).toContainText(m.newTicket.stepCount(6));
    await expect(pick(eight)).toContainText(m.newTicket.stepCount(8));
    await expect(pick(eight).locator('.seg')).toHaveCount(8);

    // Choosing the six-step pipeline lists its five steps and the merge
    // request, the design step marked with its condition.
    await pick(six).click();
    const happen = page.getByRole('region', { name: m.newTicket.whatWillHappen });
    const steps = happen.locator('.steps > li');
    await expect(steps).toHaveCount(6);
    await expect(steps.nth(1)).toHaveAttribute('data-step-type', 'design');
    await expect(steps.nth(1).locator('.cond')).toHaveText(m.newTicket.condition.ticket_has_ui);
    await expect(steps.nth(2).locator('.n')).toHaveText(m.stepKind.checkpoint);
    await expect(steps.nth(5)).toHaveAttribute('data-step-type', 'merge_request');
    // Only the conditional one carries a condition.
    await expect(happen.locator('.cond')).toHaveCount(1);
    // Each agent step names its engine.
    await expect(steps.nth(0).locator('.e')).toHaveText('Claude Sonnet 5');
    await expect(steps.nth(1).locator('.e')).toHaveText(m.newTicket.onPen('Claude Sonnet 5'));

    await pick(three).click();
    await expect(steps).toHaveCount(3);
    await expect(happen.locator('.cond')).toHaveCount(0);
  });

  test('the run page: its own track, a skipped design step and why, the details in a tab', async ({
    page,
    context,
  }) => {
    const seeded = await seed();
    await signIn(context, seeded.userId);

    for (const [ticket, count] of [
      [seeded.tickets.three, 3],
      [seeded.tickets.six, 6],
      [seeded.tickets.eight, 8],
    ] as const) {
      await page.goto(`/tickets/${ticket}`, { waitUntil: 'networkidle' });
      await expect(page.locator('.track > li.step')).toHaveCount(count);
    }

    // The six-step ticket skipped its design step: it says so, and why.
    await page.goto(`/tickets/${seeded.tickets.skipped}`, { waitUntil: 'networkidle' });
    const design = page.locator('.track > li.step').nth(1);
    await expect(design).toHaveAttribute('data-step-state', 'skipped');
    await expect(design).toContainText(m.stepTracker.skipped);
    await expect(page.locator('.notes')).toContainText(
      m.stepTracker.skippedBecause(
        seeded.agents.drawer,
        'the ticket does not change the interface',
      ),
    );

    // The run's details are a tab of their own: the pipeline, the attempt,
    // the budget used of its cap — and no link to an orchestration service.
    await page.getByRole('tab', { name: m.run.tabDetails }).click();
    const details = page.getByRole('tabpanel');
    await expect(details).toContainText(seeded.pipelines.six.name);
    await expect(details).toContainText(m.runDetails.attemptOrdinal(1));
    await expect(details).toContainText(m.runDetails.budgetOf('0.0000', '5.0000'));
    await expect(details.getByRole('link')).toHaveCount(0);
    await expect(page.locator('a[href*="n8n"], a[href*="orchestrat"]')).toHaveCount(0);
  });
});
