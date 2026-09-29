import { createHmac, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { BrowserContext, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import postgres from 'postgres';
import { m } from '../../src/lib/i18n';
import { freeReference } from './free-reference';

/**
 * What the person gave when they made the ticket is on the ticket.
 *
 * It was written once, on the form, and nothing afterwards showed it: the run
 * page had a title, the description was on no screen, the criteria appeared
 * only at a checkpoint, and an attached specification was a name and a size in
 * a tab. And the form itself failed on the second file — two documents picked
 * at once replaced the page with a 500 and created nothing.
 *
 * These drive the real form and the real pages, in a browser.
 */

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/factory';
const SESSION_SECRET = process.env.SESSION_SECRET ?? '';
const sql = postgres(DATABASE_URL, { max: 2, idle_timeout: 2, onnotice: () => {} });

/** The one row a statement returned. */
function one<T>(rows: readonly T[]): T {
  const [row] = rows;
  if (row === undefined) throw new Error('expected the statement to return a row');
  return row;
}

const DESCRIPTION = 'The cart must show a VAT line under the subtotal.';
const CRITERIA = ['VAT is ten percent of the subtotal', 'The total includes the VAT line'];
const SPEC = '# Checkout spec\n\nThe VAT rate is ten percent.\n';
const RATES = 'item,rate\nvat,10\n';

interface Seeded {
  tag: string;
  userId: string;
  repositoryId: string;
  pipelineId: string;
  pipelineName: string;
  steps: postgres.JSONValue[];
  agent: { id: string; name: string; engine: string; model: string };
  credentialId: string;
}

async function seed(): Promise<Seeded> {
  const tag = randomUUID().slice(0, 8);
  await sql`insert into workspaces (name) values ('E2E') on conflict do nothing`;
  const user = one(
    await sql`
    insert into users (name, email, role)
    values ('Brief Reader', ${`brief-${tag}@x.dev`}, 'admin') returning id`,
  );
  const credential = one(
    await sql`
    insert into credentials (kind, ciphertext, key_version, status)
    values ('git', 'sealed', 'v1', 'valid') returning id`,
  );
  const repo = one(
    await sql`
    insert into repositories (name, full_path, provider, clone_url, default_branch, credential_id, status)
    values (${`brief-${tag}`}, ${`netgroup/brief-${tag}`}, 'gitlab',
            'https://gitlab.com/netgroup/brief.git', 'main', ${credential.id}, 'connected')
    returning id`,
  );
  const agent = one(
    await sql`
    insert into agents (name, kind, owner_id, engine, model, system_prompt, allowed_tools)
    values (${`Writer ${tag}`}, 'custom', ${user.id}, 'claude_cli', 'claude-sonnet-5', 'write', '{Read}')
    returning id, name, engine, model`,
  );
  const steps = [
    { type: 'agent', condition: 'always', agent_id: agent.id, output_files: ['docs/spec.md'] },
  ];
  const pipelineName = `Brief ${tag}`;
  const pipeline = one(
    await sql`
    insert into pipelines (name, owner_id, current_version) values (${pipelineName}, ${user.id}, 1)
    returning id`,
  );
  await sql`insert into pipeline_versions (pipeline_id, version, steps)
            values (${pipeline.id}, 1, ${sql.json(steps as postgres.JSONValue[])})`;
  return {
    tag,
    userId: user.id as string,
    repositoryId: repo.id as string,
    pipelineId: pipeline.id as string,
    pipelineName,
    steps: steps as postgres.JSONValue[],
    agent: agent as unknown as Seeded['agent'],
    credentialId: credential.id as string,
  };
}

/** A ticket with what a person wrote, its documents, and — when asked — a queued run. */
async function ticket(
  seeded: Seeded,
  options: { title: string; run: boolean; pipeline?: boolean },
) {
  const reference = await freeReference(sql);
  const runId = options.run ? randomUUID() : null;
  const withPipeline = options.pipeline !== false;
  const row = one(
    await sql`
    insert into tickets (repository_id, created_by, reference, title, description, acceptance_criteria,
      pipeline_id, pipeline_version, status, branch_name, current_run_id)
    values (${seeded.repositoryId}, ${seeded.userId}, ${reference}, ${options.title}, ${DESCRIPTION},
            ${sql.array(CRITERIA)}, ${withPipeline ? seeded.pipelineId : null},
            ${withPipeline ? 1 : null}, ${options.run ? 'queued' : 'draft'},
            ${`factory/${seeded.tag}-${reference.slice(1)}`}, ${runId})
    returning id`,
  );
  const ticketId = row.id as string;
  for (const [name, type, content] of [
    ['checkout-spec.md', 'text/markdown', SPEC],
    ['rates.csv', 'text/csv', RATES],
  ] as const) {
    await sql`
      insert into ticket_files (ticket_id, name, content_type, bytes, content, uploaded_by)
      values (${ticketId}, ${name}, ${type}, ${Buffer.byteLength(content)}, ${content}, ${seeded.userId})`;
  }
  if (runId) {
    const snapshot = {
      run_id: runId,
      attempt: 1,
      ticket: {
        reference,
        title: options.title,
        description: DESCRIPTION,
        acceptance_criteria: CRITERIA,
      },
      repo: {
        clone_url: 'https://gitlab.com/netgroup/brief.git',
        default_branch: 'main',
        branch: `factory/${seeded.tag}`,
        provider: 'gitlab',
        credential_ref: seeded.credentialId,
      },
      pipeline: {
        id: seeded.pipelineId,
        version: 1,
        name: seeded.pipelineName,
        steps: seeded.steps,
      },
      limits: { cost_ceiling_usd: '5.0000', time_ceiling_minutes: 45 },
      agents: [
        {
          ...seeded.agent,
          system_prompt: 'write',
          allowed_tools: ['Read'],
          skills: [],
          limits: {},
        },
      ],
      callback_url: 'http://localhost:5173/api/hooks/orchestrator',
      resume_secret: `e2e-${randomUUID()}`,
    };
    await sql`
      insert into runs (id, ticket_id, attempt, snapshot, status, cost_ceiling_usd, time_ceiling_minutes)
      values (${runId}, ${ticketId}, 1, ${sql.json(snapshot)}, 'queued', '5.0000', 45)`;
  }
  return { ticketId, reference, runId };
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

/** Errors the page itself raised, so a test can say there were none. */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

test.describe('what was asked, on the ticket', () => {
  test.skip(
    !SESSION_SECRET,
    'Needs SESSION_SECRET, to mint the same session cookie the app issues.',
  );

  test('the form takes two documents at once, and the ticket keeps both', async ({
    page,
    context,
  }) => {
    const seeded = await seed();
    await signIn(context, seeded.userId);
    const errors = watchErrors(page);
    const title = `Two documents ${seeded.tag}`;

    await page.goto('/tickets/new', { waitUntil: 'networkidle' });
    await page.selectOption('#repositoryId', seeded.repositoryId);
    await page.locator('.pick', { hasText: seeded.pipelineName }).click();
    await page.fill('#title', title);
    await page.fill('#description', DESCRIPTION);
    await page.fill('#acceptanceCriteria', CRITERIA.join('\n'));
    await page.setInputFiles('input[type=file]', [
      { name: 'checkout-spec.md', mimeType: 'text/markdown', buffer: Buffer.from(SPEC) },
      { name: 'rates.csv', mimeType: 'text/csv', buffer: Buffer.from(RATES) },
    ]);
    await page.getByRole('button', { name: m.newTicket.saveAsDraft }).click();

    // Saved — not a page of "Form cannot contain duplicated keys".
    await expect(page.locator('.banner.good')).toContainText(/#\d+/);
    await expect(page.getByText('duplicated keys')).toHaveCount(0);
    const stored = await sql`
      select f.name from ticket_files f join tickets t on t.id = f.ticket_id
       where t.title = ${title} order by f.name`;
    expect(stored.map((row) => row.name)).toEqual(['checkout-spec.md', 'rates.csv']);
    // And no error on every pick, which the development server raised even for one.
    expect(errors.filter((message) => message.includes('multiple'))).toEqual([]);
  });

  test('two documents attached from the ticket page are both kept', async ({ page, context }) => {
    const seeded = await seed();
    await signIn(context, seeded.userId);
    const made = await ticket(seeded, { title: `Attach ${seeded.tag}`, run: false });
    const errors = watchErrors(page);

    await page.goto(`/tickets/${made.ticketId}`, { waitUntil: 'networkidle' });
    await page.setInputFiles('input[type=file]', [
      { name: 'a-notes.md', mimeType: 'text/markdown', buffer: Buffer.from('# Notes\n') },
      { name: 'b-limits.txt', mimeType: 'text/plain', buffer: Buffer.from('ten per cent\n') },
    ]);
    await page.getByRole('button', { name: m.files.attach }).click();

    // Beside the two it already had, in the list, without a reload.
    for (const name of ['a-notes.md', 'b-limits.txt', 'checkout-spec.md', 'rates.csv']) {
      await expect(page.getByRole('button', { name: m.files.view(name) })).toBeVisible();
    }
    const stored = await sql`select name from ticket_files where ticket_id = ${made.ticketId}`;
    expect(stored).toHaveLength(4);
    expect(errors.filter((message) => message.includes('multiple'))).toEqual([]);
  });

  test('a started ticket shows what was asked, and the documents can be read', async ({
    page,
    context,
  }) => {
    const seeded = await seed();
    await signIn(context, seeded.userId);
    const made = await ticket(seeded, { title: `Started ${seeded.tag}`, run: true });

    await page.goto(`/tickets/${made.ticketId}`, { waitUntil: 'domcontentloaded' });
    const brief = page.locator('[data-brief]');
    await expect(brief).toBeVisible();
    await expect(brief).toContainText(m.brief.heading);
    await expect(brief.locator('[data-brief-description]')).toContainText(DESCRIPTION);
    for (const criterion of CRITERIA) {
      await expect(brief.locator('[data-brief-criteria]')).toContainText(criterion);
    }
    // The documents are named where the brief is, and read in their own tab.
    await expect(brief.locator('[data-brief-documents]')).toContainText('checkout-spec.md');
    await expect(brief.locator('[data-brief-documents]')).toContainText('rates.csv');
    await brief.getByRole('button', { name: new RegExp(m.brief.readDocuments) }).click();
    await expect(page.getByRole('tab', { name: m.run.tabRequirements })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    // A Markdown document is rendered; anything else is shown as written.
    await page.getByRole('button', { name: m.files.view('checkout-spec.md') }).click();
    const rendered = page.locator('[data-file-view]').first();
    await expect(rendered.getByRole('heading', { name: 'Checkout spec' })).toBeVisible();
    await expect(rendered).toContainText('The VAT rate is ten percent.');

    await page.getByRole('button', { name: m.files.view('rates.csv') }).click();
    await expect(page.locator('[data-file-view] pre')).toContainText('vat,10');
  });

  test('a ticket saved as a draft shows what was asked, and can be started', async ({
    page,
    context,
  }) => {
    const seeded = await seed();
    await signIn(context, seeded.userId);
    const made = await ticket(seeded, { title: `Draft ${seeded.tag}`, run: false });

    // A stand-in execution service that takes whatever run it is handed, so
    // starting does not spend half a minute retrying one that is not there.
    const received: string[] = [];
    const service: Server = createServer((request, response) => {
      received.push(`${request.method} ${request.url}`);
      request.resume();
      request.on('end', () => {
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ execution_id: 'e2e-execution' }));
      });
    });
    await new Promise<void>((resolve) => service.listen(0, '127.0.0.1', resolve));
    const address = `http://127.0.0.1:${(service.address() as AddressInfo).port}`;
    const workspace = one(
      await sql`
      select id, runner_base_url from workspaces order by created_at limit 1`,
    );
    await sql`update workspaces set runner_base_url = ${address} where id = ${workspace.id}`;

    try {
      await page.goto(`/tickets/${made.ticketId}`, { waitUntil: 'domcontentloaded' });
      // Not a bare "not started": the ticket, and what was asked.
      await expect(page.getByRole('heading', { name: `Draft ${seeded.tag}` })).toBeVisible();
      await expect(page.locator('[data-draft-note]')).toContainText(m.run.draftNote);
      const brief = page.locator('[data-brief]');
      await expect(brief.locator('[data-brief-description]')).toContainText(DESCRIPTION);
      await expect(brief.locator('[data-brief-criteria]')).toContainText(CRITERIA[0] as string);
      // Its documents are right below, readable.
      await page.getByRole('button', { name: m.files.view('checkout-spec.md') }).click();
      await expect(page.locator('[data-file-view]')).toContainText('The VAT rate is ten percent.');

      await page.getByRole('button', { name: m.run.startTicket }).click();

      // It has a run now: the page is the run's, queued, and the service was handed it.
      await expect(page.locator('.title-row .pill')).toContainText(m.run.statusQueued, {
        timeout: 15_000,
      });
      expect(received.some((line) => /^POST \/runs\/[0-9a-f-]{36}\/execute$/.test(line))).toBe(
        true,
      );
      // And what was asked is still there, now beside the run.
      await expect(page.locator('[data-brief-description]')).toContainText(DESCRIPTION);
    } finally {
      await sql`update workspaces set runner_base_url = ${workspace.runner_base_url} where id = ${workspace.id}`;
      await new Promise((resolve) => service.close(resolve));
    }
  });

  test('a draft that cannot be started says why, and stays a draft', async ({ page, context }) => {
    const seeded = await seed();
    await signIn(context, seeded.userId);
    // Saved with no pipeline chosen, which a draft may be.
    const made = await ticket(seeded, {
      title: `No pipeline ${seeded.tag}`,
      run: false,
      pipeline: false,
    });

    await page.goto(`/tickets/${made.ticketId}`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: m.run.startTicket }).click();

    // The service's own sentence — not "Internal Error", not a raw payload.
    await expect(
      page.getByRole('status').filter({ hasText: m.conflicts.noPinnedVersion }),
    ).toBeVisible();
    await expect(page.locator('[data-draft-note]')).toBeVisible();
    const runs = await sql`select count(*)::int as n from runs where ticket_id = ${made.ticketId}`;
    expect(one(runs).n).toBe(0);
  });
});
