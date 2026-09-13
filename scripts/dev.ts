#!/usr/bin/env bun
/**
 * Everything a run needs, from one command.
 *
 *   bun run dev
 *
 * Four things have to be up before a ticket can execute — Postgres, n8n, the
 * runner and the web app — plus a schema and a sandbox image. Starting them by
 * hand is six commands across four terminals, and forgetting any one of them
 * produces a different confusing failure much later. That is not a
 * documentation problem; it is a missing command.
 *
 * What this does, in order, stopping at the first thing that genuinely blocks:
 *
 *   1. The environment, read once here and handed to both services
 *   2. Postgres and n8n, via docker compose, waited for until healthy
 *   3. The database schema
 *   4. The sandbox image, built only if it is missing
 *   5. The orchestration workflow, imported only if it is not already there
 *   6. The runner and the web app, together, until you stop them
 *
 * Every step says what it is doing and what it found, because the point is to
 * be able to see WHERE it stopped rather than to hide the steps.
 */

import { stopTree } from './lib/process-tree';

const BOLD = '[1m';
const DIM = '[2m';
const RED = '[31m';
const GREEN = '[32m';
const YELLOW = '[33m';
const BLUE = '[34m';
const OFF = '[0m';

const SANDBOX_IMAGE = 'code-factory/sandbox:latest';
const WORKFLOW_NAME = 'run-ticket-pipeline';

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
  options: { cwd?: string; quiet?: boolean; stream?: boolean } = {},
): Promise<{ code: number; out: string }> {
  if (options.stream) {
    const proc = Bun.spawn(argv, { cwd: options.cwd, stdout: 'inherit', stderr: 'inherit' });
    return { code: await proc.exited, out: '' };
  }
  const proc = Bun.spawn(argv, {
    cwd: options.cwd,
    stdout: options.quiet ? 'pipe' : 'inherit',
    stderr: 'pipe',
  });
  const out = options.quiet ? await new Response(proc.stdout).text() : '';
  const err = await new Response(proc.stderr).text();
  const code = await proc.exited;
  return { code, out: `${out}${err}` };
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

/** What the web application refuses to start without. */
const REQUIRED = [
  'DATABASE_URL',
  'RUNNER_BASE_URL',
  'RUNNER_AUTH_TOKEN',
  'ORCHESTRATOR_BASE_URL',
  'PUBLIC_BASE_URL',
  'SESSION_SECRET',
];

step('1/6  Environment');

const envFile = Bun.file('.env');
if (!(await envFile.exists())) {
  stop('There is no .env.', 'cp .env.example .env — the comments in it say what each value is.');
}

const fileValues = loadEnvFile(await envFile.text());
for (const [key, value] of Object.entries(fileValues)) {
  if (process.env[key] === undefined) process.env[key] = value;
}
ok(`.env read — ${Object.keys(fileValues).length} values, given to both services`);

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

// --- 2. the services ---------------------------------------------------------

step('2/6  Postgres and n8n');

const docker = await sh(['docker', 'version', '--format', '{{.Server.Version}}'], { quiet: true });
if (docker.code !== 0) {
  stop(
    'Docker is not answering.',
    'A run executes inside a container, so Docker has to be running before anything else.',
  );
}
ok(`Docker ${docker.out.trim()}`);

// Streamed, not captured. The first run downloads both images, which takes
// minutes, and a silent minute is indistinguishable from a hung one.
note('The first run downloads Postgres and n8n — a few hundred MB, once.');
const up = await sh(['docker', 'compose', 'up', '-d', 'postgres', 'n8n'], { stream: true });
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

const n8nUp = await waitHealthy('n8n');
if (n8nUp) ok('n8n is up');
else warn('n8n did not report healthy — a run will not start until it does');

// --- 3. the schema -----------------------------------------------------------

step('3/6  Database schema');
const migrated = await sh(['bun', 'run', 'db:migrate'], { quiet: true });
if (migrated.code !== 0) stop('Migrations failed.', migrated.out.trim());
ok('Schema is current');

// --- 4. the sandbox image ----------------------------------------------------

step('4/6  Sandbox image');
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

// --- 5. the workflow ---------------------------------------------------------

step('5/6  Orchestration workflow');
if (!n8nUp) {
  warn('Skipped, because n8n is not up.');
} else {
  const listed = await sh(['docker', 'compose', 'exec', '-T', 'n8n', 'n8n', 'list:workflow'], {
    quiet: true,
  });
  if (listed.out.includes(WORKFLOW_NAME)) {
    ok('Already imported');
  } else {
    const imported = await sh(
      [
        'docker',
        'compose',
        'exec',
        '-T',
        'n8n',
        'n8n',
        'import:workflow',
        `--input=/workflows/${WORKFLOW_NAME}.json`,
      ],
      { quiet: true },
    );
    if (imported.code === 0) {
      ok('Imported');
      note('Open http://localhost:5678 and ACTIVATE it — an inactive workflow never fires.');
    } else {
      // Not fatal: it can be imported by hand, and everything else still runs.
      // But SAY WHY. The first version printed only that it had failed, which
      // left the one person who could diagnose it — whoever is looking at the
      // screen — with nothing to go on.
      warn('Could not import it automatically:');
      for (const line of imported.out.trim().split('\n').slice(-6)) note(line);
      note(`Import orchestration/n8n/${WORKFLOW_NAME}.json at http://localhost:5678 instead:`);
      note('Workflows → ⋯ → Import from File. Then open it and switch it Active.');
    }
  }
}

// --- 6. the two services that stay in the foreground -------------------------

step('6/6  Runner and web app');
note('Both run here. Ctrl-C stops them together; Postgres and n8n keep running.');

/**
 * Runs one long-lived process, tagging each line so two streams in one terminal
 * stay readable.
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
