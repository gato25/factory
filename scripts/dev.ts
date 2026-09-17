#!/usr/bin/env bun
/**
 * Everything a run needs, from one command.
 *
 *   bun run dev
 *
 * Four things have to be up before a ticket can execute — Postgres, n8n, the
 * runner and the web app — plus a schema. Starting them by hand is several
 * commands across several terminals, and forgetting any one of them produces a
 * different confusing failure much later. That is not a documentation problem;
 * it is a missing command.
 *
 * Everything but Postgres runs on this machine directly. n8n used to run in a
 * container and runs used to execute in one, and every address between the
 * pieces then had to be spelt twice — once as a browser reaches it and once as
 * a container reaches the host it runs on. Most of what went wrong on a first
 * run was one of those addresses; with everything on one machine, `localhost`
 * means the same thing everywhere.
 *
 * What this does, in order, stopping at the first thing that genuinely blocks:
 *
 *   1. The environment, read once here and handed to every service
 *   2. Postgres, via docker compose, waited for until healthy
 *   3. The database schema
 *   4. The execution host — the tools a step runs, or the sandbox image
 *   5. n8n on this machine: installed if missing, the workflow imported and
 *      published, then started
 *   6. The runner and the web app, together with n8n, until you stop them
 *
 * Every step says what it is doing and what it found, because the point is to
 * be able to see WHERE it stopped rather than to hide the steps.
 */

import { Database } from 'bun:sqlite';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { quote } from '../apps/runner/src/container/shell';
import { resolveShell } from '../apps/runner/src/container/shell-path';
import { stopTree } from './lib/process-tree';

const BOLD = '[1m';
const DIM = '[2m';
const RED = '[31m';
const GREEN = '[32m';
const YELLOW = '[33m';
const BLUE = '[34m';
const MAGENTA = '[35m';
const OFF = '[0m';

const SANDBOX_IMAGE = 'code-factory/sandbox:latest';
const WORKFLOW_NAME = 'run-ticket-pipeline';
/** The n8n this was exercised against. Node 24 needs a 2.x release. */
const N8N_VERSION = '2.40.2';
const N8N_PORT = 5678;
/** n8n's own files — its SQLite database, its encryption key — kept beside the runs. */
const N8N_HOME = join(homedir(), '.code-factory', 'n8n');

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
  const env = { ...process.env, ...options.env } as Record<string, string>;
  if (options.stream) {
    const proc = Bun.spawn(argv, { cwd: options.cwd, env, stdout: 'inherit', stderr: 'inherit' });
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
 * A command through the POSIX shell, which is where `n8n`, `claude` and `git`
 * all resolve on every platform — on Windows they are shims and links the
 * shell that comes with Git knows how to run, and that shell is not on the
 * PATH there. Same resolver the runner uses, so what this checks and what a
 * step gets are the same shell.
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
 * Where the other local services listen, when nobody has said otherwise.
 *
 * This script starts n8n on 5678, the execution service defaults itself to
 * 8080 and Vite serves 5173 — so on this machine there is exactly one right
 * answer for each, already written down in the repository. These were
 * required in `.env` and then asked for AGAIN on the settings screen, which is
 * twice for a fact nobody had a choice about.
 *
 * The web application applies the same three defaults for itself; they are
 * repeated here so that what this script checks and what it starts agree.
 */
const DEV_DEFAULTS: Record<string, string> = {
  RUNNER_BASE_URL: 'http://localhost:8080',
  ORCHESTRATOR_BASE_URL: `http://localhost:${N8N_PORT}`,
  PUBLIC_BASE_URL: 'http://localhost:5173',
};

/** What the web application refuses to start without, and cannot default. */
const REQUIRED = ['DATABASE_URL', 'RUNNER_AUTH_TOKEN', 'SESSION_SECRET'];

step('1/6  Environment');

const envFile = Bun.file('.env');
if (!(await envFile.exists())) {
  stop('There is no .env.', 'cp .env.example .env — the comments in it say what each value is.');
}

const fileValues = loadEnvFile(await envFile.text());
for (const [key, value] of Object.entries(fileValues)) {
  if (process.env[key] === undefined) process.env[key] = value;
}
ok(`.env read — ${Object.keys(fileValues).length} values, given to every service`);

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
// The web application copies the two service addresses from .env into
// Settings when it starts, and a model key too if there is one. Saying so
// here is what stops somebody opening Settings expecting to type them.
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

// --- 2. Postgres -------------------------------------------------------------

step('2/6  Postgres');

const docker = await sh(['docker', 'version', '--format', '{{.Server.Version}}'], { quiet: true });
if (docker.code !== 0) {
  stop(
    'Docker is not answering.',
    'Postgres runs in a container, so Docker has to be running before anything else. ' +
      'Or point DATABASE_URL at a Postgres of your own — then this step is yours.',
  );
}
ok(`Docker ${docker.out.trim()}`);

/**
 * The containerised n8n this project used to run, if it is still up.
 *
 * It holds the port the native one is about to take, and a second n8n on the
 * same port fails to bind with a message that names the port and nothing
 * else. Stopped, not removed: its data is still there for anybody who wants
 * to look at it, and `docker compose` will list it as an orphan until they
 * decide.
 */
const oldN8n = await sh(
  [
    'docker',
    'ps',
    '-q',
    '--filter',
    'label=com.docker.compose.project=factory',
    '--filter',
    'label=com.docker.compose.service=n8n',
  ],
  { quiet: true },
);
if (oldN8n.code === 0 && oldN8n.out.trim()) {
  const stopped = await sh(['docker', 'stop', ...oldN8n.out.trim().split(/\s+/)], { quiet: true });
  if (stopped.code === 0) ok('Stopped the old containerised n8n, which held port 5678');
  else
    warn('An old containerised n8n is running and could not be stopped; port 5678 may be taken.');
}

// Streamed, not captured. The first run downloads the image, which takes a
// while, and a silent minute is indistinguishable from a hung one.
note('The first run downloads Postgres — a couple of hundred MB, once.');
const up = await sh(['docker', 'compose', 'up', '-d', 'postgres'], { stream: true });
if (up.code !== 0) {
  stop('`docker compose up` failed.', 'The reason is in the output just above.');
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

if (!(await waitHealthy('postgres'))) {
  stop('Postgres did not become healthy.', 'docker compose logs postgres — that says why.');
}
ok('Postgres is up');

// --- 3. the schema -----------------------------------------------------------

step('3/6  Database schema');
const migrated = await sh(['bun', 'run', 'db:migrate'], { quiet: true });
if (migrated.code !== 0) stop('Migrations failed.', migrated.out.trim());
ok('Schema is current');

// --- 4. the execution host ---------------------------------------------------

step('4/6  Execution host');

if (executionHost === 'docker') {
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

  // Run it publishes a port and needs a container for it, whichever host runs
  // execute on. Not built here — it is minutes of work for a card most
  // sessions never press — but named, so its failure has an explanation.
  const image = await sh(['docker', 'images', '-q', SANDBOX_IMAGE], { quiet: true });
  if (!image.out.trim()) {
    note(`The Run it card needs the sandbox image: docker build -t ${SANDBOX_IMAGE} infra/sandbox`);
  }
}

// --- 5. n8n ------------------------------------------------------------------

step('5/6  n8n');

/**
 * The environment n8n runs with. The two `RUNNER_*` values are what the
 * workflow reads as `$env.RUNNER_BASE_URL` and `$env.RUNNER_AUTH_TOKEN` on
 * every call to the execution service; `N8N_BLOCK_ENV_ACCESS_IN_NODE` is
 * what allows an expression to read them at all.
 */
const n8nEnv: Record<string, string> = {
  N8N_PORT: String(N8N_PORT),
  N8N_USER_FOLDER: N8N_HOME,
  N8N_SECURE_COOKIE: 'false',
  N8N_BLOCK_ENV_ACCESS_IN_NODE: 'false',
  N8N_DIAGNOSTICS_ENABLED: 'false',
  N8N_VERSION_NOTIFICATIONS_ENABLED: 'false',
  GENERIC_TIMEZONE: 'UTC',
  N8N_WEBHOOK_URL: `http://localhost:${N8N_PORT}/`,
  RUNNER_BASE_URL: process.env.RUNNER_BASE_URL ?? DEV_DEFAULTS.RUNNER_BASE_URL ?? '',
  RUNNER_AUTH_TOKEN: process.env.RUNNER_AUTH_TOKEN ?? '',
};

/** Runs an `n8n` subcommand, against the same files the server will use. */
function n8n(...argv: string[]) {
  return sh(viaShell(['n8n', ...argv]), { quiet: true, env: n8nEnv });
}

async function healthy(): Promise<boolean> {
  try {
    const response = await fetch(`http://localhost:${N8N_PORT}/healthz`, {
      signal: AbortSignal.timeout(2000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Whether the workflow's webhook is answering — which is later than healthy.
 *
 * `/healthz` says yes some thirty seconds before n8n's database is ready and
 * its published workflows are registered; in between, the webhook route
 * answers `503 Database is not ready` and, before that, a plain HTML 404. A
 * ticket started in that window comes back as a failure that looks like the
 * application's. So the thing waited for is the route itself: a GET on a
 * POST-only webhook answers a JSON 404 that names the method, and that is
 * the sign it is registered. Nothing is executed by asking.
 */
async function webhookState(): Promise<'not-yet' | 'unpublished' | 'registered'> {
  try {
    const response = await fetch(`http://localhost:${N8N_PORT}/webhook/${WORKFLOW_NAME}`, {
      signal: AbortSignal.timeout(5000),
    });
    const body = await response.text();
    if (response.status === 503 || !body.trimStart().startsWith('{')) return 'not-yet';
    const message = (JSON.parse(body) as { message?: string }).message ?? '';
    return /is not registered\.?$/i.test(message.trim()) ? 'unpublished' : 'registered';
  } catch {
    return 'not-yet';
  }
}

/**
 * The row n8n 2's publication service reads, which its own CLI does not write.
 *
 * Since n8n 2, what the server activates at start is not the workflow marked
 * `active` but the one recorded in `workflow_published_version`; the editor's
 * Publish button writes that row and `publish:workflow` on the command line
 * does not — it sets the flag and the version and stops there. So a workflow
 * imported and published from the command line is listed as active and its
 * webhook still answers "not registered". Filled in here from the version the
 * CLI did record, against the same SQLite file. Idempotent, and quietly
 * skipped on an n8n old enough not to have the table.
 */
function ensurePublishedVersion(id: string): boolean {
  const file = join(N8N_HOME, '.n8n', 'database.sqlite');
  if (!existsSync(file)) return false;
  try {
    const db = new Database(file);
    try {
      db.run(
        `INSERT OR REPLACE INTO workflow_published_version (workflowId, publishedVersionId)
         SELECT id, activeVersionId FROM workflow_entity WHERE id = ? AND activeVersionId IS NOT NULL`,
        [id],
      );
      const row = db
        .query('SELECT publishedVersionId FROM workflow_published_version WHERE workflowId = ?')
        .get(id);
      return Boolean(row);
    } finally {
      db.close();
    }
  } catch {
    return false;
  }
}

/**
 * Whether n8n's own list contains the workflow, matched on IDENTIFIER.
 *
 * `list:workflow` prints `id|name` a line at a time, and the obvious thing is
 * to match the name — but the name is not unique and n8n does not make it so.
 * Anybody who has imported this workflow by hand as well has several rows all
 * called `run-ticket-pipeline`, and matching the name picks whichever n8n
 * happens to list first. That is how you end up activating one workflow and
 * pointing the application at another.
 */
function listed(listing: string, id: string): boolean {
  for (const line of listing.split('\n')) {
    const at = line.indexOf('|');
    if (at > 0 && line.slice(0, at).trim() === id) return true;
  }
  return false;
}

/** The identifier the workflow file itself carries, which the import preserves. */
async function workflowIdFromFile(): Promise<string | undefined> {
  try {
    const parsed = await Bun.file(`orchestration/n8n/${WORKFLOW_NAME}.json`).json();
    return typeof parsed?.id === 'string' ? parsed.id : undefined;
  } catch {
    return undefined;
  }
}

let n8nReady = false;
let n8nProc: ReturnType<typeof Bun.spawn> | undefined;

/**
 * The processes listening on a port, with what they are running.
 *
 * For the one case that is worse than a port in use: a port held by an n8n
 * that no longer answers. An earlier `bun run dev` that was closed rather than
 * stopped leaves its n8n behind, and that n8n can hang — every route waiting
 * for ever — while still holding the port. Adopting it because "something is
 * on 5678" put every ticket in a queue nothing would ever drain. So a holder
 * that does not answer is identified, and if it is n8n, ended.
 */
async function listeningOn(port: number): Promise<{ pid: number; command: string }[]> {
  const found: { pid: number; command: string }[] = [];
  if (process.platform === 'win32') {
    // No protocol filter: `-p tcp` is IPv4 only, and a server bound to
    // `[::1]` — Vite, for one — appears only under TCPv6.
    const netstat = await sh(['netstat', '-ano'], { quiet: true });
    const pids = new Set<number>();
    for (const line of netstat.out.split('\n')) {
      const columns = line.trim().split(/\s+/);
      if (columns[3] === 'LISTENING' && columns[1]?.endsWith(`:${port}`)) {
        pids.add(Number(columns[4]));
      }
    }
    for (const pid of pids) {
      const who = await sh(
        [
          'powershell',
          '-NoProfile',
          '-Command',
          `(Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}").CommandLine`,
        ],
        { quiet: true },
      );
      found.push({ pid, command: who.out.trim() });
    }
  } else {
    const lsof = await sh(['lsof', '-ti', `tcp:${port}`, '-sTCP:LISTEN'], { quiet: true });
    for (const raw of lsof.out.trim().split('\n').filter(Boolean)) {
      const pid = Number(raw);
      const who = await sh(['ps', '-o', 'command=', '-p', String(pid)], { quiet: true });
      found.push({ pid, command: who.out.trim() });
    }
  }
  return found.filter((entry) => Number.isInteger(entry.pid) && entry.pid > 0);
}

if (await healthy()) {
  // Somebody's n8n already answers on the port — most likely one this script
  // started and Ctrl-C did not reach. Used as it is, rather than fought over.
  warn(`Something already answers on port ${N8N_PORT}; using it rather than starting another.`);
  n8nReady = true;
} else {
  const holders = await listeningOn(N8N_PORT);
  if (holders.length > 0) {
    const ours = holders.filter((holder) => /n8n/i.test(holder.command));
    if (ours.length === holders.length) {
      for (const holder of ours) {
        stopTree({ pid: holder.pid, kill: () => process.kill(holder.pid) });
      }
      await Bun.sleep(2000);
      ok(
        `Ended an n8n that held port ${N8N_PORT} without answering (pid ${ours.map((h) => h.pid).join(', ')})`,
      );
    } else {
      stop(
        `Port ${N8N_PORT} is held by something that does not answer as n8n.`,
        holders.map((holder) => `pid ${holder.pid}: ${holder.command || '(unknown)'}`).join('\n'),
      );
    }
  }

  // Installed once, globally, with npm — it is a Node application and that
  // is how it ships. It is large, so the install is streamed rather than
  // hidden behind a spinner.
  const installed = await sh(viaShell(['n8n', '--version']), { quiet: true });
  if (installed.code !== 0) {
    note(`Installing n8n ${N8N_VERSION} with npm — several hundred MB, once.`);
    const install = await sh(['npm', 'install', '-g', `n8n@${N8N_VERSION}`, '--no-fund'], {
      stream: true,
    });
    if (install.code !== 0) {
      warn('n8n could not be installed, so no run will start until it is:');
      note(`npm install -g n8n@${N8N_VERSION}`);
    }
  } else {
    const version = installed.out.trim().split('\n').pop() ?? '';
    ok(`n8n ${version}`);
    if (!version.startsWith('2.')) {
      warn(
        `This was exercised against n8n ${N8N_VERSION}; ${version} may import the workflow differently.`,
      );
    }
  }
}

const workflowId = await workflowIdFromFile();
if (!workflowId) {
  warn(`orchestration/n8n/${WORKFLOW_NAME}.json has no "id" — it cannot be kept track of.`);
} else if (!n8nReady) {
  /**
   * Imported and published BEFORE the server starts, through n8n's own
   * command line against the same database. Doing it while the server runs
   * needs a restart afterwards — n8n says so itself — and doing it first
   * needs nothing. Each command boots n8n for a few seconds; the very first
   * import on a fresh install also creates the database, which is minutes.
   */
  const active = await n8n('list:workflow', '--active=true');
  if (active.code !== 0) {
    warn('Could not ask n8n for its workflows:');
    for (const line of active.out.trim().split('\n').slice(-4)) note(line);
  } else if (listed(active.out, workflowId)) {
    ensurePublishedVersion(workflowId);
    ok('Workflow imported and published');
  } else {
    note(
      'Importing the workflow — on a fresh install this creates n8n’s database first, which takes minutes.',
    );
    /**
     * `--separate --input=<directory>`, not `--input=<file>`: given a single
     * file the importer expects an array and fails with `workflows.map is
     * not a function`. Keeping the file a single object is what lets it be
     * dragged into the n8n interface by hand, so the directory form is used.
     */
    const imported = await n8n('import:workflow', '--separate', '--input=orchestration/n8n');
    if (imported.code !== 0) {
      warn('Could not import the workflow:');
      for (const line of imported.out.trim().split('\n').slice(-6)) note(line);
      note(
        `Import orchestration/n8n/${WORKFLOW_NAME}.json at http://localhost:${N8N_PORT} by hand.`,
      );
    } else {
      /**
       * An imported workflow arrives inactive, and an inactive workflow's
       * webhook is not registered — so a ticket launched against it comes
       * back 404 from n8n, which reads on screen as the application being
       * broken rather than as a switch nobody flicked. n8n 2 calls the switch
       * publishing; older releases call it activating, so both are tried.
       */
      const published = await n8n('publish:workflow', `--id=${workflowId}`);
      const switchedOn =
        published.code === 0 ||
        (await n8n('update:workflow', `--id=${workflowId}`, '--active=true')).code === 0;
      if (switchedOn) {
        ensurePublishedVersion(workflowId);
        ok('Workflow imported and published');
      } else {
        warn('Imported, but could not be published — its webhook will not answer:');
        for (const line of published.out.trim().split('\n').slice(-4)) note(line);
        note(`Open http://localhost:${N8N_PORT}, open the workflow and publish it.`);
      }
    }
  }
}

/**
 * Handed to the web application, which writes it into Settings at startup.
 * This is the one orchestration field nobody could have typed in advance:
 * the identifier is in the file, and the settings screen was asking for a
 * value whose only source was a list command.
 */
if (workflowId) process.env.ORCHESTRATOR_WORKFLOW_ID = workflowId;

// --- 6. the services that stay in the foreground ------------------------------

step('6/6  n8n, runner and web app');
note('All three run here. Ctrl-C stops them together; Postgres keeps running.');

/**
 * Runs one long-lived process, tagging each line so three streams in one
 * terminal stay readable.
 */
function serve(label: string, colour: string, argv: string[], env?: Record<string, string>) {
  const proc = Bun.spawn(argv, {
    env: { ...process.env, ...env } as Record<string, string>,
    stdout: 'pipe',
    stderr: 'pipe',
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

if (!n8nReady) {
  n8nProc = serve('n8n', MAGENTA, viaShell(['n8n', 'start']), n8nEnv);
  let state: Awaited<ReturnType<typeof webhookState>> = 'not-yet';
  for (let waited = 0; waited < 240 && state !== 'registered'; waited += 2) {
    state = await webhookState();
    if (state !== 'registered') {
      // Said out loud, because n8n prints "ready" well before it is: the
      // database comes up half a minute later, and the published workflows a
      // few seconds after THAT — in between, the route answers "not
      // registered" for a workflow that is about to be. So "unpublished" is
      // provisional until the deadline, and only then a verdict.
      if (waited > 0 && waited % 10 === 0) note(`still waiting for n8n (${waited}s)`);
      await Bun.sleep(2000);
    }
  }
  if (state === 'registered') {
    n8nReady = true;
    ok(`n8n is up at http://localhost:${N8N_PORT}, and the workflow's webhook answers`);
  } else if (state === 'unpublished') {
    n8nReady = true;
    warn('n8n is up, but the workflow is not published — a ticket will come back 404 from n8n.');
    note(`Open http://localhost:${N8N_PORT}, open ${WORKFLOW_NAME} and publish it.`);
  } else {
    warn('n8n did not answer on its port — a run will not start until it does.');
  }
}

const runner = serve('runner', BLUE, ['bun', 'run', 'dev:runner']);
const web = serve('web', GREEN, ['bun', 'run', 'dev:web']);

console.log(`\n${BOLD}Open http://localhost:5173${OFF}`);
console.log(`${DIM}If nobody has an account yet it will ask you to create one, and that${OFF}`);
console.log(`${DIM}first account is the administrator.${OFF}\n`);

let stopping = false;
function stopAll(): void {
  // A second Ctrl-C while the first is still working must not start the walk
  // again half way through it.
  if (stopping) return;
  stopping = true;
  stopTree(runner);
  stopTree(web);
  if (n8nProc) stopTree(n8nProc);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    stopAll();
    process.exit(0);
  });
}

// If one of them dies on its own, take the others down with it rather than
// leaving part of a system up that looks like a whole one.
await Promise.race([runner.exited, web.exited, ...(n8nProc ? [n8nProc.exited] : [])]);
stopAll();
