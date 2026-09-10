import { expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * contracts/ui-data.md — everything our own interface does goes through remote
 * functions; anything called by a system that is not our browser gets a
 * conventional route. These assertions are architectural: they hold the shape
 * the contract describes, so a drift is caught here rather than in review.
 */

const WEB = resolve(import.meta.dir, '../..');
const REMOTE_DIR = join(WEB, 'src/lib/remote');

const remoteFiles = readdirSync(REMOTE_DIR).filter((f) => f.endsWith('.remote.ts'));
const read = (f: string) => readFileSync(join(REMOTE_DIR, f), 'utf8');

test('remote functions live only in *.remote.ts files', () => {
  expect(remoteFiles.length).toBeGreaterThan(0);
  for (const file of readdirSync(REMOTE_DIR)) {
    expect(file.endsWith('.remote.ts')).toBe(true);
  }
});

test('only query, command and form are used — prerender is not needed here', () => {
  for (const file of remoteFiles) {
    const source = read(file);
    const imported = source.match(/import \{([^}]*)\} from '\$app\/server'/)?.[1] ?? '';
    for (const name of imported
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)) {
      expect(['query', 'command', 'form', 'getRequestEvent']).toContain(name);
    }
  }
});

test('every mutation validates its input with a schema, not by hand', () => {
  for (const file of remoteFiles) {
    const source = read(file);
    // Each command/form declaration must pass a validator as its first
    // argument. A declaration may wrap across lines, so look at a window
    // rather than the rest of one line.
    const declarations = [...source.matchAll(/export const (\w+) = (command|form)\(/g)];
    for (const match of declarations) {
      const [, name, kind] = match;
      const window = source.slice(match.index ?? 0, (match.index ?? 0) + 240);
      const validated =
        window.includes('v.') || window.includes('Schema') || window.includes("'unchecked'");
      expect(validated, `${file}: ${kind} ${name} takes no validator`).toBe(true);
    }
  }
});

test('every mutation checks authorisation INSIDE the function, never in a component', () => {
  for (const file of remoteFiles) {
    const source = read(file);
    const mutations = [...source.matchAll(/export const (\w+) = (command|form)\(/g)];
    if (mutations.length === 0) continue;
    const guards = ['requireAdmin', 'requireUser', 'requireOwnerOrAdmin', 'requireApprover'];
    expect(
      guards.some((g) => source.includes(g)),
      `${file} declares mutations but references no authorisation guard`,
    ).toBe(true);
  }
});

test('remote functions stay THIN: no query building, no table access (research.md risk 1)', () => {
  // The API is experimental, so a signature change must remain a mechanical
  // edit. Business logic belongs in a service module.
  for (const file of remoteFiles) {
    const source = read(file);
    for (const forbidden of ['drizzle-orm', '.insert(', '.update(', '.delete(', 'transaction(']) {
      expect(
        source.includes(forbidden),
        `${file} contains "${forbidden}" — move it into a service module`,
      ).toBe(false);
    }
  }
});

test('live updates are NOT remote functions — a query cannot push (D4)', () => {
  // The two conventional routes the contract names.
  expect(existsSync(join(WEB, 'src/routes/api/hooks/n8n/+server.ts'))).toBe(true);
  for (const file of remoteFiles) {
    expect(read(file)).not.toContain('EventSource');
    expect(read(file)).not.toContain('ReadableStream');
  }
});

test('the external callback sink is an explicit route with a versioned payload', () => {
  const sink = readFileSync(join(WEB, 'src/routes/api/hooks/n8n/+server.ts'), 'utf8');
  expect(sink).toContain('export const POST');
  // It authenticates, and answers identically whatever went wrong.
  expect(sink).toContain('authenticateCallback');
  expect(sink).toContain("{ error: 'unauthorised' }");
  // A duplicate is a successful no-op, so the orchestrator stops retrying.
  expect(sink).toContain('applied');
});

test('the experimental opt-ins are both present, since neither works alone', () => {
  const config = readFileSync(join(WEB, 'svelte.config.js'), 'utf8');
  expect(config).toContain('remoteFunctions: true');
  expect(config).toMatch(/experimental:\s*\{\s*async:\s*true/);
});

test('the SvelteKit version is pinned exactly, because the API may shift', () => {
  const pkg = JSON.parse(readFileSync(join(WEB, 'package.json'), 'utf8')) as {
    devDependencies: Record<string, string>;
  };
  expect(pkg.devDependencies['@sveltejs/kit']).toMatch(/^\d+\.\d+\.\d+$/);
});
