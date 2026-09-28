import { execFileSync } from 'node:child_process';
import { createHmac, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import type { BrowserContext, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import postgres from 'postgres';
import { m } from '../../src/lib/i18n';

/**
 * User Story 1's Independent Test (specs/004-bento-redesign): with tickets in
 * each state and a history of finished runs, open the dashboard; every ticket
 * is under the right heading with a bar of the right length, and the three
 * figures match the run records. One test per acceptance scenario.
 *
 * The suite shares its database with the others, so a heading's count is
 * checked against the records it summarises rather than against a constant.
 */

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/factory';
const SESSION_SECRET = process.env.SESSION_SECRET ?? '';
const sql = postgres(DATABASE_URL, { max: 2, idle_timeout: 2, onnotice: () => {} });

const MINUTE = 60_000;

type Seeded = {
  userId: string;
  tag: string;
  running3: string;
  running6: string;
  waiting: string;
  failed: string;
  queued: { ticketId: string; runId: string; secret: string };
  unstarted: string;
  done: string;
  agentName: string;
};

async function seed(): Promise<Seeded> {
  const tag = randomUUID().slice(0, 8);
  await sql`insert into workspaces (name) values ('E2E') on conflict do nothing`;
  const [user] = await sql`
    insert into users (name, email, role)
    values ('Dashboard Reader', ${`dashboard-${tag}@x.dev`}, 'admin') returning id`;
  const userId = user!.id as string;
  const [credential] = await sql`
    insert into credentials (kind, ciphertext, key_version, status)
    values ('git', 'sealed', 'v1', 'valid') returning id`;
  const [repo] = await sql`
    insert into repositories (name, full_path, provider, clone_url, default_branch, credential_id, status)
    values (${`board-${tag}`}, ${`netgroup/board-${tag}`}, 'gitlab',
            'https://gitlab.com/netgroup/board.git', 'main', ${credential!.id}, 'connected')
    returning id`;
  const agentName = `Writer ${tag}`;
  const [agent] = await sql`
    insert into agents (name, kind, owner_id, engine, model, system_prompt, allowed_tools)
    values (${agentName}, 'custom', ${userId}, 'claude_cli', 'claude-sonnet-5', 'write', '{Read}')
    returning id, name, engine, model, system_prompt, allowed_tools`;

  const agentStep = { type: 'agent', condition: 'always', agent_id: agent!.id, output_files: [] };
  const checkpoint = {
    type: 'checkpoint',
    condition: 'always',
    approvers: 'anyone',
    on_timeout: 'wait',
  };
  const pipeline = async (name: string, steps: postgres.JSONValue[]) => {
    const [row] = await sql`
      insert into pipelines (name, owner_id, current_version) values (${`${name} ${tag}`}, ${userId}, 1)
      returning id`;
    await sql`insert into pipeline_versions (pipeline_id, version, steps)
              values (${row!.id}, 1, ${sql.json(steps)})`;
    return { id: row!.id as string, name: `${name} ${tag}`, steps };
  };
  // Two and five steps: bars of three and six segments with the merge request.
  const short = await pipeline('Short', [agentStep, agentStep]);
  const long = await pipeline('Long', [agentStep, checkpoint, agentStep, agentStep, agentStep]);

  const ticket = async (
    title: string,
    status: string,
    on: typeof short,
    run?: { status: string; current: number | null; finished?: Date; failure?: string },
    createdAt = new Date(),
  ) => {
    const reference = `#${Math.floor(Math.random() * 900_000) + 100_000}`;
    const runId = run ? randomUUID() : null;
    const secret = `e2e-${randomUUID()}`;
    const [row] = await sql`
      insert into tickets (repository_id, created_by, reference, title, acceptance_criteria,
        pipeline_id, pipeline_version, status, branch_name, current_run_id, merge_request_url, created_at)
      values (${repo!.id}, ${userId}, ${reference}, ${title}, ${sql.array(['It is on the dashboard'])},
              ${on.id}, 1, ${status}, ${`factory/${tag}-${reference.slice(1)}`}, ${runId},
              ${status === 'done' ? 'https://gitlab.com/netgroup/board/-/merge_requests/88' : null},
              ${createdAt})
      returning id`;
    if (run && runId) {
      const snapshot = {
        run_id: runId,
        attempt: 1,
        ticket: { reference, title, description: null, acceptance_criteria: [] },
        repo: {
          clone_url: 'https://gitlab.com/netgroup/board.git',
          default_branch: 'main',
          branch: `factory/${tag}`,
          provider: 'gitlab',
          credential_ref: credential!.id,
        },
        pipeline: { id: on.id, version: 1, name: on.name, steps: on.steps },
        limits: { cost_ceiling_usd: '5.0000', time_ceiling_minutes: 45 },
        agents: [
          {
            id: agent!.id,
            name: agent!.name,
            engine: agent!.engine,
            model: agent!.model,
            system_prompt: agent!.system_prompt,
            allowed_tools: agent!.allowed_tools,
            skills: [],
            limits: {},
          },
        ],
        callback_url: 'http://localhost:5173/api/hooks/orchestrator',
        resume_secret: secret,
      };
      await sql`
        insert into runs (id, ticket_id, attempt, snapshot, status, current_step_index,
          cost_ceiling_usd, time_ceiling_minutes, failure_reason, failure_step_index, started_at, finished_at)
        values (${runId}, ${row!.id}, 1, ${sql.json(snapshot)}, ${run.status}, ${run.current},
                '5.0000', 45, ${run.failure ?? null}, ${run.failure ? run.current : null},
                ${run.status === 'queued' ? null : new Date(Date.now() - 10 * MINUTE)},
                ${run.finished ?? null})`;
      if (run.status === 'running') {
        await sql`insert into step_results (run_id, step_index, status, started_at)
                  values (${runId}, ${run.current}, 'running', ${new Date(Date.now() - 4 * MINUTE)})`;
      }
    }
    return { ticketId: row!.id as string, runId: runId as string, secret };
  };

  return {
    userId,
    tag,
    agentName,
    running3: (
      await ticket(`Short running ${tag}`, 'running', short, { status: 'running', current: 0 })
    ).ticketId,
    running6: (
      await ticket(`Long running ${tag}`, 'running', long, { status: 'running', current: 3 })
    ).ticketId,
    waiting: (
      await ticket(`Waiting ${tag}`, 'waiting_approval', long, {
        status: 'waiting_approval',
        current: 1,
      })
    ).ticketId,
    failed: (
      await ticket(`Failed ${tag}`, 'failed', short, {
        status: 'failed',
        current: 1,
        failure: 'The tests failed.',
      })
    ).ticketId,
    queued: await ticket(`Queued ${tag}`, 'queued', short, { status: 'queued', current: null }),
    unstarted: (await ticket(`Unstarted ${tag}`, 'queued', long)).ticketId,
    done: (
      await ticket(`Done ${tag}`, 'done', short, {
        status: 'done',
        current: 1,
        finished: new Date(Date.now() - MINUTE),
      })
    ).ticketId,
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

const group = (page: Page, name: string) =>
  page.getByRole('region', { name: new RegExp(`^${name}: \\d+$`) });
const row = (page: Page, ticketId: string) => page.locator(`[data-ticket="${ticketId}"]`);

/** A heading's count, read off the screen. */
async function countOf(page: Page, name: string): Promise<number> {
  const label = (await group(page, name).getAttribute('aria-label')) ?? '';
  return Number(label.split(': ').at(-1));
}

test.describe('the dashboard (US1)', () => {
  test.skip(
    !SESSION_SECRET,
    'Needs SESSION_SECRET, to mint the same session cookie the app issues.',
  );
  test.use({ viewport: { width: 1440, height: 1024 } });

  test('1: tickets appear under four headings, each with its count', async ({ page, context }) => {
    const seeded = await seed();
    await signIn(context, seeded.userId);
    await page.goto('/', { waitUntil: 'networkidle' });

    const { groups } = m.dashboard;
    for (const id of [seeded.running3, seeded.running6, seeded.waiting]) {
      await expect(group(page, groups.inProgress).locator(row(page, id))).toBeVisible();
    }
    await expect(
      group(page, groups.needsAttention).locator(row(page, seeded.failed)),
    ).toBeVisible();
    for (const id of [seeded.queued.ticketId, seeded.unstarted]) {
      await expect(group(page, groups.queued).locator(row(page, id))).toBeVisible();
    }
    await expect(group(page, groups.done).locator(row(page, seeded.done))).toBeVisible();

    // Each count is the number of tickets the records put in that state.
    const [counts] = await sql`
      select
        count(*) filter (where r.status in ('running', 'waiting_approval', 'opening_mr'))::int as progress,
        count(*) filter (where r.status = 'failed' or (r.id is null and t.status = 'failed'))::int as attention,
        count(*) filter (where (r.status = 'queued' or t.status = 'queued')
                           and coalesce(r.status::text, '') not in ('running', 'waiting_approval', 'opening_mr', 'failed'))::int as queued,
        count(*) filter (where t.status = 'done' and r.finished_at >= now() - interval '7 days'
                           and r.status not in ('running', 'waiting_approval', 'opening_mr', 'failed', 'queued'))::int as done
      from tickets t left join runs r on r.id = t.current_run_id`;
    expect(await countOf(page, groups.inProgress)).toBe(counts!.progress);
    expect(await countOf(page, groups.needsAttention)).toBe(counts!.attention);
    expect(await countOf(page, groups.queued)).toBe(counts!.queued);
    expect(await countOf(page, groups.done)).toBe(counts!.done);
  });

  test('2: bars of three and six segments, the step in words and how long it has run', async ({
    page,
    context,
  }) => {
    const seeded = await seed();
    await signIn(context, seeded.userId);
    await page.goto('/', { waitUntil: 'networkidle' });

    const short = row(page, seeded.running3);
    const long = row(page, seeded.running6);
    await expect(short.getByRole('img', { name: m.stepBar.label(1, 3) })).toBeVisible();
    await expect(long.getByRole('img', { name: m.stepBar.label(4, 6) })).toBeVisible();
    await expect(short.locator('.segment')).toHaveCount(3);
    await expect(long.locator('.segment')).toHaveCount(6);
    await expect(short).toContainText(m.stepBar.count(1, 3));
    const said = m.dashboard.status.running(
      m.defaults.running(seeded.agentName),
      m.dashboard.elapsed(4),
    );
    await expect(short.locator('.status')).toHaveText(said);
    // A checkpoint reads as waiting for a person, in the approval colour.
    await expect(row(page, seeded.waiting).locator('.status')).toHaveText(
      m.dashboard.status.waiting,
    );
    await expect(row(page, seeded.waiting).locator('.status')).toHaveClass(/pill--wait/);
  });

  test('3: the first-attempt figure and its count equal the audit (SC-004)', async ({
    page,
    context,
  }) => {
    const seeded = await seed();
    await signIn(context, seeded.userId);
    await page.goto('/', { waitUntil: 'networkidle' });

    // The audit, run without exclusions over the same window, prints "N of M".
    const audit = execFileSync(
      'bun',
      [resolve(process.cwd(), '../../scripts/audit/first-attempt-rate.ts'), '--since', '30d'],
      { env: { ...process.env, DATABASE_URL }, encoding: 'utf8' },
    );
    const [, successes, counted] = audit.match(/(\d+) of (\d+) on the first attempt/) ?? [];
    expect(counted, audit).toBeDefined();
    const rate = Math.round((Number(successes) / Number(counted)) * 100);
    const tile = page.getByRole('region', { name: m.dashboard.firstAttempt.label });
    await expect(tile.locator('[data-rate]')).toHaveText(`${rate}%`);
    await expect(tile).toContainText(
      m.dashboard.firstAttempt.counted(Number(successes), Number(counted)),
    );
  });

  test('4: with nothing decided, it says there is nothing to measure — never 0%', async ({
    page,
    context,
  }) => {
    const seeded = await seed();
    await signIn(context, seeded.userId);
    // Move every decided ticket of the window out of it, and back afterwards.
    const moved = await sql`
      update tickets set created_at = created_at - interval '400 days'
       where created_at >= now() - interval '30 days' and status not in ('draft')
       returning id`;
    try {
      await page.goto('/', { waitUntil: 'networkidle' });
      const tile = page.getByRole('region', { name: m.dashboard.firstAttempt.label });
      await expect(tile).toContainText(m.dashboard.firstAttempt.nothing);
      await expect(tile).not.toContainText('%');
    } finally {
      await sql`update tickets set created_at = created_at + interval '400 days'
                 where id in ${sql(moved.map((r) => r.id as string))}`;
    }
  });

  test("5: seven bars oldest first, today marked, the week's total and today's cost", async ({
    page,
    context,
  }) => {
    const seeded = await seed();
    await signIn(context, seeded.userId);
    await page.goto('/', { waitUntil: 'networkidle' });

    const week = page.getByRole('region', { name: m.dashboard.week.title });
    const days = week.locator('.day');
    await expect(days).toHaveCount(7);
    await expect(days.nth(6)).toHaveClass(/today/);
    await expect(days.nth(6)).toHaveAttribute('aria-label', new RegExp(m.dashboard.week.today));
    const counts = await days.evaluateAll((els) =>
      els.map((el) => Number(el.getAttribute('data-count'))),
    );
    const dates = await days.evaluateAll((els) =>
      els.map((el) => el.getAttribute('data-date') ?? ''),
    );
    expect([...dates].sort()).toEqual(dates);
    // Our own done run finished a minute ago.
    expect(counts[6]).toBeGreaterThanOrEqual(1);
    await expect(week.locator('[data-total]')).toHaveText(
      String(counts.reduce((a, b) => a + b, 0)),
    );

    const [cost] = await sql`
      select coalesce(sum(cost_usd), 0)::numeric(12, 4)::text as total from step_results
       where finished_at >= date_trunc('day', now())`;
    await expect(week.locator('[data-cost]')).toHaveText(`$${Number(cost!.total).toFixed(2)}`);
    await expect(week).toContainText(m.dashboard.week.costToday);
  });

  test('6: a callback that moves a run moves its row, without a reload', async ({
    page,
    context,
  }) => {
    const seeded = await seed();
    await signIn(context, seeded.userId);
    await page.goto('/', { waitUntil: 'networkidle' });
    const { ticketId, runId, secret } = seeded.queued;
    await expect(group(page, m.dashboard.groups.queued).locator(row(page, ticketId))).toBeVisible();

    const callback = (body: Record<string, unknown>) =>
      page.request.post('http://localhost:5173/api/hooks/orchestrator', {
        headers: { authorization: `Bearer ${secret}` },
        data: { run_id: runId, attempt: 1, ...body },
      });
    await callback({ step_index: 0, event: 'started', container_id: 'container-e2e' });
    await callback({ step_index: 0, event: 'step_started' });
    await expect(
      group(page, m.dashboard.groups.inProgress).locator(row(page, ticketId)),
    ).toBeVisible({
      timeout: 5_000,
    });
  });

  test('7: a workspace not set up says what is missing, above everything else', async ({
    page,
    context,
  }) => {
    const seeded = await seed();
    await signIn(context, seeded.userId);
    const [workspace] =
      await sql`select id, runner_base_url from workspaces order by created_at limit 1`;
    await sql`update workspaces set runner_base_url = null where id = ${workspace!.id}`;
    try {
      await page.goto('/', { waitUntil: 'networkidle' });
      const notice = page
        .getByRole('status')
        .filter({ hasText: m.dashboard.missing['the runner address']! });
      await expect(notice).toBeVisible();
      await expect(notice.getByRole('link', { name: m.nav.settings })).toHaveAttribute(
        'href',
        '/settings',
      );
      const first = await page.locator('main > *').first().getAttribute('class');
      expect(first).toContain('notice');
    } finally {
      await sql`update workspaces set runner_base_url = ${workspace!.runner_base_url} where id = ${workspace!.id}`;
    }
  });
});
