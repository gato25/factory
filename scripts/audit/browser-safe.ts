#!/usr/bin/env bun
/**
 * No screen imports a module that cannot exist in a browser.
 *
 * This exists because of a defect that passed every check and still broke the
 * one screen a new deployment cannot get past. A Svelte component imported a
 * constant from `$lib/services/auth`; that module imports `node:crypto` to
 * sign a session cookie; Vite does not fail a build for this — it externalises
 * the module and substitutes a stub — so lint passed, `svelte-check` passed,
 * the server rendered the page correctly, and the browser died on hydration
 * with "Module node:crypto has been externalized for browser compatibility".
 *
 * The trap is that the import looks harmless at both ends. The component
 * imports a number. The service needs `node:crypto` for something the
 * component never touches. Nothing in between says the two cannot meet, and a
 * tree-shaker does not help because the module's imports are evaluated.
 *
 * So: follow what every `.svelte` file imports, through the project's own
 * modules, and fail if the walk reaches a Node built-in. A static audit rather
 * than a runtime one, for the usual reason — catching this by loading every
 * page in a browser means catching it only when somebody does.
 *
 *   bun scripts/audit/browser-safe.ts
 */

import { type Finding, report } from './report';

const WEB = 'apps/web/src';

/** What cannot exist in a browser, however it is spelled. */
const NODE_BUILTIN = /from\s+'(node:[a-z_/]+)'/g;

/** `$lib/x` and `$components/x` are the project's own aliases. */
function resolveImport(specifier: string, fromFile: string): string | null {
  if (specifier.startsWith('$lib/')) return `${WEB}/lib/${specifier.slice(5)}`;
  if (specifier.startsWith('$components/')) return `${WEB}/components/${specifier.slice(12)}`;
  if (specifier.startsWith('.')) {
    const parts = fromFile.split('/').slice(0, -1);
    for (const piece of specifier.split('/')) {
      if (piece === '.') continue;
      if (piece === '..') parts.pop();
      else parts.push(piece);
    }
    return parts.join('/');
  }
  // A package. `@factory/shared` and `@factory/db` are ours and are checked
  // separately, below; everything else is somebody else's problem.
  return null;
}

/** The file on disk for a resolved path, whatever extension it wears. */
async function fileFor(path: string): Promise<string | null> {
  for (const candidate of [path, `${path}.ts`, `${path}.svelte`, `${path}/index.ts`]) {
    if (await Bun.file(candidate).exists()) return candidate;
  }
  return null;
}

/**
 * Value imports only.
 *
 * `import type { SessionUser } from './auth'` is erased entirely, so it cannot
 * pull anything into a bundle — and every service in this project imports
 * `auth` exactly that way. The first version of this audit did not make the
 * distinction and flagged ten screens that work, which is worse than no audit:
 * a check that cries wolf gets switched off.
 *
 * Note that `import { type X } from 'y'` is NOT the same thing. Under
 * `verbatimModuleSyntax` the statement survives, so the module is still
 * evaluated. Treating it as a value import is the conservative reading and
 * the correct one.
 */
const IMPORTS = /(?:^|\n)\s*import\s+(?!type\s)(?:[^'"]*?from\s+)?'([^']+)'/g;

/**
 * A remote function file is a boundary, not a module a browser loads.
 *
 * SvelteKit replaces the body of a `.remote.ts` with a fetch stub on the
 * client — that is the whole point of remote functions — so what it imports
 * server-side never reaches a browser. Following it would flag every screen
 * that calls one, which is nearly all of them.
 */
const isServerBoundary = (path: string) => path.endsWith('.remote.ts');

const cache = new Map<string, string>();
async function read(path: string): Promise<string> {
  const cached = cache.get(path);
  if (cached !== undefined) return cached;
  const text = await Bun.file(path).text();
  cache.set(path, text);
  return text;
}

/**
 * Walks what this file imports, depth first, and reports the first Node
 * built-in it reaches with the chain that got there.
 *
 * The CHAIN is the point. "auth.ts imports node:crypto" is not actionable from
 * a component that imports a number; "LoginPage → services/auth → node:crypto"
 * says exactly which import to move.
 */
async function reachesNode(
  path: string,
  seen = new Set<string>(),
  chain: string[] = [],
): Promise<{ builtin: string; chain: string[] } | null> {
  if (seen.has(path)) return null;
  seen.add(path);

  const source = await read(path);
  const here = [...chain, path];

  const builtin = NODE_BUILTIN.exec(source)?.[1];
  NODE_BUILTIN.lastIndex = 0;
  if (builtin) return { builtin, chain: here };

  for (const match of source.matchAll(IMPORTS)) {
    const specifier = match[1] as string;
    const resolved = resolveImport(specifier, path);
    if (!resolved) continue;
    const next = await fileFor(resolved);
    if (!next || isServerBoundary(next)) continue;
    const found = await reachesNode(next, seen, here);
    if (found) return found;
  }
  return null;
}

const screens = [
  ...new Bun.Glob(`${WEB}/**/*.svelte`).scanSync('.'),
  // `.svelte.ts` modules are client code too, and are imported the same way.
  ...new Bun.Glob(`${WEB}/**/*.svelte.ts`).scanSync('.'),
];

const findings: Finding[] = [];
for (const screen of screens) {
  const found = await reachesNode(screen);
  if (!found) continue;
  findings.push({
    where: screen,
    detail:
      `reaches \`${found.builtin}\`, which a browser has no such thing as. ` +
      `Vite externalises it silently, so this fails at runtime rather than at build. ` +
      `Chain: ${found.chain.join(' → ')} → ${found.builtin}. ` +
      `Move the value the screen actually needs into \`packages/shared\`, which has no Node imports.`,
  });
}

/**
 * The second half: `shared` is the safe place only for as long as it stays
 * safe. A Node import added there would make every screen importing it fail,
 * and the message would name the screen rather than the cause.
 */
const sharedFiles = [...new Bun.Glob('packages/shared/src/**/*.ts').scanSync('.')];
for (const path of sharedFiles) {
  const source = await read(path);
  const builtin = NODE_BUILTIN.exec(source)?.[1];
  NODE_BUILTIN.lastIndex = 0;
  if (!builtin) continue;
  findings.push({
    where: path,
    detail:
      `imports \`${builtin}\`. \`packages/shared\` is imported by screens, so it has to stay ` +
      'free of Node built-ins — putting one here breaks every screen that imports anything ' +
      'from it, and the failure names the screen rather than this file',
  });
}

const code = report({
  criterion: 'no screen reaches a Node built-in, and `shared` stays importable by a browser',
  examined: `${screens.length} screen(s), ${sharedFiles.length} shared module(s)`,
  findings,
  notes: [
    'Vite externalises a Node built-in instead of failing, so this cannot be caught by a build',
    'the chain in each finding names the import to move, not just the module at the end of it',
  ],
});

process.exit(code);
