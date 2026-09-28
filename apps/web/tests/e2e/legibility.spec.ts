import { createHmac, randomUUID } from 'node:crypto';
import type { BrowserContext, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import postgres from 'postgres';

/**
 * User Story 3's Independent Test (specs/004-bento-redesign): measure every
 * screen. No text under 12px, primary content — names of things, list rows,
 * body copy, form values — at least 14px (FR-007); every text at least 4.5:1
 * against what is behind it, or 3:1 from 20px up (FR-008); every neutral tile
 * lighter than the ground under it by 1.1:1 and every tinted one a ΔE of 10
 * away from it (FR-004).
 *
 * Measured, not eyeballed, because the room is not the screen: a projector
 * roughly halves contrast, and "looks fine up close" is how grey 11px text
 * reached the last design (research D7). The page is the only place the size
 * of a piece of text is actually decided — several rules meet on it — so it
 * is measured there, in the browser, as rendered.
 *
 * Contrast is taken against every colour the text may sit on: a gradient
 * contributes each of its stops, a translucent layer is composited over what
 * is under it, and the worst of those is the figure. A screen joins the table
 * below in the task that rebuilds it.
 */

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/factory';
const SESSION_SECRET = process.env.SESSION_SECRET ?? '';
const sql = postgres(DATABASE_URL, { max: 2, idle_timeout: 2, onnotice: () => {} });

/**
 * A workspace with something on every screen: a ticket in each state — a
 * draft, queued, running, waiting at a checkpoint after a design step, failed
 * and done — on a pipeline of its own, an agent and a skill. Its own data, so
 * it runs anywhere the suite does (not the demo seed).
 */
type Seeded = {
  userId: string;
  tickets: Record<'draft' | 'queued' | 'running' | 'waiting' | 'failed' | 'done', string>;
  agentId: string;
  pipelineId: string;
  skillId: string;
};

interface Screen {
  name: string;
  path: (seeded: Seeded) => string;
  signedIn: boolean;
  /** Selectors whose text is primary content, held to 14px. */
  primary: string[];
  /** Measure only inside this element — the frame, on a screen not rebuilt yet. */
  within?: string;
  /** Pressed before measuring: a tab or a dialog that is part of the screen. */
  click?: string;
}

const SCREENS: Screen[] = [
  {
    name: '00 Login',
    path: () => '/login',
    signedIn: false,
    primary: [
      'h1',
      'h2',
      '.lede',
      'header p',
      '.provider .label',
      '.field .label',
      'input',
      '.btn',
    ],
  },
  {
    name: 'the frame',
    path: () => '/',
    signedIn: true,
    within: '.top-nav',
    primary: ['.section', 'input', '.btn'],
  },
  {
    name: '01 Dashboard',
    path: () => '/',
    signedIn: true,
    // Titles of things, the approvals' titles and actions, the figures' labels.
    primary: [
      '.row-title',
      '.item-title',
      '.approve',
      '.link',
      '.more',
      '.ring-tile .label',
      '.cost .l',
      '.notice',
    ],
  },
  {
    name: '04 Tickets Board',
    path: () => '/tickets',
    signedIn: true,
    primary: ['h1', '.lede', '.title', '.col-title', '.choice select', '.add', '.btn'],
  },
  {
    name: '05 Create Ticket',
    path: () => '/tickets/new',
    signedIn: true,
    primary: [
      'h1',
      '.label',
      'input',
      'textarea',
      'select',
      '.pick .n',
      '.tx .n',
      '.btn',
      '.quiet',
      '.banner',
      '.tip',
    ],
  },
  {
    name: '06 Ticket Run',
    path: (seeded) => `/tickets/${seeded.tickets.running}`,
    signedIn: true,
    primary: ['h1', '.cell .n', '.run-tabs button', '.results .t', '.btn', '.log .t', '.note'],
  },
  {
    name: '06 Ticket Run, failed',
    path: (seeded) => `/tickets/${seeded.tickets.failed}`,
    signedIn: true,
    primary: ['h1', '.cell .n', '.failure h2', '.failure p', '.btn'],
  },
  {
    name: '06 Ticket Run, artifacts',
    path: (seeded) => `/tickets/${seeded.tickets.waiting}`,
    signedIn: true,
    click: '.run-tabs button:nth-child(2)',
    primary: ['h1', '.viewer .n', '.btn'],
  },
  {
    name: '06 Ticket Run, details',
    path: (seeded) => `/tickets/${seeded.tickets.waiting}`,
    signedIn: true,
    click: '.run-tabs button:nth-child(5)',
    primary: ['h1', 'dd', 'dt', '.btn'],
  },
  {
    name: '06 Ticket Run, launch',
    path: (seeded) => `/tickets/${seeded.tickets.done}`,
    signedIn: true,
    click: '.run-tabs button:nth-child(3)',
    primary: ['h1', '.btn'],
  },
  {
    name: '07 Approval Checkpoint',
    path: (seeded) => `/tickets/${seeded.tickets.waiting}/approve`,
    signedIn: true,
    primary: [
      'h1',
      '.t',
      '.s',
      '.btn',
      'textarea',
      '.criteria li',
      '.what',
      '.doc-body p',
      '.quiet',
    ],
  },
  {
    name: '14 Design Review',
    path: (seeded) => `/tickets/${seeded.tickets.waiting}/design`,
    signedIn: true,
    primary: [
      'h1',
      '.banner .t',
      '.banner .s',
      '.btn',
      'textarea',
      '.criteria li',
      '.quote',
      '.name',
      '.n .t',
      '.side-tile .quiet',
    ],
  },
];

async function seed(): Promise<Seeded> {
  const tag = randomUUID().slice(0, 8);
  await sql`insert into workspaces (name) values ('E2E') on conflict do nothing`;
  const [user] = await sql`
    insert into users (name, email, role)
    values ('Legible Reader', ${`legible-${tag}@x.dev`}, 'admin') returning id`;
  const userId = user!.id as string;
  const [credential] = await sql`
    insert into credentials (kind, ciphertext, key_version, status)
    values ('git', 'sealed', 'v1', 'valid') returning id`;
  const [repo] = await sql`
    insert into repositories (name, full_path, provider, clone_url, default_branch, credential_id, status)
    values (${`legible-${tag}`}, ${`netgroup/legible-${tag}`}, 'gitlab',
            'https://gitlab.com/netgroup/legible.git', 'main', ${credential!.id}, 'connected')
    returning id`;

  const agent = async (name: string, engine: string) => {
    const [row] = await sql`
      insert into agents (name, kind, owner_id, engine, model, system_prompt, allowed_tools)
      values (${`${name} ${tag}`}, 'custom', ${userId}, ${engine}, 'claude-sonnet-5', 'do the step', '{Read}')
      returning id, name, engine, model, system_prompt, allowed_tools`;
    return row!;
  };
  const writer = await agent('Legible spec', 'claude_cli');
  const drawer = await agent('Legible design', 'design_cli');
  const builder = await agent('Legible build', 'claude_cli');
  const steps = [
    { type: 'agent', condition: 'always', agent_id: writer.id, output_files: ['docs/spec.md'] },
    { type: 'design', condition: 'ticket_has_ui', agent_id: drawer.id },
    { type: 'checkpoint', condition: 'ticket_has_ui', approvers: 'anyone', on_timeout: 'wait' },
    { type: 'agent', condition: 'always', agent_id: builder.id, output_files: [] },
  ];
  const [pipeline] = await sql`
    insert into pipelines (name, owner_id, current_version) values (${`Legible ${tag}`}, ${userId}, 1)
    returning id`;
  await sql`insert into pipeline_versions (pipeline_id, version, steps)
            values (${pipeline!.id}, 1, ${sql.json(steps)})`;
  const [skill] = await sql`
    insert into skills (name, description, content, owner_id)
    values (${`legible-${tag}`}, 'How this workspace writes things down.', '# Rules', ${userId})
    returning id`;

  const snapshotAgents = [writer, drawer, builder].map((a) => ({
    id: a.id,
    name: a.name,
    engine: a.engine,
    model: a.model,
    system_prompt: a.system_prompt,
    allowed_tools: a.allowed_tools,
    skills: [],
    limits: {},
  }));

  const ticket = async (
    title: string,
    status: string,
    run?: { status: string; current: number | null; failure?: string },
  ) => {
    const reference = `#${Math.floor(Math.random() * 900_000) + 100_000}`;
    const runId = run ? randomUUID() : null;
    const [row] = await sql`
      insert into tickets (repository_id, created_by, reference, title, description, acceptance_criteria,
        pipeline_id, pipeline_version, status, branch_name, current_run_id, merge_request_url, has_ui, ui_rationale)
      values (${repo!.id}, ${userId}, ${reference}, ${title}, 'Read from the back of the room.',
              ${sql.array(['Every word can be read'])}, ${pipeline!.id}, 1, ${status},
              ${run ? `factory/${tag}` : null}, ${runId},
              ${status === 'done' ? 'https://gitlab.com/netgroup/legible/-/merge_requests/7' : null},
              ${run ? true : null}, ${run ? 'It changes the screens people read.' : null})
      returning id`;
    if (run && runId) {
      const snapshot = {
        run_id: runId,
        attempt: 1,
        ticket: {
          reference,
          title,
          description: null,
          acceptance_criteria: ['Every word can be read'],
        },
        repo: {
          clone_url: 'https://gitlab.com/netgroup/legible.git',
          default_branch: 'main',
          branch: `factory/${tag}`,
          provider: 'gitlab',
          credential_ref: credential!.id,
        },
        pipeline: { id: pipeline!.id, version: 1, name: `Legible ${tag}`, steps },
        limits: { cost_ceiling_usd: '5.0000', time_ceiling_minutes: 45 },
        agents: snapshotAgents,
        callback_url: 'http://localhost:5173/api/hooks/orchestrator',
        resume_secret: `e2e-${randomUUID()}`,
      };
      const started = new Date(Date.now() - 6 * 60_000);
      await sql`
        insert into runs (id, ticket_id, attempt, snapshot, status, current_step_index, cost_usd,
          cost_ceiling_usd, time_ceiling_minutes, failure_reason, failure_step_index, started_at, finished_at)
        values (${runId}, ${row!.id}, 1, ${sql.json(snapshot)}, ${run.status}, ${run.current}, '0.4200',
                '5.0000', 45, ${run.failure ?? null}, ${run.failure ? run.current : null},
                ${run.status === 'queued' ? null : started},
                ${['done', 'failed'].includes(run.status) ? new Date() : null})`;
      for (let index = 0; index < (run.current ?? 0); index++) {
        await sql`insert into step_results (run_id, step_index, status, started_at, finished_at, duration_s, cost_usd)
                  values (${runId}, ${index}, 'done', ${started}, ${new Date()}, 95, '0.1400')`;
      }
      if (run.status === 'running') {
        await sql`insert into step_results (run_id, step_index, status, started_at)
                  values (${runId}, ${run.current}, 'running', ${new Date(Date.now() - 3 * 60_000)})`;
      }
    }
    return row!.id as string;
  };

  return {
    userId,
    tickets: {
      draft: await ticket(`Draft ${tag}`, 'draft'),
      queued: await ticket(`Queued ${tag}`, 'queued', { status: 'queued', current: null }),
      running: await ticket(`Running ${tag}`, 'running', { status: 'running', current: 0 }),
      waiting: await ticket(`Waiting ${tag}`, 'waiting_approval', {
        status: 'waiting_approval',
        current: 2,
      }),
      failed: await ticket(`Failed ${tag}`, 'failed', {
        status: 'failed',
        current: 3,
        failure: 'The tests failed at implement.',
      }),
      done: await ticket(`Done ${tag}`, 'done', { status: 'done', current: null }),
    },
    agentId: writer.id as string,
    pipelineId: pipeline!.id as string,
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

type Finding = string;

/** Runs in the page. Returns one line per text or tile that falls short. */
function measure(input: { primary: string[]; within?: string }): Finding[] {
  type RGBA = { r: number; g: number; b: number; a: number };
  const parse = (value: string): RGBA | null => {
    const rgb = value.match(/rgba?\(([^)]+)\)/);
    if (rgb) {
      const [r, g, b, a] = (rgb[1] as string)
        .split(/[\s,/]+/)
        .filter(Boolean)
        .map(Number);
      return { r: r ?? 0, g: g ?? 0, b: b ?? 0, a: a ?? 1 };
    }
    const srgb = value.match(/color\(srgb ([^)]+)\)/);
    if (srgb) {
      const [r, g, b, a] = (srgb[1] as string)
        .split(/[\s/]+/)
        .filter(Boolean)
        .map(Number);
      return { r: (r ?? 0) * 255, g: (g ?? 0) * 255, b: (b ?? 0) * 255, a: a ?? 1 };
    }
    return null;
  };
  const over = (top: RGBA, under: RGBA): RGBA => ({
    r: top.r * top.a + under.r * (1 - top.a),
    g: top.g * top.a + under.g * (1 - top.a),
    b: top.b * top.a + under.b * (1 - top.a),
    a: 1,
  });
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const luminance = (c: RGBA) =>
    0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
  const ratio = (a: RGBA, b: RGBA) => {
    const [x, y] = [luminance(a), luminance(b)];
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  };
  const lab = (c: RGBA) => {
    const [x, y, z] = [
      (0.4124 * channel(c.r) + 0.3576 * channel(c.g) + 0.1805 * channel(c.b)) / 0.95047,
      0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b),
      (0.0193 * channel(c.r) + 0.1192 * channel(c.g) + 0.9505 * channel(c.b)) / 1.08883,
    ].map((v) => (v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116)) as [number, number, number];
    return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
  };
  const deltaE = (a: RGBA, b: RGBA) => {
    const [p, q] = [lab(a), lab(b)];
    return Math.hypot(
      (p[0] ?? 0) - (q[0] ?? 0),
      (p[1] ?? 0) - (q[1] ?? 0),
      (p[2] ?? 0) - (q[2] ?? 0),
    );
  };
  const mean = (cs: RGBA[]): RGBA => ({
    r: cs.reduce((s, c) => s + c.r, 0) / cs.length,
    g: cs.reduce((s, c) => s + c.g, 0) / cs.length,
    b: cs.reduce((s, c) => s + c.b, 0) / cs.length,
    a: 1,
  });

  /** The colours one element paints behind its content: its colour, then its top gradient layer. */
  const layers = (el: Element): RGBA[][] => {
    const style = getComputedStyle(el);
    const out: RGBA[][] = [];
    const colour = parse(style.backgroundColor);
    if (colour && colour.a > 0) out.push([colour]);
    const image = style.backgroundImage;
    if (image && image !== 'none' && image.includes('gradient')) {
      // The first layer is the one painted over the content area; later
      // layers (a tile's highlight edge) sit under the border only.
      let depth = 0;
      let end = image.length;
      for (let i = 0; i < image.length; i++) {
        if (image[i] === '(') depth++;
        else if (image[i] === ')') depth--;
        else if (image[i] === ',' && depth === 0) {
          end = i;
          break;
        }
      }
      const stops = [...image.slice(0, end).matchAll(/rgba?\([^)]+\)|color\(srgb [^)]+\)/g)]
        .map((m) => parse(m[0]))
        .filter((c): c is RGBA => c !== null);
      if (stops.length > 0) out.push(stops);
    }
    return out;
  };

  /** Every colour the content of `el` may be painted on, from the canvas up. */
  const grounds = (el: Element): RGBA[] => {
    const chain: Element[] = [];
    for (let at: Element | null = el; at; at = at.parentElement) chain.unshift(at);
    let under: RGBA[] = [{ r: 255, g: 255, b: 255, a: 1 }];
    for (const node of chain) {
      for (const layer of layers(node)) {
        const next: RGBA[] = [];
        for (const top of layer) for (const u of under) next.push(over(top, u));
        under = next.slice(0, 12);
      }
    }
    return under;
  };

  const opacity = (el: Element) => {
    let product = 1;
    for (let at: Element | null = el; at; at = at.parentElement) {
      product *= Number(getComputedStyle(at).opacity);
    }
    return product;
  };

  const visible = (el: Element) => {
    const rect = el.getBoundingClientRect();
    if (rect.width <= 1 || rect.height <= 1) return false;
    const style = getComputedStyle(el);
    return style.visibility !== 'hidden' && style.display !== 'none' && opacity(el) > 0.05;
  };

  const root = input.within ? document.querySelector(input.within) : document.body;
  if (!root) return [`nothing matches ${input.within}`];
  const primary = input.primary.join(', ');
  const findings: Finding[] = [];
  const describe = (el: Element) =>
    `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? `.${el.className.trim().split(/\s+/).join('.')}` : ''}`;

  const check = (el: Element, text: string) => {
    if (!visible(el)) return;
    const style = getComputedStyle(el);
    const size = Number.parseFloat(style.fontSize);
    const isPrimary = primary !== '' && el.closest(primary) !== null;
    const label = `"${text.slice(0, 40)}" (${describe(el)})`;
    if (size < 12) findings.push(`${label} is ${size}px, under 12px`);
    else if (isPrimary && size < 14)
      findings.push(`${label} is ${size}px, under 14px for primary content`);

    if (el.closest(':disabled, [aria-disabled="true"]')) return;
    const fg = parse(style.color);
    if (!fg) return;
    const faded = { ...fg, a: fg.a * opacity(el) };
    const need = size >= 20 ? 3 : 4.5;
    const worst = Math.min(...grounds(el).map((bg) => ratio(over(faded, bg), bg)));
    if (worst < need)
      findings.push(`${label} at ${size}px has contrast ${worst.toFixed(2)}:1, under ${need}:1`);
  };

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
    const el = node.parentElement;
    if (!text || !el || el.closest('script, style, noscript, template, svg')) continue;
    check(el, text);
  }
  // A form's values are text too, and primary content.
  for (const field of root.querySelectorAll(
    'input:not([type=hidden], [type=checkbox], [type=radio], [type=file]), textarea, select',
  )) {
    const value = (field as HTMLInputElement).value;
    if (value) check(field, value);
  }

  // Tiles against the ground under them (FR-004).
  const ground = parse(getComputedStyle(document.body).backgroundColor) ?? {
    r: 241,
    g: 240,
    b: 238,
    a: 1,
  };
  const bodyStops = layers(document.body).at(-1) ?? [ground];
  const groundAt = (y: number): RGBA => {
    if (bodyStops.length < 2) return bodyStops[0] ?? ground;
    const t = Math.min(1, Math.max(0, y / innerHeight));
    const [a, b] = [bodyStops[0] as RGBA, bodyStops[bodyStops.length - 1] as RGBA];
    return { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t, a: 1 };
  };
  for (const tile of root.querySelectorAll('.tile')) {
    if (!visible(tile)) continue;
    const own = layers(tile).at(-1);
    if (!own) continue;
    const colour = mean(own);
    const rect = tile.getBoundingClientRect();
    const behind = groundAt(rect.top + Math.min(rect.height, innerHeight) / 2);
    const tinted = [...tile.classList].some((c) => c.startsWith('tile--'));
    if (tinted) {
      const d = deltaE(colour, behind);
      if (d < 10)
        findings.push(`tinted ${describe(tile)} is ΔE ${d.toFixed(1)} from the ground, under 10`);
    } else {
      const lighter = (luminance(colour) + 0.05) / (luminance(behind) + 0.05);
      if (lighter < 1.1)
        findings.push(
          `${describe(tile)} is ${lighter.toFixed(3)}:1 against the ground, under 1.1:1`,
        );
    }
  }
  return findings;
}

async function measured(page: Page, screen: Screen): Promise<Finding[]> {
  // Webfonts decide the sizes that render; measure once they are in.
  await page.evaluate(() => document.fonts.ready);
  return page.evaluate(measure, { primary: screen.primary, within: screen.within });
}

test.describe('every screen can be read from the back of a lit room', () => {
  test.skip(
    !SESSION_SECRET,
    'Needs SESSION_SECRET, to mint the same session cookie the app issues.',
  );
  test.use({ viewport: { width: 1440, height: 1024 } });

  for (const screen of SCREENS) {
    test(`${screen.name}: size, contrast and tiles (FR-004, FR-007, FR-008)`, async ({
      page,
      context,
    }) => {
      const seeded = await seed();
      if (screen.signedIn) await signIn(context, seeded.userId);
      await page.goto(screen.path(seeded), { waitUntil: 'networkidle' });
      if (screen.click) {
        await page.locator(screen.click).first().click();
        await page.waitForLoadState('networkidle');
      }
      const findings = await measured(page, screen);
      expect(findings, `${screen.name}:\n${findings.join('\n')}`).toEqual([]);
    });
  }
});
