import { createHmac, randomUUID } from 'node:crypto';
import type { APIRequestContext, BrowserContext } from '@playwright/test';
import { expect, test } from '@playwright/test';
import postgres from 'postgres';

/**
 * User Story 5's Independent Test (quickstart.md scenario E): two tickets
 * through the same pipeline. The interface one is classified, designed and
 * reviewed before any code is planned; the migration one records the design
 * step as skipped with its reason, spends nothing on design, and still
 * reaches a merge request (FR-111, SC-018). Plus the honest-failure case:
 * no usable decision, and the warning is on the run (FR-102).
 */

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/factory';
const SESSION_SECRET = process.env.SESSION_SECRET ?? '';

const sql = postgres(DATABASE_URL, { max: 4, idle_timeout: 2, onnotice: () => {} });

/** A 1×1 PNG, so the image route serves something a browser will render. */
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64',
);

type Seeded = { ticketId: string; runId: string; secret: string; userId: string; tag: string };

/** spec → design (only when the interface changes) → implement. */
async function seed(): Promise<Seeded> {
  const secret = `e2e-${randomUUID()}`;
  const runId = randomUUID();
  const tag = randomUUID().slice(0, 8);

  await sql`insert into workspaces (name) values ('E2E') on conflict do nothing`;
  const [user] = await sql`
    insert into users (name, email, role)
    values ('Designer', ${`design-${tag}@x.dev`}, 'member') returning id`;
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
    values ('Spec', 'default', 'claude_cli', 'claude-sonnet-5', 'write the spec', '{Read,Write}')
    returning id`;
  const [designer] = await sql`
    insert into agents (name, kind, engine, model, system_prompt, allowed_tools)
    values ('Design', 'default', 'design_cli', 'pen-default', 'design it', '{}')
    returning id`;
  const [build] = await sql`
    insert into agents (name, kind, engine, model, system_prompt, allowed_tools)
    values ('Implement', 'default', 'claude_cli', 'claude-opus-5', 'build it', '{Read,Edit}')
    returning id`;
  const [pipeline] = await sql`
    insert into pipelines (name, current_version) values ('Designed', 1) returning id`;

  const steps = [
    { type: 'agent', condition: 'always', agent_id: spec!.id, output_files: ['docs/spec.md'] },
    { type: 'design', condition: 'ticket_has_ui', agent_id: designer!.id },
    { type: 'checkpoint', condition: 'ticket_has_ui', approvers: 'anyone', on_timeout: 'wait' },
    { type: 'agent', condition: 'always', agent_id: build!.id, output_files: [] },
  ];
  await sql`insert into pipeline_versions (pipeline_id, version, steps)
            values (${pipeline!.id}, 1, ${sql.json(steps)})`;

  const reference = `#${Math.floor(Math.random() * 90_000) + 10_000}`;
  const [ticket] = await sql`
    insert into tickets (repository_id, created_by, reference, title, description,
      acceptance_criteria, pipeline_id, pipeline_version, status, branch_name, current_run_id)
    values (${repo!.id}, ${user!.id}, ${reference}, 'Add Google OAuth sign-in',
      'Users should be able to sign in with Google.',
      ${sql.array(['A Google button appears on the sign-in screen'])},
      ${pipeline!.id}, 1, 'running', ${`factory/${tag}-oauth`}, ${runId})
    returning id`;

  const agent = (id: string, name: string, engine: string, model: string) => ({
    id,
    name,
    engine,
    model,
    system_prompt: 'do the work',
    allowed_tools: engine === 'design_cli' ? [] : ['Read', 'Write'],
    skills: [],
    limits: {},
  });

  const snapshot = {
    run_id: runId,
    attempt: 1,
    ticket: {
      reference,
      title: 'Add Google OAuth sign-in',
      description: 'Users should be able to sign in with Google.',
      acceptance_criteria: ['A Google button appears on the sign-in screen'],
    },
    repo: {
      clone_url: 'https://gitlab.com/netgroup/shop.git',
      default_branch: 'main',
      branch: `factory/${tag}-oauth`,
      provider: 'gitlab',
      credential_ref: credential!.id,
    },
    pipeline: { id: pipeline!.id, version: 1, name: 'Designed', steps },
    limits: { cost_ceiling_usd: '5.0000', time_ceiling_minutes: 45 },
    agents: [
      agent(spec!.id, 'Spec', 'claude_cli', 'claude-sonnet-5'),
      agent(designer!.id, 'Design', 'design_cli', 'pen-default'),
      agent(build!.id, 'Implement', 'claude_cli', 'claude-opus-5'),
    ],
    callback_url: 'http://localhost:5173/api/hooks/n8n',
    resume_secret: secret,
  };

  await sql`insert into runs (id, ticket_id, attempt, snapshot, status, cost_ceiling_usd,
              time_ceiling_minutes, started_at)
            values (${runId}, ${ticket!.id}, 1, ${sql.json(snapshot)}, 'running', '5.0000', 45,
              now())`;

  return { ticketId: ticket!.id, runId, secret, userId: user!.id, tag };
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

function callbacks(request: APIRequestContext, seeded: Seeded) {
  return (body: Record<string, unknown>) =>
    request.post('http://localhost:5173/api/hooks/n8n', {
      headers: { authorization: `Bearer ${seeded.secret}` },
      data: { run_id: seeded.runId, attempt: 1, ...body },
    });
}

/** The runner uploads the bytes; the orchestrator only names the artifact. */
async function fillScreens(runId: string) {
  await sql`update artifacts set bytes = ${PIXEL} where run_id = ${runId} and kind = 'screen'`;
}

test.describe('designing the interface before building it', () => {
  test.skip(
    !SESSION_SECRET,
    'Needs SESSION_SECRET, to mint the same session cookie the app issues.',
  );

  test('an interface ticket is classified, designed and reviewed before any code', async ({
    page,
    context,
  }) => {
    const seeded = await seed();
    await signIn(context, seeded.userId);
    const post = callbacks(page.request, seeded);

    // --- the specification step classifies, with a one-sentence reason ---
    await post({
      step_index: 0,
      event: 'ticket_classified',
      has_ui: true,
      rationale: 'A Google button appears on the sign-in screen.',
    });
    await post({
      step_index: 0,
      event: 'step_finished',
      status: 'done',
      duration_s: 9,
      cost_usd: '0.2000',
      artifacts: [{ kind: 'document', path: 'docs/spec.md', version: 1 }],
    });

    // --- the design step produces a source and one image per screen ---
    await post({ step_index: 1, event: 'step_started' });
    await post({
      step_index: 1,
      event: 'step_finished',
      status: 'done',
      duration_s: 34,
      cost_usd: '0.3100',
      artifacts: [
        { kind: 'design_file', path: 'docs/design/ui.pen', version: 1 },
        {
          kind: 'screen',
          path: 'docs/design/screens/00-sign-in.png',
          version: 1,
          screen_name: 'sign in',
        },
        {
          kind: 'screen',
          path: 'docs/design/screens/01-callback.png',
          version: 1,
          screen_name: 'callback',
        },
      ],
    });
    await fillScreens(seeded.runId);

    // --- and the run pauses for design review ---
    await post({
      step_index: 2,
      event: 'waiting_approval',
      resume_url: 'http://localhost:5173/api/hooks/n8n',
      approvers: [],
    });

    await page.goto(`/tickets/${seeded.ticketId}/design`);

    // Every screen as an image, the criteria beside them, the reason, and a
    // statement that no code has been written yet (FR-064d).
    await expect(page.getByRole('heading', { name: /Add Google OAuth sign-in/ })).toBeVisible();
    await expect(page.getByText('Nothing has been implemented yet')).toBeVisible();
    await expect(page.getByText('A Google button appears on the sign-in screen.')).toBeVisible();
    await expect(
      page.getByText('A Google button appears on the sign-in screen', { exact: true }),
    ).toBeVisible();

    const thumbnails = page.locator('img[src^="/api/artifacts/"]');
    await expect(thumbnails).toHaveCount(2);

    // The route serves EXACTLY the artifact's bytes. A Uint8Array from the
    // driver is a view into a pooled buffer, so it is easy to send the pool
    // by accident — and the browser then decodes nothing.
    const src = await thumbnails.first().getAttribute('src');
    const served = await page.request.get(`http://localhost:5173${src}`);
    expect(served.status()).toBe(200);
    expect(served.headers()['content-type']).toBe('image/png');
    expect((await served.body()).length).toBe(PIXEL.length);

    // And the browser really decoded it: a wrong body would be zero-width.
    await thumbnails.first().scrollIntoViewIfNeeded();
    await expect
      .poll(() => thumbnails.first().evaluate((img: HTMLImageElement) => img.naturalWidth))
      .toBeGreaterThan(0);

    // Openable at full size, with next and previous (FR-077).
    await page
      .getByRole('button', { name: /sign in/ })
      .first()
      .click();
    const viewer = page.getByRole('dialog');
    await expect(viewer).toBeVisible();
    await expect(viewer.getByText('1 of 2')).toBeVisible();
    await viewer.getByRole('button', { name: 'Next screen' }).click();
    await expect(viewer.getByText('2 of 2')).toBeVisible();
    await expect(viewer.getByText('docs/design/screens/01-callback.png')).toBeVisible();
    await viewer.getByRole('button', { name: 'Close' }).click();
    await expect(viewer).toBeHidden();

    // A link that opens the committed design source (FR-064e).
    const source = page.getByRole('link', { name: 'Open the design source' });
    await expect(source).toHaveAttribute(
      'href',
      `https://gitlab.com/netgroup/shop/-/blob/factory%2F${seeded.tag}-oauth/docs/design/ui.pen`,
    );

    // --- request changes: the design is revised, not redrawn ---
    await page
      .locator('textarea[name="feedback"]')
      .fill('The Google button is below the fold on a phone.');
    await page.getByRole('button', { name: 'Request changes' }).click();
    await expect(page.getByText(/Already decided:\s*changes requested/)).toBeVisible({
      timeout: 10_000,
    });

    const [decision] = await sql`
      select decision, feedback from approvals
      where run_id = ${seeded.runId} and step_index = 2`;
    expect(decision!.decision).toBe('changes_requested');
    expect(decision!.feedback).toBe('The Google button is below the fold on a phone.');

    // The design step runs again and writes a SECOND version of the same
    // paths — a revision, with the first version retained (FR-106, FR-054).
    await post({
      step_index: 1,
      event: 'step_finished',
      status: 'done',
      duration_s: 21,
      cost_usd: '0.1400',
      artifacts: [
        { kind: 'design_file', path: 'docs/design/ui.pen', version: 2 },
        {
          kind: 'screen',
          path: 'docs/design/screens/00-sign-in.png',
          version: 2,
          screen_name: 'sign in',
        },
      ],
    });

    const versions = await sql`
      select path, version from artifacts
      where run_id = ${seeded.runId} and path = 'docs/design/screens/00-sign-in.png'
      order by version`;
    expect(versions.map((v) => v.version)).toEqual([1, 2]);
  });

  test('a migration ticket skips the design step, visibly, and still opens a merge request', async ({
    page,
    context,
  }) => {
    const seeded = await seed();
    await signIn(context, seeded.userId);
    const post = callbacks(page.request, seeded);

    await post({
      step_index: 0,
      event: 'ticket_classified',
      has_ui: false,
      rationale: 'This only adds a database migration nobody sees.',
    });
    await post({
      step_index: 0,
      event: 'step_finished',
      status: 'done',
      duration_s: 8,
      cost_usd: '0.2000',
      artifacts: [{ kind: 'document', path: 'docs/spec.md', version: 1 }],
    });

    // The design step and its gate both skip, each with its reason.
    await post({
      step_index: 1,
      event: 'step_skipped',
      condition_not_met: 'ticket has no UI change',
    });
    await post({
      step_index: 2,
      event: 'step_skipped',
      condition_not_met: 'ticket has no UI change',
    });
    await post({ step_index: 3, event: 'step_started' });
    await post({
      step_index: 3,
      event: 'step_finished',
      status: 'done',
      duration_s: 40,
      cost_usd: '0.9000',
      artifacts: [],
    });
    await post({
      step_index: 3,
      event: 'done',
      merge_request_url: 'https://gitlab.com/netgroup/shop/-/merge_requests/12',
      cost_usd: '1.1000',
    });

    await page.goto(`/tickets/${seeded.ticketId}`);

    // Shown as skipped WITH its reason, not omitted (FR-075a, FR-110).
    await expect(page.getByText(/skipped — ticket has no UI change/).first()).toBeVisible();
    // Why, in the classification's own words (FR-100).
    await expect(page.getByText('This only adds a database migration nobody sees.')).toBeVisible();
    // The run did not fail, and a merge request opened (FR-111).
    await expect(page.getByText('Done').first()).toBeVisible();
    await expect(
      page.getByRole('link', { name: /merge_requests\/12|Merge request/ }),
    ).toBeVisible();

    // SC-018 — nothing was spent on design.
    const spend = await sql`
      select step_index, cost_usd from step_results
      where run_id = ${seeded.runId} order by step_index`;
    expect(spend.find((s) => s.step_index === 1)?.cost_usd).toBe('0.0000');
    const [run] = await sql`select status, cost_usd from runs where id = ${seeded.runId}`;
    expect(run!.status).toBe('done');
    // Only the spec and implement steps cost anything.
    expect(run!.cost_usd).toBe('1.1000');
    // And no design artifact exists at all.
    const design = await sql`
      select count(*)::int as n from artifacts
      where run_id = ${seeded.runId} and kind in ('design_file', 'screen')`;
    expect(design[0]!.n).toBe(0);
  });

  test('no usable decision: treated as no interface change, warning on the run (FR-102)', async ({
    page,
    context,
  }) => {
    const seeded = await seed();
    await signIn(context, seeded.userId);
    const post = callbacks(page.request, seeded);

    // The specification step finishes WITHOUT posting ticket_classified —
    // which is what happens when its decision block is missing.
    await post({
      step_index: 0,
      event: 'step_finished',
      status: 'done',
      duration_s: 8,
      cost_usd: '0.2000',
      artifacts: [{ kind: 'document', path: 'docs/spec.md', version: 1 }],
    });

    // The absence is a field, not a log line.
    const [ticket] = await sql`
      select has_ui, ui_rationale, classification_missing from tickets
      where id = ${seeded.ticketId}`;
    expect(ticket!.classification_missing).toBe(true);
    // Null, not false: nobody decided.
    expect(ticket!.has_ui).toBeNull();
    expect(ticket!.ui_rationale).toBeNull();

    // The run continues rather than failing.
    await post({
      step_index: 1,
      event: 'step_skipped',
      condition_not_met: 'ticket has no UI change',
    });
    const [run] = await sql`select status, failure_reason from runs where id = ${seeded.runId}`;
    expect(run!.status).not.toBe('failed');
    expect(run!.failure_reason).toBeNull();

    // And the warning is visible on the run itself.
    await page.goto(`/tickets/${seeded.ticketId}`);
    await expect(page.getByText(/recorded no decision about the interface/i).first()).toBeVisible();
    await expect(page.getByText(/Check whether this ticket needed screens/)).toBeVisible();
  });
});
