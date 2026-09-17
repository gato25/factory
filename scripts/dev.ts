#!/usr/bin/env bun
/**
 * Everything a run needs, from one command.
 *
 *   bun run dev
 *
 * Three things have to be up before a ticket can execute — Postgres, the
 * runner and the web app — plus a schema. Starting them by hand is several
 * commands across several terminals, and forgetting one produces a confusing
 * failure much later. That is not a documentation problem; it is a missing
 * command.
 *
 * Everything runs on this machine directly, Postgres included when
 * `DATABASE_MODE=system` names one you installed; with the default,
 * `DATABASE_MODE=docker`, Postgres is the one thing still started in a
 * container. There used to be a fourth service, an orchestration workflow in
 * n8n, and it was where most of what went wrong on a first run went wrong;
 * the runner drives runs itself now, and writes each run's position to disk
 * so a restart resumes it.
 *
 * What this does, in order, stopping at the first thing that genuinely blocks:
 *
 *   1. The environment, read once here and handed to both services
 *   2. Postgres — started in Docker and waited for, or reached where it is —
 *      and the two databases, made if they are missing
 *   3. The database schema
 *   4. The execution host — the tools a step runs, or the sandbox image
 *   5. The runner and the web app, together, until you stop them
 *
 * Every step says what it is doing and what it found, because the point is to
 * be able to see WHERE it stopped rather than to hide the steps.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import { quote } from '../apps/runner/src/container/shell';
import { resolveShell } from '../apps/runner/src/container/shell-path';
import { createClient } from '../packages/db/src/client';
import { stopTree } from './lib/process-tree';

const BOLD = '[1m';
const DIM = '[2m';
const RED = '[31m';
const GREEN = '[32m';
const YELLOW = '[33m';
const BLUE = '[34m';
const OFF = '[0m';

const SANDBOX_IMAGE = 'code-factory/sandbox:latest';

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

/**
 * Runs a command and returns its output, never throwing.
 *
 * `quiet` captures both streams, for a command whose output is only wanted if
 * it fails. `stream` shows both as they happen, for a command that takes long
 * enough that silence reads as a hang — which is not a stylistic choice: the
 * first version of this file ran `docker compose up` quietly, and on a first
 * run that is several hundred megabytes of image downloading with nothing at
 * all on screen. It looked exactly like a crash.
 */
async function sh(
  argv: string[],
  options: { cwd?: string; quiet?: boolean; stream?: boolean; env?: Record<string, string> } = {},
): Promise<{ code: number; out: string }> {
  // This process's environment plus anything named here, so one command can
  // be pointed somewhere else without moving what every other child sees.
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

/**
 * A command through the POSIX shell, which is where `claude` and `git`
 * resolve on every platform — on Windows they are links and shims the shell
 * that comes with Git knows how to run, and that shell is not on the PATH
 * there. Same resolver the runner uses, so what this checks and what a step
 * gets are the same shell.
 */
function viaShell(argv: string[]): string[] {
  return [resolveShell(), '-c', quote(argv)];
}

/** Stops with a reason and, where there is one, the thing to do about it. */
function stop(reason: string, remedy?: string): never {
  console.error(`\n${RED}${BOLD}Stopped:${OFF} ${reason}`);
  if (remedy) console.error(`${DIM}${remedy}${OFF}`);
  process.exit(1);
}

// --- 1. the environment ------------------------------------------------------

/**
 * Reads `.env` and puts anything not already set into this process, so that
 * every child inherits it as a real environment variable.
 *
 * This is the one thing running the services separately could not do.
 * `bun run dev:runner` starts the execution service with its working directory
 * in `apps/runner`, and Bun reads `.env` only from the directory it starts in —
 * so the execution service never saw the root `.env` at all. It fell back to
 * its built-in development credential while the web application used the
 * `RUNNER_AUTH_TOKEN` that had just been set next to it, and every call between
 * the two came back `unauthorised`: a credential failure that looks, from the
 * screen reporting it, like a credential that was typed in wrongly.
 *
 * A real variable already exported in the shell wins, which is the same
 * precedence Bun itself applies — someone overriding one value for one run
 * should not have the file silently undo it.
 */
function loadEnvFile(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const at = trimmed.indexOf('=');
    if (at < 1) continue;
    const key = trimmed.slice(0, at).trim();
    let value = trimmed.slice(at + 1).trim();
    // `KEY="value"` and `KEY='value'` both appear in the wild; the quotes are
    // the file's syntax, not part of the credential.
    if (value.length > 1 && /^(?:"|')/.test(value) && value.at(-1) === value[0]) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

/** Values that mean "this was copied from the example and never filled in". */
const PLACEHOLDERS = new Set(['change-me', 'change-me-to-32-plus-random-bytes']);

/**
 * Where the two services listen, when nobody has said otherwise.
 *
 * The execution service defaults itself to 8080 and Vite serves 5173 — so on
 * this machine there is exactly one right answer for each, already written
 * down in the repository. The web application applies the same defaults for
 * itself; they are repeated here so that what this script checks and what it
 * starts agree.
 */
const DEV_DEFAULTS: Record<string, string> = {
  RUNNER_BASE_URL: 'http://localhost:8080',
  PUBLIC_BASE_URL: 'http://localhost:5173',
};

/** What the web application refuses to start without, and cannot default. */
const REQUIRED = ['DATABASE_URL', 'RUNNER_AUTH_TOKEN', 'SESSION_SECRET'];

step('1/5  Environment');

const envFile = Bun.file('.env');
if (!(await envFile.exists())) {
  stop('There is no .env.', 'cp .env.example .env — the comments in it say what each value is.');
}

const fileValues = loadEnvFile(await envFile.text());
for (const [key, value] of Object.entries(fileValues)) {
  if (process.env[key] === undefined) process.env[key] = value;
}
ok(`.env read — ${Object.keys(fileValues).length} values, given to both services`);

const defaulted: string[] = [];
for (const [key, value] of Object.entries(DEV_DEFAULTS)) {
  if (!process.env[key] || PLACEHOLDERS.has(process.env[key] ?? '')) {
    process.env[key] = value;
    defaulted.push(key);
  }
}
if (defaulted.length > 0) ok(`Local addresses assumed: ${defaulted.join(', ')}`);

const unset = REQUIRED.filter((key) => {
  const value = process.env[key];
  return !value || PLACEHOLDERS.has(value);
});
if (unset.length > 0) {
  stop(
    `Still to fill in, in .env: ${unset.join(', ')}`,
    'The web application refuses to start without these, so it is better to say so here.',
  );
}
if (!process.env.SECRET_ENCRYPTION_KEY) {
  // Not fatal: everything starts and the interface works. It fails at the
  // moment a credential is SAVED, which is far enough from here to be worth
  // naming now.
  warn('SECRET_ENCRYPTION_KEY is not set — saving a credential in Settings will fail.');
  note('openssl rand -base64 32');
}
// The web application copies the runner's address from .env into Settings
// when it starts, and a model key too if there is one. Saying so here is
// what stops somebody opening Settings expecting to type them.
if (process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_OAUTH_TOKEN) {
  if (process.env.SECRET_ENCRYPTION_KEY)
    ok('Model key found — Settings will be filled in at start');
  else warn('A model key is in .env but cannot be stored until SECRET_ENCRYPTION_KEY is set.');
} else {
  note('No model key in .env — paste one in Settings, or set ANTHROPIC_API_KEY here.');
}

const executionHost = process.env.EXECUTION_HOST || 'process';
if (executionHost !== 'process' && executionHost !== 'docker') {
  stop(`EXECUTION_HOST is "${executionHost}"; it must be "process" or "docker".`);
}

/**
 * Where Postgres comes from. `docker` starts the one in docker-compose.yml
 * and is the default, because it needs nothing installed. `system` uses a
 * Postgres already on this machine — or anywhere DATABASE_URL points — and
 * then Docker is not needed at all for a development machine that also runs
 * its steps as processes.
 */
const databaseMode = process.env.DATABASE_MODE || 'docker';
if (databaseMode !== 'docker' && databaseMode !== 'system') {
  stop(`DATABASE_MODE is "${databaseMode}"; it must be "docker" or "system".`);
}
const databaseUrl = process.env.DATABASE_URL as string;

/** Whether Docker answers, asked once and only when something needs it. */
async function dockerVersion(): Promise<string | null> {
  const probe = await sh(['docker', 'version', '--format', '{{.Server.Version}}'], {
    quiet: true,
  });
  return probe.code === 0 ? probe.out.trim() : null;
}

// --- 2. Postgres -------------------------------------------------------------

step(`2/5  Postgres (${databaseMode})`);

/** The address without its password, for a line on screen. */
function describeDatabase(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}:${parsed.port || '5432'}${parsed.pathname}`;
  } catch {
    return 'DATABASE_URL';
  }
}

/**
 * Whether Postgres answers at `url`, and if the database named in it does not
 * exist, whether that is the only thing wrong. Postgres says so with a
 * specific code (`3D000`), which is what lets the database be made rather
 * than the whole thing reported as unreachable.
 */
async function probeDatabase(
  url: string,
): Promise<{ state: 'ok' | 'no-database' | 'down'; detail: string }> {
  const { sql } = createClient(url);
  try {
    await sql`select 1`;
    return { state: 'ok', detail: '' };
  } catch (error) {
    const code = (error as { code?: string }).code;
    const detail = error instanceof Error ? error.message : String(error);
    return { state: code === '3D000' ? 'no-database' : 'down', detail };
  } finally {
    await sql.end({ timeout: 2 }).catch(() => {});
  }
}

/**
 * Makes the database `url` names, on the same server, through its
 * maintenance database. A name is checked before it becomes SQL: it comes
 * from `.env`, which is the developer's, but a quoted identifier is cheap.
 */
async function createDatabase(url: string): Promise<{ created: boolean; detail: string }> {
  const target = new URL(url);
  const name = target.pathname.replace(/^\//, '');
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    return { created: false, detail: `"${name}" is not a name this script will create` };
  }
  const maintenance = new URL(url);
  maintenance.pathname = '/postgres';
  const { sql } = createClient(maintenance.toString());
  try {
    await sql.unsafe(`create database "${name}"`);
    return { created: true, detail: '' };
  } catch (error) {
    return { created: false, detail: error instanceof Error ? error.message : String(error) };
  } finally {
    await sql.end({ timeout: 2 }).catch(() => {});
  }
}

/** Reachable, with its database in place — made if it was not. */
async function ensureDatabase(url: string, what: string): Promise<void> {
  const first = await probeDatabase(url);
  if (first.state === 'ok') {
    ok(`${what} at ${describeDatabase(url)}`);
    return;
  }
  if (first.state === 'down') {
    stop(
      `Postgres did not answer at ${describeDatabase(url)}: ${first.detail}`,
      databaseMode === 'system'
        ? 'Start it, check DATABASE_URL in .env, or set DATABASE_MODE=docker to use the one in docker-compose.yml.'
        : 'docker compose logs postgres — that says why.',
    );
  }
  const made = await createDatabase(url);
  if (!made.created) {
    stop(
      `The database at ${describeDatabase(url)} does not exist and could not be created: ${made.detail}`,
    );
  }
  const second = await probeDatabase(url);
  if (second.state !== 'ok') stop(`Created the database, but it did not answer: ${second.detail}`);
  ok(`${what} at ${describeDatabase(url)} — created, it was missing`);
}

if (databaseMode === 'docker') {
  const docker = await dockerVersion();
  if (!docker) {
    stop(
      'Docker is not answering.',
      'DATABASE_MODE=docker starts Postgres in a container, so Docker has to be running. ' +
        'Or install Postgres, point DATABASE_URL at it and set DATABASE_MODE=system.',
    );
  }
  ok(`Docker ${docker}`);

  // Streamed, not captured. The first run downloads the image, which takes a
  // while, and a silent minute is indistinguishable from a hung one.
  note('The first run downloads Postgres — a couple of hundred MB, once.');
  const up = await sh(['docker', 'compose', 'up', '-d', 'postgres'], { stream: true });
  if (up.code !== 0) {
    stop('`docker compose up` failed.', 'The reason is in the output just above.');
  }
}

/** Waits for compose to report a service healthy, rather than guessing a delay. */
async function waitHealthy(service: string, seconds = 120): Promise<boolean> {
  for (let waited = 0; waited < seconds; waited += 2) {
    const state = await sh(['docker', 'compose', 'ps', '--format', '{{.Health}}', service], {
      quiet: true,
    });
    if (state.out.includes('healthy')) return true;
    // Said out loud every ten seconds. A service that is slow to become
    // healthy and a service that never will are the same picture otherwise.
    if (waited > 0 && waited % 10 === 0) note(`still waiting for ${service} (${waited}s)`);
    await Bun.sleep(2000);
  }
  return false;
}

if (databaseMode === 'docker' && !(await waitHealthy('postgres'))) {
  stop('Postgres did not become healthy.', 'docker compose logs postgres — that says why.');
}

// The application's database, and the one the tests empty — both made if
// they are missing, whichever Postgres this is. The tests' default is the
// same server with `_test` on the name; TEST_DATABASE_URL moves it.
await ensureDatabase(databaseUrl, 'Database');
const testUrl =
  process.env.TEST_DATABASE_URL ||
  (() => {
    const url = new URL(databaseUrl);
    url.pathname = `${url.pathname.replace(/_test$/, '')}_test`;
    return url.toString();
  })();
await ensureDatabase(testUrl, 'Test database');

// --- 3. the schema -----------------------------------------------------------

step('3/5  Database schema');
const migrated = await sh(['bun', 'run', 'db:migrate'], { quiet: true });
if (migrated.code !== 0) stop('Migrations failed.', migrated.out.trim());

/*
 * The tests' database needs the same schema, and nothing else gives it one:
 * the fixtures empty and refill it but never migrate it. Created empty above
 * and left that way, it sends `bun run test` into `relation "…" does not
 * exist` on a machine where everything is in fact set up correctly.
 */
const migratedTest = await sh(['bun', 'run', 'db:migrate'], {
  quiet: true,
  env: { DATABASE_URL: testUrl },
});
if (migratedTest.code !== 0) {
  stop("The test database's migrations failed.", migratedTest.out.trim());
}
ok('Schema is current, in both databases');

// --- 4. the execution host ---------------------------------------------------

step('4/5  Execution host');

if (executionHost === 'docker') {
  if (!(await dockerVersion())) {
    stop(
      'Docker is not answering.',
      'EXECUTION_HOST=docker runs every step in a container, so Docker has to be running.',
    );
  }
  const existing = await sh(['docker', 'images', '-q', SANDBOX_IMAGE], { quiet: true });
  if (existing.out.trim()) {
    ok(`${SANDBOX_IMAGE} already built`);
    note('Rebuild it yourself after changing infra/sandbox/Dockerfile.');
  } else {
    note(`Building ${SANDBOX_IMAGE} — the first time takes a few minutes.`);
    const built = await sh(['docker', 'build', '-t', SANDBOX_IMAGE, 'infra/sandbox']);
    if (built.code !== 0) {
      stop(
        'The sandbox image did not build.',
        'Every run executes inside it, so nothing can run until this succeeds.',
      );
    }
    ok('Built');
  }
} else {
  /**
   * Runs execute as processes on this machine, so what a step needs is what
   * this machine has. Asked through the same shell a step will use, so a
   * tool the shell cannot see is found out here and not at the first step.
   */
  let shell: string;
  try {
    shell = resolveShell();
  } catch (error) {
    stop(error instanceof Error ? error.message : String(error));
  }
  if (process.platform === 'win32') note(`POSIX shell: ${shell}`);

  const missing: string[] = [];
  for (const tool of ['git', 'claude']) {
    const probe = await sh(viaShell([tool, '--version']), { quiet: true });
    if (probe.code === 0) ok(`${tool}: ${probe.out.trim().split('\n')[0]}`);
    else missing.push(tool);
  }
  if (missing.length > 0) {
    // Not fatal — the interface works, and a shell-only pipeline still runs.
    // But every agent step will fail, and it is better said here than there.
    warn(`Not found: ${missing.join(', ')} — every agent step will fail until it is installed.`);
    if (missing.includes('claude')) note('npm install -g @anthropic-ai/claude-code');
  }
  const workDir = process.env.FACTORY_WORK_DIR || join(homedir(), '.code-factory', 'runs');
  ok(`Runs execute as processes under ${workDir}`);
  note(
    `Each run's position is kept under ${join(homedir(), '.code-factory', 'state')}, so a restart resumes it.`,
  );

  // Run it publishes a port and needs a container for it, whichever host runs
  // execute on. Not built here — it is minutes of work for a card most
  // sessions never press — but named, so its failure has an explanation.
  if (await dockerVersion()) {
    const image = await sh(['docker', 'images', '-q', SANDBOX_IMAGE], { quiet: true });
    if (!image.out.trim()) {
      note(
        `The Run it card needs the sandbox image: docker build -t ${SANDBOX_IMAGE} infra/sandbox`,
      );
    }
  } else {
    note('Docker is not running, so the Run it card will not work; everything else does.');
  }
}

// --- 5. the two services that stay in the foreground -------------------------

step('5/5  Runner and web app');
note(
  databaseMode === 'docker'
    ? 'Both run here. Ctrl-C stops them together; Postgres keeps running.'
    : 'Both run here. Ctrl-C stops them together.',
);

/**
 * Runs one long-lived process, tagging each line so two streams in one
 * terminal stay readable.
 */
function serve(label: string, colour: string, argv: string[]) {
  const proc = Bun.spawn(argv, { stdout: 'pipe', stderr: 'pipe' });
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

const runner = serve('runner', BLUE, ['bun', 'run', 'dev:runner']);
const web = serve('web', GREEN, ['bun', 'run', 'dev:web']);

console.log(`\n${BOLD}Open http://localhost:5173${OFF}`);
console.log(`${DIM}If nobody has an account yet it will ask you to create one, and that${OFF}`);
console.log(`${DIM}first account is the administrator.${OFF}\n`);

let stopping = false;
function stopBoth(): void {
  // A second Ctrl-C while the first is still working must not start the walk
  // again half way through it.
  if (stopping) return;
  stopping = true;
  stopTree(runner);
  stopTree(web);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    stopBoth();
    process.exit(0);
  });
}

// If one of them dies on its own, take the other down with it rather than
// leaving half a system up that looks like a whole one.
await Promise.race([runner.exited, web.exited]);
stopBoth();
