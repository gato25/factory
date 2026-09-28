import { createHmac, randomUUID } from 'node:crypto';
import type { BrowserContext, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import postgres from 'postgres';
import { m } from '../../src/lib/i18n';

/**
 * User Story 2's Independent Test (specs/004-bento-redesign): visit one page
 * of every section and one nested page — a ticket, an agent, a pipeline — and
 * the right entry of the top bar is marked each time, and every entry leads
 * where it says (FR-001, FR-002, FR-003).
 *
 * The words are the catalogue's, not literals: the interface speaks the
 * deployment's language, and a test that spells out one language is a test
 * of that language rather than of the frame.
 */

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/factory';
const SESSION_SECRET = process.env.SESSION_SECRET ?? '';

const sql = postgres(DATABASE_URL, { max: 2, idle_timeout: 2, onnotice: () => {} });

type Seeded = {
  userId: string;
  ticketId: string;
  agentId: string;
  pipelineId: string;
  found: string;
  other: string;
};

async function seed(): Promise<Seeded> {
  const tag = randomUUID().slice(0, 8);
  await sql`insert into workspaces (name) values ('E2E') on conflict do nothing`;
  const [user] = await sql`
    insert into users (name, email, role) values ('Frame Walker', ${`frame-${tag}@x.dev`}, 'member')
    returning id`;
  const [repo] = await sql`
    insert into repositories (name, full_path, provider, clone_url, default_branch, status)
    values (${`frame-${tag}`}, ${`netgroup/frame-${tag}`}, 'gitlab',
            'https://gitlab.com/netgroup/frame.git', 'main', 'connected')
    returning id`;
  const [agent] = await sql`
    insert into agents (name, kind, owner_id, engine, model, system_prompt, allowed_tools)
    values (${`Frame agent ${tag}`}, 'custom', ${user!.id}, 'claude_cli', 'claude-sonnet-5',
            'do the work', '{Read}')
    returning id`;
  const [pipeline] = await sql`
    insert into pipelines (name, owner_id, current_version) values (${`Frame ${tag}`}, ${user!.id}, 1)
    returning id`;
  await sql`insert into pipeline_versions (pipeline_id, version, steps)
            values (${pipeline!.id}, 1, ${sql.json([{ type: 'agent', condition: 'always', agent_id: agent!.id }])})`;

  const found = `Searchable ${tag}`;
  const other = `Unrelated ${tag}`;
  const ticketIds: string[] = [];
  for (const title of [found, other]) {
    const reference = `#${Math.floor(Math.random() * 900_000) + 100_000}`;
    const [ticket] = await sql`
      insert into tickets (repository_id, created_by, reference, title, acceptance_criteria,
        pipeline_id, pipeline_version, status)
      values (${repo!.id}, ${user!.id}, ${reference}, ${title}, ${sql.array(['it works'])},
              ${pipeline!.id}, 1, 'draft')
      returning id`;
    ticketIds.push(ticket!.id);
  }
  return {
    userId: user!.id,
    ticketId: ticketIds[0] as string,
    agentId: agent!.id,
    pipelineId: pipeline!.id,
    found,
    other,
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

const SECTIONS = [
  m.topNav.dashboard,
  m.topNav.tickets,
  m.topNav.repositories,
  m.topNav.pipelines,
  m.topNav.agents,
  m.topNav.skills,
];

const bar = (page: Page) => page.getByRole('navigation', { name: m.topNav.label });

/** The one entry marked as where the person is, or none. */
async function marked(page: Page): Promise<string[]> {
  return bar(page)
    .locator('[aria-current="page"]')
    .evaluateAll((nodes) =>
      nodes.map((n) => (n.getAttribute('aria-label') ?? n.textContent ?? '').trim()),
    );
}

test.describe('the top bar', () => {
  test.skip(
    !SESSION_SECRET,
    'Needs SESSION_SECRET, to mint the same session cookie the app issues.',
  );

  let seeded: Seeded;
  test.beforeEach(async ({ context }) => {
    seeded = await seed();
    await signIn(context, seeded.userId);
  });

  test('holds the mark, the six sections, search, the create action, settings and the avatar — and no sidebar (FR-001)', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.locator('aside')).toHaveCount(0);

    const nav = bar(page);
    await expect(nav.getByRole('link', { name: m.topNav.home })).toBeVisible();
    for (const name of SECTIONS) {
      await expect(nav.getByRole('link', { name, exact: true })).toBeVisible();
    }
    await expect(nav.getByRole('searchbox', { name: m.topNav.searchLabel })).toBeVisible();
    await expect(nav.getByRole('link', { name: m.topNav.newTicket })).toHaveAttribute(
      'href',
      '/tickets/new',
    );
    await expect(nav.getByRole('link', { name: m.topNav.settings })).toHaveAttribute(
      'href',
      '/settings',
    );
    await expect(nav.getByText('FW', { exact: true })).toBeVisible();
  });

  test('every entry leads where it says', async ({ page }) => {
    const targets: [string, string][] = [
      [m.topNav.tickets, '/tickets'],
      [m.topNav.repositories, '/repositories'],
      [m.topNav.pipelines, '/pipelines'],
      [m.topNav.agents, '/agents'],
      [m.topNav.skills, '/skills'],
      [m.topNav.dashboard, '/'],
    ];
    await page.goto('/');
    for (const [name, path] of targets) {
      await bar(page).getByRole('link', { name, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`${path === '/' ? '/$' : `${path}$`}`));
    }
  });

  test('marks the section, including on pages nested under it (FR-002)', async ({ page }) => {
    const cases: [string, string][] = [
      ['/', m.topNav.dashboard],
      ['/tickets', m.topNav.tickets],
      [`/tickets/${seeded.ticketId}`, m.topNav.tickets],
      ['/repositories', m.topNav.repositories],
      [`/pipelines/${seeded.pipelineId}`, m.topNav.pipelines],
      [`/agents/${seeded.agentId}`, m.topNav.agents],
      ['/skills', m.topNav.skills],
    ];
    for (const [path, name] of cases) {
      await page.goto(path);
      await expect.poll(() => marked(page), { message: path }).toEqual([name]);
    }
  });

  test('on settings, marks settings and no section (FR-002)', async ({ page }) => {
    await page.goto('/settings');
    await expect.poll(() => marked(page)).toEqual([m.topNav.settings]);
  });

  test('search opens the board filtered by the text, as it did before (FR-003)', async ({
    page,
  }) => {
    await page.goto('/');
    const search = bar(page).getByRole('searchbox', { name: m.topNav.searchLabel });
    await search.fill(seeded.found);
    await search.press('Enter');
    await expect(page).toHaveURL(/\/tickets\?q=/);
    await expect(page.getByText(seeded.found).first()).toBeVisible();
    await expect(page.getByText(seeded.other)).toHaveCount(0);
  });

  test('every entry is reachable by keyboard, in order, with its focus visible (US2 scenario 5)', async ({
    page,
  }) => {
    await page.goto('/');
    const expected = [
      m.topNav.home,
      ...SECTIONS,
      m.topNav.searchLabel,
      m.topNav.newTicket,
      m.topNav.settings,
    ];
    const reached: string[] = [];
    for (let i = 0; i < expected.length; i++) {
      await page.keyboard.press('Tab');
      const focused = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el) return { name: '', visible: false };
        // A field's ring may be drawn on the field around the input
        // (`:focus-within`), which is where a person sees it.
        const shows = (node: Element | null) => {
          if (!node) return false;
          const s = getComputedStyle(node);
          return s.boxShadow !== 'none' || s.outlineStyle !== 'none';
        };
        const name =
          el.getAttribute('aria-label') ??
          (el.id ? document.querySelector(`label[for="${el.id}"]`)?.textContent : null) ??
          el.textContent ??
          '';
        return {
          name: name.trim(),
          visible: shows(el) || (el.matches('input') && shows(el.closest('form'))),
        };
      });
      expect(focused.visible, `focus is visible on ${focused.name}`).toBe(true);
      reached.push(focused.name);
    }
    expect(reached).toEqual(expected);
  });
});
