import { expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
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

/**
 * The source text of a call's first argument, found by matching brackets
 * rather than by regex, so a schema spanning lines and a schema passed by
 * name on one line are read the same way.
 */
function firstArgument(source: string, openParen: number): string {
  let depth = 0;
  for (let i = openParen; i < source.length; i++) {
    const c = source[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') {
      depth--;
      if (depth === 0) return source.slice(openParen + 1, i);
    } else if (c === ',' && depth === 1) return source.slice(openParen + 1, i);
  }
  return source.slice(openParen + 1);
}

/** Every `command`/`form` declaration in a file, with its first argument. */
function declarations(source: string, kinds = ['command', 'form']) {
  const found: { name: string; kind: string; validator: string }[] = [];
  for (const match of source.matchAll(/export const (\w+) = (query|command|form)\(/g)) {
    const [whole, name, kind] = match;
    if (!kinds.includes(kind as string)) continue;
    const open = (match.index ?? 0) + whole.length - 1;
    found.push({
      name: name as string,
      kind: kind as string,
      validator: firstArgument(source, open),
    });
  }
  return found;
}

/** A named schema's own declaration, so a field can be traced to it. */
function schemaBodies(source: string, validator: string): string[] {
  const bodies = [validator];
  for (const match of validator.matchAll(/\b([A-Z]\w*(?:Schema|Args))\b/g)) {
    const index = source.search(new RegExp(`const ${match[1]} = `));
    if (index === -1) continue;
    const open = source.indexOf('(', index);
    if (open !== -1) bodies.push(firstArgument(source, open));
  }
  return bodies;
}

test('every mutation validates its input with a schema, not by hand', () => {
  for (const file of remoteFiles) {
    const source = read(file);
    for (const { name, kind, validator } of declarations(source)) {
      // The first argument must be a validator — a schema expression, a named
      // schema, or the explicit `'unchecked'` opt-out. If it is the handler
      // itself, the input reaches the body unvalidated.
      //
      // A handler taking NO parameter is the exception: it receives no input,
      // so there is nothing for a schema to check.
      const isHandler = /^\s*(async\b|function\b|\()/.test(validator);
      const takesNothing = /^\s*async\s*\(\s*\)|^\s*\(\s*\)\s*=>/.test(validator);
      expect(isHandler && !takesNothing, `${file}: ${kind} ${name} takes no validator`).toBe(false);
    }
  }
});

/**
 * Everything a browser sends in a form is a string, so a `form` schema that
 * declares `v.number()` or `v.boolean()` for a field rejects its own form's
 * input — and a rejected form does not run at all, so the button silently
 * does nothing. `$lib/forms` has coercing schemas for exactly this.
 */
test('a form never validates a field as a raw number or boolean', () => {
  for (const file of remoteFiles) {
    const source = read(file);
    for (const { name, validator } of declarations(source, ['form'])) {
      for (const body of schemaBodies(source, validator)) {
        const raw = [...body.matchAll(/(\w+):\s*(?:v\.optional\(\s*)?v\.(number|boolean)\(/g)].map(
          (m) => m[0],
        );
        expect(
          raw,
          `${file}: form ${name} validates ${raw.join(', ')} as a raw value — ` +
            'a form sends strings, so use the coercing schemas in $lib/forms',
        ).toEqual([]);
      }
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
  expect(existsSync(join(WEB, 'src/routes/api/hooks/orchestrator/+server.ts'))).toBe(true);
  for (const file of remoteFiles) {
    expect(read(file)).not.toContain('EventSource');
    expect(read(file)).not.toContain('ReadableStream');
  }
});

test('the external callback sink is an explicit route with a versioned payload', () => {
  const sink = readFileSync(join(WEB, 'src/routes/api/hooks/orchestrator/+server.ts'), 'utf8');
  expect(sink).toContain('export const POST');
  // It authenticates, and answers identically whatever went wrong.
  expect(sink).toContain('authenticateCallback');
  expect(sink).toContain("{ error: 'unauthorised' }");
  // A duplicate is a successful no-op, so the orchestrator stops retrying.
  expect(sink).toContain('applied');
});

test('no component awaits a remote query — a query is reactive, a promise is not', () => {
  // `{#await query()}` renders the first resolution and then ignores
  // `refresh()`, which silently breaks every live view. `.current` is the
  // reactive read. This assertion exists because that bug shipped once.
  const walk = (dir: string, found: string[] = []): string[] => {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry.startsWith('.')) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full, found);
      else if (entry.endsWith('.svelte')) found.push(full);
    }
    return found;
  };

  const offenders: string[] = [];
  for (const file of walk(join(WEB, 'src'))) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/\{#await\s+([A-Za-z_$][\w$]*)\s*\(/g)) {
      const name = match[1] as string;
      // Awaiting an imported remote function is the mistake; awaiting an
      // ordinary promise is fine.
      if (new RegExp(`import \\{[^}]*\\b${name}\\b[^}]*\\} from '\\$lib/remote/`).test(source)) {
        offenders.push(`${file.replace(`${WEB}/`, '')} awaits ${name}()`);
      }
    }
  }
  expect(offenders).toEqual([]);
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
