#!/usr/bin/env bun
/**
 * Production / compiled start script for Code Factory.
 *
 *   bun run start
 *
 * Starts the production-compiled web application (SvelteKit via adapter-node)
 * and the runner service together, with the database and schema verified.
 */

import { join } from 'node:path';
import { createClient } from '../packages/db/src/client';
import { stopTree } from './lib/process-tree';

const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const OFF = '\x1b[0m';

function step(text: string) {
  console.log(`\n${BOLD}${text}${OFF}`);
}
function ok(text: string) {
  console.log(`  ${GREEN}✓${OFF} ${text}`);
}
function note(text: string) {
  console.log(`  ${DIM}${text}${OFF}`);
}
function warn(text: string) {
  console.log(`  ${YELLOW}!${OFF} ${text}`);
}

async function sh(
  argv: string[],
  options: { cwd?: string; quiet?: boolean; stream?: boolean; env?: Record<string, string> } = {},
): Promise<{ code: number; out: string }> {
  const env = options.env ? { ...process.env, ...options.env } : undefined;
  if (options.stream) {
    const proc = Bun.spawn(argv, {
      cwd: options.cwd,
      env,
      stdout: 'inherit',
      stderr: 'inherit',
    });
    return { code: await proc.exited, out: '' };
  }
  const proc = Bun.spawn(argv, {
    cwd: options.cwd,
    env,
    stdout: options.quiet ? 'pipe' : 'inherit',
    stderr: 'pipe',
  });
  const out = options.quiet ? await new Response(proc.stdout).text() : '';
  const err = await new Response(proc.stderr).text();
  const code = await proc.exited;
  return { code, out: `${out}${err}` };
}

function stop(reason: string, remedy?: string): never {
  console.error(`\n${RED}${BOLD}Stopped:${OFF} ${reason}`);
  if (remedy) console.error(`${DIM}${remedy}${OFF}`);
  process.exit(1);
}

function loadEnvFile(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const at = trimmed.indexOf('=');
    if (at < 1) continue;
    const key = trimmed.slice(0, at).trim();
    let value = trimmed.slice(at + 1).trim();
    if (value.length > 1 && /^(?:"|')/.test(value) && value.at(-1) === value[0]) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

const REQUIRED = ['DATABASE_URL', 'RUNNER_AUTH_TOKEN', 'SESSION_SECRET'];

step('1/4  Environment');

const envFile = Bun.file('.env');
if (!(await envFile.exists())) {
  stop('There is no .env.', 'cp .env.example .env');
}

const fileValues = loadEnvFile(await envFile.text());
for (const [key, value] of Object.entries(fileValues)) {
  if (process.env[key] === undefined) process.env[key] = value;
}
ok(`.env read (${Object.keys(fileValues).length} values)`);

const unset = REQUIRED.filter((key) => !process.env[key]);
if (unset.length > 0) {
  stop(`Missing required variables in .env: ${unset.join(', ')}`);
}

// Determine port for compiled web server:
// Use PORT if set, otherwise extract port from CALLBACK_BASE_URL (e.g. 5173), or default to 5173
let webPort = process.env.PORT;
if (!webPort && process.env.CALLBACK_BASE_URL) {
  try {
    const parsed = new URL(process.env.CALLBACK_BASE_URL);
    if (parsed.port) webPort = parsed.port;
  } catch {}
}
if (!webPort) webPort = '5173';
process.env.PORT = webPort;
process.env.HOST = process.env.HOST || '0.0.0.0';
ok(`Web server target: http://${process.env.HOST}:${webPort}`);

// --- 2. Database & Schema ----------------------------------------------------
step('2/4  Database schema');
const databaseUrl = process.env.DATABASE_URL as string;
const { sql } = createClient(databaseUrl);
try {
  await sql`select 1`;
  ok('Database reachable');
} catch (error) {
  stop(`Database connection failed: ${error instanceof Error ? error.message : String(error)}`);
} finally {
  await sql.end({ timeout: 2 }).catch(() => {});
}

const migrated = await sh(['bun', 'run', 'db:migrate'], { quiet: true });
if (migrated.code !== 0) {
  stop('Database migration failed.', migrated.out.trim());
}
ok('Database migrations verified');

// --- 3. Build Check ----------------------------------------------------------
step('3/4  Compiled artifacts');
const webBuildIndex = Bun.file('apps/web/build/index.js');
if (!(await webBuildIndex.exists())) {
  note('Building @factory/web...');
  const buildResult = await sh(['bun', 'run', '--filter', '@factory/web', 'build'], { stream: true });
  if (buildResult.code !== 0) {
    stop('Build of @factory/web failed.');
  }
}
ok('apps/web/build/index.js is ready');

// --- 4. Start services -------------------------------------------------------
step('4/4  Starting compiled web app and runner');

function serve(
  label: string,
  colour: string,
  argv: string[],
  options: { cwd?: string; envOverrides?: Record<string, string> } = {},
) {
  const proc = Bun.spawn(argv, {
    cwd: options.cwd,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, ...options.envOverrides },
  });
  const tag = `${colour}${label.padEnd(6)}${OFF} `;
  for (const stream of [proc.stdout, proc.stderr]) {
    void (async () => {
      const decoder = new TextDecoder();
      let rest = '';
      for await (const chunk of stream) {
        rest += decoder.decode(chunk, { stream: true });
        const lines = rest.split('\n');
        rest = lines.pop() ?? '';
        for (const line of lines) console.log(`${tag}${line}`);
      }
    })();
  }
  return proc;
}

const runner = serve('runner', BLUE, ['bun', 'run', '--filter', '@factory/runner', 'start']);
const web = serve('web', GREEN, ['bun', 'apps/web/build/index.js'], {
  envOverrides: {
    PORT: webPort,
    HOST: process.env.HOST,
  },
});

const SWEEP_MINUTES = 2;
function sweep(): void {
  const proc = Bun.spawn(['bun', 'scripts/maintenance.ts', '--quiet'], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  void (async () => {
    for (const stream of [proc.stdout, proc.stderr]) {
      const text = await new Response(stream).text();
      for (const line of text.split('\n')) {
        if (line.trim()) console.log(`${DIM}sweep ${OFF} ${line}`);
      }
    }
  })();
}
const sweeper = setInterval(sweep, SWEEP_MINUTES * 60_000);
note(`Ceilings and gates are swept every ${SWEEP_MINUTES} minutes.`);

console.log(`\n${BOLD}Compiled Factory is running at http://${process.env.HOST}:${webPort}${OFF}`);
if (process.env.PUBLIC_BASE_URL) {
  console.log(`${BOLD}Public URL:${OFF} ${process.env.PUBLIC_BASE_URL}\n`);
}

let stopping = false;
function stopBoth(): void {
  if (stopping) return;
  stopping = true;
  clearInterval(sweeper);
  stopTree(runner);
  stopTree(web);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    stopBoth();
    process.exit(0);
  });
}

await Promise.race([runner.exited, web.exited]);
stopBoth();
