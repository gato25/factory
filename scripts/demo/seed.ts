#!/usr/bin/env bun
/**
 * Fills a workspace with the sample data the design draws, in every state a
 * screen can show — for validating the redesign against its artboards and
 * for presenting it (specs/004-bento-redesign, plan: "Demo seed").
 *
 *   bun scripts/demo/seed.ts           # replace the demo rows with a fresh set
 *   bun scripts/demo/seed.ts --reset   # remove the demo rows and stop
 *
 * Everything written hangs off repositories whose clone address is on the
 * reserved `.invalid` domain (RFC 2606) and users whose address is on it too,
 * so nothing can ever push there and `--reset` finds exactly these rows and
 * nothing else. Times are relative to now, which is why a re-run replaces the
 * set rather than adding to it: a "running for 4 minutes" row seeded yesterday
 * would say a day.
 *
 * Not reachable from the application, and not a fixture for the tests — the
 * tests seed what they assert. The default agents must exist
 * (`bun run install-defaults`); the pipelines are the seed's own, because the
 * design draws pipelines of 3, 6, 7 and 8 steps and the shipped ones are not
 * those.
 *
 * The runs are rows, not work: no sandbox exists for them. Nothing starts a
 * queued run by itself, but a real run finishing while the demo rows are
 * present may hand a free sandbox to a queued demo run, which then fails at
 * its clone. Re-run the seed to restore it.
 */

import { randomUUID } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { createClient } from '@factory/db';
import type { PipelineSnapshot, SnapshotAgent, Step } from '@factory/shared';

const DOMAIN = 'demo.invalid';
const { sql } = createClient();

// `JSON.stringify(...)::jsonb` rather than `sql.json(...)`: the driver's json
// helper throws under Bun (see scripts/design/sample.ts).

const MINUTE = 60_000;
const now = Date.now();
const ago = (minutes: number) => new Date(now - minutes * MINUTE);
const daysAgo = (days: number, atHour = 11) => {
  const d = new Date(now);
  d.setDate(d.getDate() - days);
  d.setHours(atHour, 0, 0, 0);
  // Never in the future: "today at 11:00" seeded at 09:00 would be.
  return d.getTime() > now ? new Date(now - 30 * MINUTE) : d;
};
const money = (usd: number) => usd.toFixed(4);
// Timestamps travel as ISO strings for the same reason as the JSON: the
// driver's Date serialiser throws under Bun.
const at = (date: Date | null | undefined) => (date ? date.toISOString() : null);

// ---------------------------------------------------------------- reset

async function reset() {
  await sql.begin(async (tx) => {
    const repos = await tx`select id, credential_id from repositories
                             where clone_url like ${`%.${DOMAIN}/%`}`;
    const repoIds = repos.map((r) => r.id as string);
    const credentialIds = repos.map((r) => r.credential_id).filter(Boolean) as string[];
    const users = await tx`select id from users where email like ${`%@${DOMAIN}`}`;
    const userIds = users.map((u) => u.id as string);

    if (repoIds.length > 0) {
      const tickets = await tx`select id from tickets where repository_id in ${tx(repoIds)}`;
      const ticketIds = tickets.map((t) => t.id as string);
      if (ticketIds.length > 0) {
        // step_results, artifacts, approvals and log_chunks cascade from runs.
        await tx`delete from runs where ticket_id in ${tx(ticketIds)}`;
        await tx`delete from ticket_files where ticket_id in ${tx(ticketIds)}`;
        await tx`delete from launches where ticket_id in ${tx(ticketIds)}`;
        await tx`delete from tickets where id in ${tx(ticketIds)}`;
      }
      await tx`delete from repositories where id in ${tx(repoIds)}`;
    }
    if (credentialIds.length > 0) {
      await tx`delete from credentials where id in ${tx(credentialIds)}`;
    }
    if (userIds.length > 0) {
      // Only the seed's own pipelines: owned by a demo user, and used by
      // nothing that survived the deletions above.
      const pipelines = await tx`
        select p.id from pipelines p
         where p.owner_id in ${tx(userIds)}
           and not exists (select 1 from tickets t where t.pipeline_id = p.id)
           and not exists (select 1 from repositories r where r.default_pipeline_id = p.id)`;
      const pipelineIds = pipelines.map((p) => p.id as string);
      if (pipelineIds.length > 0) {
        await tx`delete from pipeline_versions where pipeline_id in ${tx(pipelineIds)}`;
        await tx`delete from pipelines where id in ${tx(pipelineIds)}`;
      }
      await tx`delete from users u where u.id in ${tx(userIds)}
                 and not exists (select 1 from tickets t where t.created_by = u.id)
                 and not exists (select 1 from pipelines p where p.owner_id = u.id)`;
    }
  });
}

// ---------------------------------------------------------------- agents

const AGENT_NAMES = ['Spec', 'Design', 'Plan', 'Tasks', 'Implement'] as const;
type AgentName = (typeof AGENT_NAMES)[number];

async function loadAgents(): Promise<Record<AgentName, SnapshotAgent>> {
  const rows = await sql`select id, name, engine, model, system_prompt, allowed_tools
                           from agents where kind = 'default' and name in ${sql([...AGENT_NAMES])}`;
  const found = Object.fromEntries(
    rows.map((row) => [
      row.name,
      {
        id: row.id,
        name: row.name,
        engine: row.engine,
        model: row.model,
        system_prompt: row.system_prompt,
        allowed_tools: row.allowed_tools,
        skills: [],
        limits: {},
      } satisfies SnapshotAgent,
    ]),
  );
  const missing = AGENT_NAMES.filter((name) => !found[name]);
  if (missing.length > 0) {
    throw new Error(
      `the default agents ${missing.join(', ')} are missing — run \`bun run install-defaults\` first`,
    );
  }
  return found as Record<AgentName, SnapshotAgent>;
}

// ---------------------------------------------------------------- pipelines

type Kind = 'spec' | 'design' | 'plan' | 'tasks' | 'implement' | 'gate' | 'design-gate';

function stepOf(kind: Kind, agents: Record<AgentName, SnapshotAgent>): Step {
  switch (kind) {
    case 'spec':
      return {
        type: 'agent',
        condition: 'always',
        agent_id: agents.Spec.id,
        output_files: ['docs/spec.md'],
      };
    case 'design':
      return {
        type: 'design',
        condition: 'ticket_has_ui',
        agent_id: agents.Design.id,
        output_files: ['docs/design/ui.pen'],
        design: {
          source_path: 'docs/design/ui.pen',
          export_dir: 'docs/design/screens',
          export_scale: 2,
        },
      };
    case 'plan':
      return {
        type: 'agent',
        condition: 'always',
        agent_id: agents.Plan.id,
        output_files: ['docs/plan.md'],
      };
    case 'tasks':
      return {
        type: 'agent',
        condition: 'always',
        agent_id: agents.Tasks.id,
        output_files: ['docs/tasks.md'],
      };
    case 'implement':
      return {
        type: 'agent',
        condition: 'always',
        agent_id: agents.Implement.id,
        output_files: [],
      };
    case 'gate':
      return { type: 'checkpoint', condition: 'always', approvers: 'anyone', on_timeout: 'wait' };
    case 'design-gate':
      return {
        type: 'checkpoint',
        condition: 'ticket_has_ui',
        approvers: 'anyone',
        on_timeout: 'wait',
      };
  }
}

/**
 * The design's pipelines. Each bar the design draws has one segment per step
 * plus the merge request every pipeline ends in: 3, 6, 7 and 8 segments.
 */
const PIPELINES = {
  quick: {
    name: 'Хурдан засвар',
    description: 'Хяналтын цэггүй. Жижиг, сайн тодорхойлсон өөрчлөлтөд.',
    kinds: ['spec', 'implement'] as Kind[],
  },
  standard: {
    name: 'Стандарт',
    description: 'Интерфейс өөрчлөгдвөл pen.dev дээр зурна, дараа нь төлөвлөж хөгжүүлнэ.',
    kinds: ['spec', 'design', 'plan', 'tasks', 'implement'] as Kind[],
  },
  designReview: {
    name: 'Дизайн хяналттай',
    description: 'Зурсан дэлгэцүүдийг код бичихээс өмнө хүн хянана.',
    kinds: ['spec', 'design', 'design-gate', 'plan', 'tasks', 'implement'] as Kind[],
  },
  reviewed: {
    name: 'Хяналттай',
    description: 'Тодорхойлолт, төлөвлөгөө, хөгжүүлэлтийн дараа хяналтын цэгтэй.',
    kinds: ['spec', 'gate', 'plan', 'gate', 'tasks', 'implement', 'gate'] as Kind[],
  },
} as const;
type PipelineKey = keyof typeof PIPELINES;
interface SeededPipeline {
  id: string;
  name: string;
  steps: Step[];
  kinds: Kind[];
}

// ---------------------------------------------------------------- screens

/**
 * A small PNG drawn from rectangles, standing in for an exported screen. The
 * design review shows the images a design step committed; the seed has no
 * design step to run, so it draws the outline of one: a ground, a top bar,
 * and tiles.
 */
function png(width: number, height: number, rects: [number, number, number, number, string][]) {
  const rgb = (hex: string) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
  const raw = Buffer.alloc((width * 3 + 1) * height);
  const ground = rgb('#F4F2EF');
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    for (let x = 0; x < width; x++) raw.set(ground, y * (width * 3 + 1) + 1 + x * 3);
  }
  for (const [rx, ry, rw, rh, colour] of rects) {
    const c = rgb(colour);
    for (let y = ry; y < Math.min(height, ry + rh); y++) {
      for (let x = rx; x < Math.min(width, rx + rw); x++)
        raw.set(c, y * (width * 3 + 1) + 1 + x * 3);
    }
  }
  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (bytes: Buffer) => {
    let c = 0xffffffff;
    for (const b of bytes) c = (table[(c ^ b) & 0xff] as number) ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([length, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function screen(variant: number) {
  const tiles: [number, number, number, number, string][] = [
    [24, 16, 672, 40, '#FFFFFF'],
    [24, 16, 40, 40, '#F26B1D'],
  ];
  const layouts = [
    [
      [24, 80, 440, 400],
      [480, 80, 216, 190],
      [480, 290, 216, 190],
    ],
    [
      [24, 80, 672, 120],
      [24, 216, 672, 264],
    ],
    [
      [24, 80, 328, 400],
      [368, 80, 328, 190],
      [368, 290, 328, 190],
    ],
    [[140, 120, 440, 320]],
  ][variant % 4] as number[][];
  for (const [x, y, w, h] of layouts) tiles.push([x ?? 0, y ?? 0, w ?? 0, h ?? 0, '#FFFFFF']);
  tiles.push([48, 104, 180, 14, '#16140F'], [48, 130, 120, 10, '#A39D93']);
  if (variant === 3) tiles.push([300, 380, 120, 32, '#16A34A']);
  else tiles.push([56, 440, 120, 28, '#F26B1D']);
  return png(720, 512, tiles);
}

// ---------------------------------------------------------------- tickets

/**
 * Sample token counts for a step the plan gave a dollar figure.
 *
 * The plan below was written in dollars, before the screens showed tokens, so
 * the counts are derived from those figures rather than written out a second
 * time — and derived at the mix a real agent step has: mostly reads of the
 * prompt cache (it re-reads the repository every turn), a little written to
 * it, a little fresh input, and the output. About a million and a half tokens
 * to the dollar at that mix. Made-up numbers for made-up runs, like the
 * dollars they come from; a re-seed always gives the same ones.
 */
function tokensFor(cost: number | undefined) {
  const dollars = cost ?? 0;
  return {
    input: Math.round(dollars * 7_000),
    output: Math.round(dollars * 19_000),
    cacheCreation: Math.round(dollars * 70_000),
    cacheRead: Math.round(dollars * 1_400_000),
  };
}

interface StepPlan {
  /** minutes before now the step started; omitted for a step not reached */
  started?: number;
  /** its duration in seconds, when finished */
  duration?: number;
  cost?: number;
  status: 'done' | 'running' | 'skipped' | 'failed' | 'waiting';
  reason?: string;
}

interface TicketPlan {
  reference: string;
  repo: string;
  by: string;
  title: string;
  pipeline: PipelineKey;
  criteria: string[];
  description?: string;
  ticketStatus: 'draft' | 'queued' | 'running' | 'waiting_approval' | 'done' | 'failed';
  run?: {
    status: 'queued' | 'running' | 'waiting_approval' | 'done' | 'failed';
    current: number | null;
    steps: StepPlan[];
    failure?: string;
    createdMinutesAgo: number;
    finished?: Date;
    attempt?: number;
    mergeRequest?: number;
  };
  hasUi?: boolean;
  uiRationale?: string;
  createdAt?: Date;
}

const REPOSITORIES = [
  { name: 'shop-frontend', provider: 'gitlab', branch: 'main', pipeline: 'standard' },
  { name: 'billing-api', provider: 'gitlab', branch: 'develop', pipeline: 'reviewed' },
  { name: 'admin-console', provider: 'gitlab', branch: 'main', pipeline: 'standard' },
  { name: 'worker-service', provider: 'github', branch: 'main', pipeline: 'standard' },
  { name: 'gateway', provider: 'github', branch: 'main', pipeline: 'standard' },
  { name: 'mobile-app', provider: 'github', branch: 'main', pipeline: 'quick', expired: true },
  { name: 'docs-site', provider: 'github', branch: 'main', pipeline: 'quick' },
  { name: 'reports-service', provider: 'github', branch: 'main', pipeline: 'quick' },
] as const;

const PEOPLE = [
  { key: 'GB', name: 'Гантогтох Б.', email: `gantogtokh@${DOMAIN}` },
  { key: 'AN', name: 'Анударь Н.', email: `anudari@${DOMAIN}` },
  { key: 'BA', name: 'Батаа А.', email: `bataa@${DOMAIN}` },
] as const;

/** What the design's screens show, ticket by ticket (artboards 01, 04, 06, 07, 14). */
const CURRENT: TicketPlan[] = [
  {
    reference: '#142',
    repo: 'shop-frontend',
    by: 'GB',
    title: 'Google-ээр нэвтрэх эрх нэмэх',
    description: 'Хэрэглэгч Google бүртгэлээрээ нэвтэрч чаддаг болно.',
    pipeline: 'standard',
    criteria: [
      'Нэвтрэх хуудсанд «Google-ээр үргэлжлүүлэх» товч харагдана',
      'Шинэ хэрэглэгч анх нэвтрэхэд бүртгэл үүснэ',
      'Цуцалсан нэвтрэлт алдааны мэдэгдэл харуулна',
    ],
    ticketStatus: 'running',
    hasUi: true,
    uiRationale: 'Нэвтрэх хуудсанд шинэ товч нэмэгдэнэ.',
    run: {
      status: 'running',
      current: 4,
      createdMinutesAgo: 14,
      steps: [
        { status: 'done', started: 14, duration: 130, cost: 0.14 },
        { status: 'done', started: 12, duration: 161, cost: 0.42 },
        { status: 'done', started: 9, duration: 222, cost: 0.51 },
        { status: 'done', started: 5.5, duration: 65, cost: 0.18 },
        { status: 'running', started: 4, cost: 0.29 },
      ],
    },
  },
  {
    reference: '#145',
    repo: 'admin-console',
    by: 'BA',
    title: 'Тохиргооны хуудсыг шинэчлэх',
    pipeline: 'standard',
    criteria: ['Тохиргоо хэсгүүдээр ангилагдана', 'Хадгалах товч өөрчлөлт байхад л идэвхтэй'],
    ticketStatus: 'running',
    hasUi: true,
    uiRationale: 'Тохиргооны хуудасны бүтэц өөрчлөгдөнө.',
    run: {
      status: 'running',
      current: 1,
      createdMinutesAgo: 9,
      steps: [
        { status: 'done', started: 9, duration: 150, cost: 0.12 },
        { status: 'running', started: 6 },
      ],
    },
  },
  {
    reference: '#139',
    repo: 'billing-api',
    by: 'GB',
    title: 'Нэхэмжлэхийн PDF-ийн алдаа засах',
    description: 'Нэхэмжлэхийн PDF-д монгол үсэг дөрвөлжин болж харагдаж байна.',
    pipeline: 'reviewed',
    criteria: [
      'PDF-д Ө, Ү зэрэг бүх үсэг зөв харагдана',
      'Урт хүснэгт дараагийн хуудас руу зөв шилжинэ',
    ],
    ticketStatus: 'waiting_approval',
    hasUi: false,
    run: {
      status: 'waiting_approval',
      current: 3,
      createdMinutesAgo: 26,
      steps: [
        { status: 'done', started: 26, duration: 110, cost: 0.31 },
        { status: 'done', started: 24, duration: 360 },
        { status: 'done', started: 16, duration: 242, cost: 0.81 },
        { status: 'waiting', started: 12 },
      ],
    },
  },
  {
    reference: '#137',
    repo: 'shop-frontend',
    by: 'GB',
    title: 'Хэрэглэгчийн профайл засах',
    pipeline: 'designReview',
    criteria: [
      'Профайл хуудсанд «Засах» товч харагдана',
      'Нэр, имэйлийг засаж хадгалж болно',
      'Зураг солиход урьдчилан харагдана',
    ],
    ticketStatus: 'waiting_approval',
    hasUi: true,
    uiRationale:
      'Даалгавар профайл засах маягт болон зураг солих цонх нэмдэг — хоёулаа хэрэглэгчийн харах интерфейсийг өөрчилнө.',
    run: {
      status: 'waiting_approval',
      current: 2,
      createdMinutesAgo: 42,
      steps: [
        { status: 'done', started: 42, duration: 140, cost: 0.16 },
        { status: 'done', started: 39, duration: 161, cost: 0.42 },
        { status: 'waiting', started: 38 },
      ],
    },
  },
  {
    reference: '#144',
    repo: 'worker-service',
    by: 'BA',
    title: 'Cron ажлуудыг дараалалд шилжүүлэх',
    pipeline: 'quick',
    criteria: ['Бүх cron ажил дараалалаар дамжина', 'Давхар ажиллахгүй'],
    ticketStatus: 'running',
    run: {
      status: 'running',
      current: 0,
      createdMinutesAgo: 2,
      steps: [{ status: 'running', started: 2 }],
    },
  },
  {
    reference: '#140',
    repo: 'gateway',
    by: 'GB',
    title: 'Нийтийн API-д хязгаар тавих',
    pipeline: 'standard',
    criteria: ['Нэг түлхүүрт минутад 100 хүсэлт', 'Хэтэрвэл 429 хариу буцаана'],
    ticketStatus: 'running',
    hasUi: false,
    run: {
      status: 'running',
      current: 3,
      createdMinutesAgo: 11,
      steps: [
        { status: 'done', started: 11, duration: 120, cost: 0.13 },
        { status: 'skipped', reason: 'интерфейс өөрчлөгдөхгүй' },
        { status: 'done', started: 8, duration: 250, cost: 0.44 },
        { status: 'running', started: 3 },
      ],
    },
  },
  {
    reference: '#141',
    repo: 'billing-api',
    by: 'BA',
    title: 'Нэхэмжлэхийн имэйл мэдэгдэл',
    pipeline: 'standard',
    criteria: ['Нэхэмжлэх үүсэхэд харилцагч имэйл авна'],
    ticketStatus: 'failed',
    hasUi: false,
    run: {
      status: 'failed',
      current: 4,
      createdMinutesAgo: 95,
      failure: 'Хөгжүүлэлт дээр тест унасан',
      finished: ago(58),
      steps: [
        { status: 'done', started: 95, duration: 115, cost: 0.12 },
        { status: 'skipped', reason: 'интерфейс өөрчлөгдөхгүй' },
        { status: 'done', started: 92, duration: 230, cost: 0.38 },
        { status: 'done', started: 88, duration: 70, cost: 0.11 },
        { status: 'failed', started: 86, duration: 1640, cost: 0.36 },
      ],
    },
  },
  {
    reference: '#146',
    repo: 'shop-frontend',
    by: 'GB',
    title: 'Хайлтын шүүлтүүр нэмэх',
    pipeline: 'standard',
    criteria: ['Үнэ, ангиллаар шүүнэ'],
    ticketStatus: 'queued',
    run: { status: 'queued', current: null, createdMinutesAgo: 1.5, steps: [] },
  },
  {
    reference: '#147',
    repo: 'worker-service',
    by: 'AN',
    title: 'Worker-т Sentry холбох',
    pipeline: 'standard',
    criteria: ['Алдаа Sentry-д бүртгэгдэнэ'],
    ticketStatus: 'queued',
    run: { status: 'queued', current: null, createdMinutesAgo: 1, steps: [] },
  },
  {
    reference: '#148',
    repo: 'shop-frontend',
    by: 'BA',
    title: 'Харилцагчийн CSV импорт нэмэх',
    pipeline: 'standard',
    criteria: ['CSV файлаас харилцагч импортлоно'],
    ticketStatus: 'draft',
  },
  {
    reference: '#136',
    repo: 'reports-service',
    by: 'GB',
    title: 'CSV тайлан гаргах',
    pipeline: 'quick',
    criteria: ['Тайланг CSV-ээр татаж болно'],
    ticketStatus: 'done',
    run: {
      status: 'done',
      current: 1,
      createdMinutesAgo: 80,
      finished: ago(62),
      mergeRequest: 88,
      steps: [
        { status: 'done', started: 80, duration: 100, cost: 0.1 },
        { status: 'done', started: 77, duration: 840 },
      ],
    },
  },
  {
    reference: '#135',
    repo: 'shop-frontend',
    by: 'AN',
    title: 'Нэвтрэх давталтын алдаа засах',
    pipeline: 'quick',
    criteria: ['Буруу нууц үг 5 удаа оруулбал түр түгжинэ'],
    ticketStatus: 'done',
    run: {
      status: 'done',
      current: 1,
      createdMinutesAgo: 60 * 24 + 40,
      finished: daysAgo(1, 15),
      mergeRequest: 86,
      steps: [
        { status: 'done', started: 60 * 24 + 40, duration: 95, cost: 0.09 },
        { status: 'done', started: 60 * 24 + 37, duration: 610, cost: 0.41 },
      ],
    },
  },
  {
    reference: '#131',
    repo: 'mobile-app',
    by: 'AN',
    title: 'Push мэдэгдэл',
    pipeline: 'quick',
    criteria: ['Шинэ захиалгад push мэдэгдэл ирнэ'],
    ticketStatus: 'done',
    run: {
      status: 'done',
      current: 1,
      createdMinutesAgo: 5 * 24 * 60 + 60,
      finished: daysAgo(5, 14),
      mergeRequest: 81,
      steps: [
        { status: 'done', started: 5 * 24 * 60 + 60, duration: 105, cost: 0.1 },
        { status: 'done', started: 5 * 24 * 60 + 57, duration: 720, cost: 0.47 },
      ],
    },
  },
];

const HISTORY_TITLES = [
  'Нууц үг сэргээх имэйл засах',
  'Сагсны тоо шинэчлэгдэхгүй байгааг засах',
  'Захиалгын түүхэнд хуудаслалт нэмэх',
  'API хариуны хугацааг лог руу бичих',
  'Бүтээгдэхүүний зургийг шахах',
  'Хэрэглэгчийн хайлтыг хурдасгах',
  'Төлбөрийн webhook-ийг давтан оролдох',
  'Админд хэрэглэгч түгжих эрх нэмэх',
  'Хуучин endpoint-уудыг устгах',
  'Имэйл загварт лого нэмэх',
  'Тайлангийн огнооны шүүлтүүр засах',
  'Docker дүрсийг жижигрүүлэх',
  'Нэвтрэх хуудасны ачааллыг хурдасгах',
  'Мэдэгдлийн тохиргоо нэмэх',
  'Валютын ханшийг кэшлэх',
  'CI-д lint алхам нэмэх',
  'Нэхэмжлэхийн дугаарлалт засах',
  'Хэрэглэгчийн профайлд утас нэмэх',
  'Health check endpoint нэмэх',
  'Хуудасны гарчгийг орчуулах',
  'Захиалга цуцлах товч нэмэх',
  'Зургийн upload-ийн хэмжээ хязгаарлах',
];

/**
 * The finished tickets behind the dashboard's figures: with #136, #135, #131
 * and the failed #141 they make 48 decided tickets of which 44 reached a
 * merge request on attempt 1 unedited — the design's "92% · 48". Eleven
 * merge requests fall inside the last seven days.
 */
function history(): TicketPlan[] {
  const doneByRepo: Record<string, number> = {
    'shop-frontend': 11,
    'billing-api': 8,
    'admin-console': 4,
    'worker-service': 4,
    gateway: 6,
    'mobile-app': 4,
    'docs-site': 5,
    'reports-service': 2,
  };
  const repos = Object.entries(doneByRepo).flatMap(([repo, n]) => Array<string>(n).fill(repo));
  // Days ago each merge request was opened: eight more inside the week (with
  // #136, #135 and #131, eleven), the rest spread across the month.
  const inWeek = [0, 1, 2, 3, 3, 4, 5, 6];
  const refs = Array.from({ length: 45 }, (_, i) => 90 + i).filter((n) => n !== 131);
  return refs.map((n, i) => {
    const days = i < inWeek.length ? (inWeek[i] as number) : 7 + ((i * 7) % 22);
    const finished = daysAgo(days, 10 + (i % 7));
    const created = new Date(finished.getTime() - 70 * MINUTE);
    const pipeline: PipelineKey = i % 3 === 0 ? 'quick' : i % 3 === 1 ? 'standard' : 'reviewed';
    return {
      reference: `#${String(n).padStart(3, '0')}`,
      repo: repos[i % repos.length] as string,
      by: PEOPLE[i % PEOPLE.length]?.key ?? 'GB',
      title: HISTORY_TITLES[i % HISTORY_TITLES.length] as string,
      pipeline,
      criteria: ['Хүлээн авах шалгуур хангагдсан'],
      ticketStatus: 'done' as const,
      createdAt: created,
      run: {
        status: 'done' as const,
        current: null,
        createdMinutesAgo: (now - created.getTime()) / MINUTE,
        finished,
        mergeRequest: n - 30,
        // Two needed a second attempt and one had its plan edited by a
        // person — the three that are not first-attempt successes.
        attempt: i === 20 || i === 33 ? 2 : 1,
        steps: [],
      },
    };
  });
}

// ---------------------------------------------------------------- writing

async function seed() {
  const agents = await loadAgents();
  const agentList = Object.values(agents);

  const people: Record<string, string> = {};
  for (const person of PEOPLE) {
    const [row] = await sql`insert into users (name, email, role)
                              values (${person.name}, ${person.email}, 'member') returning id`;
    people[person.key] = row?.id as string;
  }
  const owner = people.GB as string;

  const pipelines = {} as Record<PipelineKey, SeededPipeline>;
  for (const [key, def] of Object.entries(PIPELINES) as [
    PipelineKey,
    (typeof PIPELINES)[PipelineKey],
  ][]) {
    const steps = def.kinds.map((kind) => stepOf(kind, agents));
    const [row] = await sql`insert into pipelines (name, description, owner_id, current_version)
                              values (${def.name}, ${def.description}, ${owner}, 1) returning id`;
    const id = row?.id as string;
    await sql`insert into pipeline_versions (pipeline_id, version, steps, created_by)
              values (${id}, 1, ${JSON.stringify(steps)}::jsonb, ${owner})`;
    pipelines[key] = { id, name: def.name, steps, kinds: [...def.kinds] };
  }

  const repositories: Record<
    string,
    { id: string; cloneUrl: string; provider: 'gitlab' | 'github'; branch: string; path: string }
  > = {};
  for (const repo of REPOSITORIES) {
    const expired = 'expired' in repo && repo.expired;
    const [credential] =
      await sql`insert into credentials (kind, ciphertext, key_version, status, created_by)
                                     values ('git', 'demo', 'demo', ${expired ? 'invalid' : 'valid'}, ${owner})
                                     returning id`;
    const path = `netgroup/${repo.name}`;
    const cloneUrl = `https://${repo.provider}.${DOMAIN}/${path}.git`;
    const [row] = await sql`
      insert into repositories (name, full_path, provider, clone_url, default_branch, credential_id,
                                default_pipeline_id, status, status_detail)
      values (${repo.name}, ${path}, ${repo.provider}, ${cloneUrl}, ${repo.branch}, ${credential?.id as string},
              ${pipelines[repo.pipeline].id}, ${expired ? 'credential_expired' : 'connected'},
              ${expired ? 'Токены хугацаа дууссан' : null})
      returning id`;
    repositories[repo.name] = {
      id: row?.id as string,
      cloneUrl,
      provider: repo.provider,
      branch: repo.branch,
      path,
    };
  }

  const tickets = [...history(), ...CURRENT];
  let historyIndex = 0;
  for (const plan of tickets) {
    const repo = repositories[plan.repo];
    const pipeline = pipelines[plan.pipeline];
    if (!repo || !pipeline) throw new Error(`unknown repository or pipeline for ${plan.reference}`);
    const created = plan.createdAt ?? ago((plan.run?.createdMinutesAgo ?? 3) + 1);
    const branch = `factory/${plan.reference.slice(1)}-${plan.repo.split('-')[0]}`;
    const mergeRequestUrl = plan.run?.mergeRequest
      ? `https://${repo.provider}.${DOMAIN}/${repo.path}/-/merge_requests/${plan.run.mergeRequest}`
      : null;

    const [ticket] = await sql`
      insert into tickets (repository_id, created_by, reference, title, description, acceptance_criteria,
                           pipeline_id, pipeline_version, status, branch_name, merge_request_url,
                           has_ui, ui_rationale, created_at, updated_at)
      values (${repo.id}, ${people[plan.by] as string}, ${plan.reference}, ${plan.title},
              ${plan.description ?? null}, ${sql.array(plan.criteria)}, ${pipeline.id}, 1,
              ${plan.ticketStatus}, ${plan.run ? branch : null}, ${mergeRequestUrl},
              ${plan.hasUi ?? null}, ${plan.uiRationale ?? null}, ${at(created)},
              ${at(plan.run?.finished ?? ago(plan.run ? Math.max(0.2, (plan.run.steps.at(-1)?.started ?? 1) - 0.1) : 1))})
      returning id`;
    const ticketId = ticket?.id as string;
    if (!plan.run) continue;

    const attempts = plan.run.attempt ?? 1;
    let runId = '';
    for (let attempt = 1; attempt <= attempts; attempt++) {
      const final = attempt === attempts;
      runId = randomUUID();
      const status = final ? plan.run.status : 'failed';
      const snapshot: PipelineSnapshot = {
        run_id: runId,
        attempt,
        ticket: {
          reference: plan.reference,
          title: plan.title,
          description: plan.description ?? null,
          acceptance_criteria: plan.criteria,
        },
        repo: {
          clone_url: repo.cloneUrl,
          default_branch: repo.branch,
          branch,
          provider: repo.provider,
          credential_ref: 'demo',
        },
        pipeline: { id: pipeline.id, version: 1, name: pipeline.name, steps: pipeline.steps },
        limits: { cost_ceiling_usd: '5.0000', time_ceiling_minutes: 45 },
        agents: agentList,
        callback_url: 'http://localhost:5173/api/hooks/orchestrator',
        resume_secret: `demo-${randomUUID()}`,
      };
      const runCreated = final
        ? ago(plan.run.createdMinutesAgo)
        : new Date(created.getTime() + 5 * MINUTE);
      const started = plan.run.status === 'queued' && final ? null : runCreated;
      const finished = final
        ? (plan.run.finished ?? null)
        : new Date(runCreated.getTime() + 20 * MINUTE);
      const steps = stepsOf(plan, pipeline, final, runCreated, finished);
      const cost = steps.reduce((sum, s) => sum + (s.cost ?? 0), 0);

      await sql`
        insert into runs (id, ticket_id, attempt, snapshot, status, current_step_index, container_id,
                          runner_image, cost_usd, cost_ceiling_usd, time_ceiling_minutes, failure_reason,
                          failure_step_index, started_at, finished_at, created_at, updated_at)
        values (${runId}, ${ticketId}, ${attempt}, ${JSON.stringify(snapshot)}::jsonb, ${status},
                ${final ? plan.run.current : 3}, ${status === 'running' || status === 'waiting_approval' ? `demo-${runId.slice(0, 8)}` : null},
                ${started ? 'code-factory/sandbox:latest' : null}, ${money(cost)}, '5.0000', 45,
                ${final ? (plan.run.failure ?? null) : 'Хөгжүүлэлт дээр тест унасан'},
                ${final ? (plan.run.failure ? plan.run.current : null) : 3},
                ${at(started)}, ${at(finished)}, ${at(runCreated)}, ${at(finished ?? ago(0.1))})`;

      for (const [index, step] of steps.entries()) {
        if (step.status === 'waiting') continue;
        const stepStarted = step.started;
        const stepFinished = step.finishedAt;
        const tokens = tokensFor(step.cost);
        await sql`
          insert into step_results (run_id, step_index, status, condition_not_met, started_at, finished_at,
                                    duration_s, cost_usd, input_tokens, output_tokens,
                                    cache_creation_tokens, cache_read_tokens, summary)
          values (${runId}, ${index}, ${step.status}, ${step.reason ?? null}, ${at(stepStarted)},
                  ${at(stepFinished)}, ${step.duration ?? null}, ${money(step.cost ?? 0)},
                  ${tokens.input}, ${tokens.output}, ${tokens.cacheCreation}, ${tokens.cacheRead},
                  ${step.status === 'done' ? 'Дууссан' : null})`;
      }

      await artifactsFor(plan, pipeline, runId, attempt, final, people, historyIndex);
    }
    await sql`update tickets set current_run_id = ${runId} where id = ${ticketId}`;
    if (!plan.createdAt) continue;
    historyIndex += 1;
  }

  await logFor('#142', 4);
  await approvalsFor(people);
}

interface WrittenStep {
  /** `waiting` is a checkpoint the run stopped at: no row, as the callback writes none. */
  status: 'done' | 'running' | 'skipped' | 'failed' | 'waiting';
  started?: Date;
  finishedAt?: Date;
  duration?: number;
  cost?: number;
  reason?: string;
}

/** The step rows of one run: as planned for a current ticket, derived for a finished one. */
function stepsOf(
  plan: TicketPlan,
  pipeline: SeededPipeline,
  final: boolean,
  runCreated: Date,
  finished: Date | null,
): WrittenStep[] {
  const run = plan.run;
  if (!run) return [];
  if (run.steps.length > 0 && final) {
    return run.steps.map((step) => {
      const started = step.started === undefined ? undefined : ago(step.started);
      const done = step.status === 'done' || step.status === 'failed';
      return {
        status: step.status,
        started,
        finishedAt:
          done && started && step.duration
            ? new Date(started.getTime() + step.duration * 1000)
            : undefined,
        duration: done ? step.duration : undefined,
        cost: step.cost,
        reason: step.reason,
      };
    });
  }
  if (run.status === 'queued' && final) return [];
  // A finished run in the history: every step done, a skipped design step for
  // a ticket without interface work, a short time and a small cost each.
  const end = finished ?? new Date(runCreated.getTime() + 20 * MINUTE);
  const count = final ? pipeline.steps.length : 4;
  const span = (end.getTime() - runCreated.getTime()) / Math.max(1, count);
  return Array.from({ length: count }, (_, i) => {
    const kind = pipeline.kinds[i];
    if (kind === 'design' || kind === 'design-gate') {
      return { status: 'skipped' as const, reason: 'интерфейс өөрчлөгдөхгүй' };
    }
    const started = new Date(runCreated.getTime() + i * span);
    const lastOfFailed = !final && i === count - 1;
    return {
      status: lastOfFailed ? ('failed' as const) : ('done' as const),
      started,
      finishedAt: new Date(started.getTime() + span * 0.9),
      duration: Math.round((span * 0.9) / 1000),
      cost: kind === 'gate' ? 0 : 0.08 + ((i * 7) % 5) / 100,
    };
  });
}

async function artifactsFor(
  plan: TicketPlan,
  pipeline: SeededPipeline,
  runId: string,
  attempt: number,
  final: boolean,
  people: Record<string, string>,
  historyIndex: number,
) {
  const run = plan.run;
  if (!run || run.status === 'queued') return;
  const reached = run.steps.length > 0 ? run.steps.length : pipeline.steps.length;
  const insert = async (
    stepIndex: number,
    kind: string,
    path: string,
    content: string | null,
    extra: { bytes?: Buffer; screenName?: string; createdBy?: string } = {},
  ) => {
    await sql`insert into artifacts (run_id, step_index, kind, path, version, content, bytes, screen_name, created_by)
              values (${runId}, ${stepIndex}, ${kind}, ${path}, 1, ${content}, ${extra.bytes ?? null},
                      ${extra.screenName ?? null}, ${extra.createdBy ?? null})`;
  };
  const indexOf = (kind: Kind) => pipeline.kinds.indexOf(kind);
  const doneBefore = (kind: Kind) =>
    indexOf(kind) >= 0 &&
    indexOf(kind) < reached &&
    (run.steps[indexOf(kind)]?.status ?? 'done') === 'done';

  if (doneBefore('spec')) await insert(indexOf('spec'), 'document', 'docs/spec.md', specFor(plan));
  if (doneBefore('design') && plan.hasUi) {
    const designAt = indexOf('design');
    await insert(designAt, 'design_file', 'docs/design/ui.pen', null);
    const names =
      plan.reference === '#137'
        ? [
            ['01-profile.png', 'Профайл'],
            ['02-edit.png', 'Засах маягт'],
            ['03-avatar.png', 'Зураг солих'],
            ['04-saved.png', 'Хадгалсан'],
          ]
        : [
            ['01-signin.png', 'Нэвтрэх'],
            ['02-consent.png', 'Зөвшөөрөл'],
            ['03-error.png', 'Алдаа'],
            ['04-welcome.png', 'Тавтай морил'],
          ];
    for (const [i, [file, name]] of names.entries()) {
      await insert(designAt, 'screen', `docs/design/screens/${file}`, null, {
        bytes: screen(i),
        screenName: name,
      });
    }
  }
  if (doneBefore('plan')) {
    // One finished ticket's plan was edited by a person at its checkpoint —
    // what keeps it out of the first-attempt count.
    const edited = final && attempt === 1 && historyIndex === 28 && plan.createdAt !== undefined;
    await insert(
      indexOf('plan'),
      'document',
      'docs/plan.md',
      planFor(plan),
      edited ? { createdBy: people.AN } : {},
    );
  }
  if (doneBefore('tasks'))
    await insert(indexOf('tasks'), 'document', 'docs/tasks.md', tasksFor(plan));
  if (run.status === 'done' || plan.reference === '#142') {
    await insert(
      indexOf('implement'),
      'commits',
      plan.reference === '#142' ? '4 commit' : '3 commit',
      null,
    );
  }
}

function specFor(plan: TicketPlan) {
  return `# Тодорхойлолт: ${plan.title}\n\n## Хүлээн авах шалгуур\n\n${plan.criteria.map((c) => `- ${c}`).join('\n')}\n`;
}

function planFor(plan: TicketPlan) {
  if (plan.reference === '#139') {
    return `# Төлөвлөгөө: Нэхэмжлэхийн PDF-ийн алдаа засах

Үндсэн шалтгаан: InvoiceRenderer-ийн үүсгэдэг PDF нь Docker дүрсэнд багтаагүй фонт ашигладаг тул монгол үсэг дөрвөлжин болж харагдана.

## Арга барил

1. Inter болон Noto Sans Mongolian фонтыг дүрсэнд (Dockerfile) багтааж, рендэрийг тогтвортой болгоно.
2. Хуудасны хэмжээ, захын тогтмолуудыг src/invoice/layout.ts руу зөөж, урт хүснэгтийг хуудсаар хуваана.
3. Жишиг файлын тест нэмнэ: нэхэмжлэх рендэрлэж, хадгалсан PNG-ийн хэштэй харьцуулна.

## Өөрчлөх файлууд

- Dockerfile
- src/invoice/InvoiceRenderer.ts
- src/invoice/layout.ts
- test/invoice/render.spec.ts

## Эрсдэл

- Дүрсний хэмжээ ~4 MB нэмэгдэнэ. Хүлээн зөвшөөрөхүйц.
- Хуучин PDF-үүд фонтоос болж арай өөр харагдана. Хувилбарын тэмдэглэлд тусгана.
`;
  }
  return `# Төлөвлөгөө: ${plan.title}\n\n## Арга барил\n\n1. Одоогийн кодыг судална.\n2. Өөрчлөлтийг хийж тест нэмнэ.\n`;
}

function tasksFor(plan: TicketPlan) {
  return `# Даалгавар: ${plan.title}\n\n- [ ] T1 Өөрчлөлтийг хийх\n- [ ] T2 Тест нэмэх\n- [ ] T3 Баримт шинэчлэх\n- [ ] T4 Шалгах\n`;
}

async function logFor(reference: string, stepIndex: number) {
  const [run] = await sql`select r.id from runs r join tickets t on t.current_run_id = r.id
                            where t.reference = ${reference}`;
  if (!run) return;
  const lines = [
    '$ claude -p --model claude-sonnet-5',
    'docs/tasks.md уншиж байна — 4 даалгавар',
    'T1: src/auth/google.ts үүсгэж байна',
    'T2: нэвтрэх хуудсанд «Google-ээр үргэлжлүүлэх» товч нэмж байна',
    'bun test tests/auth — 12 тест амжилттай',
    'T3: шинэ хэрэглэгчийн бүртгэл үүсгэх урсгал',
  ];
  for (const [seq, text] of lines.entries()) {
    await sql`insert into log_chunks (run_id, step_index, seq, stream, text, at)
              values (${run.id}, ${stepIndex}, ${seq + 1}, 'stdout', ${`${text}\n`}, ${at(ago(4 - seq * 0.5))})`;
  }
}

/** The history on the approval page of #139: the specification was approved by Ana. */
async function approvalsFor(people: Record<string, string>) {
  const [run] = await sql`select r.id from runs r join tickets t on t.current_run_id = r.id
                            where t.reference = '#139'`;
  if (!run) return;
  await sql`insert into approvals (run_id, step_index, decided_by, decision, decided_at)
            values (${run.id}, 1, ${people.AN as string}, 'approved', ${at(ago(20))})`;
}

// ---------------------------------------------------------------- main

try {
  await reset();
  if (Bun.argv.includes('--reset')) {
    console.log('demo rows removed');
  } else {
    await seed();
    const [counts] = await sql`
      select (select count(*)::int from repositories where clone_url like ${`%.${DOMAIN}/%`}) as repositories,
             (select count(*)::int from tickets t join repositories r on r.id = t.repository_id
               where r.clone_url like ${`%.${DOMAIN}/%`}) as tickets`;
    console.log(
      `demo rows written: ${counts?.repositories} repositories, ${counts?.tickets} tickets`,
    );
  }
} finally {
  await sql.end();
}
