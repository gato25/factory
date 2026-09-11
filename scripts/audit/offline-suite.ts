#!/usr/bin/env bun
/**
 * T058, FR-026 — no test outside `e2e/` reaches a hosted execution host.
 *
 * The property being protected is that `bun run verify` needs no account, no
 * credentials and no network. That is not a convenience. It is what keeps the
 * locally administered path a real rollback rather than a claim: a suite that
 * quietly grew a dependency on a managed service would pass on somebody's
 * machine, fail in a contributor's, and — worse — stop being evidence that the
 * Docker path still works at all.
 *
 * It also protects a second thing, found the hard way. `@cloudflare/sandbox`
 * imports `cloudflare:workers`, which does not exist under Bun, so a single
 * import of the SDK anywhere reachable from a test makes that file unloadable
 * and takes the ENTIRE suite down — not just the test that touched it. The
 * first time this happened it looked like the whole runner was broken.
 *
 * A static audit rather than a runtime one, deliberately. Catching this by
 * observing a test make a network call means catching it only when somebody
 * runs the suite somewhere the call fails. Reading the source catches it in
 * review.
 *
 *   bun scripts/audit/offline-suite.ts
 */

import { type Finding, report } from './report';

/** Files that may import the SDK, and why each one may. */
const SDK_IMPORTERS = [
  // The Worker entry. One file, by design — see the note in
  // `apps/runner/src/container/hosts.ts`.
  'apps/runner/src/worker.ts',
  // The managed host itself, which is what `worker.ts` injects.
  'apps/runner/src/container/hosted.ts',
  // The spike, which exists to measure the provider and is deleted when the
  // decisions it answers are recorded.
  'apps/runner/spikes/worker.ts',
];

/**
 * What "reaching a hosted execution host" looks like in source.
 *
 * Each pattern is something that only appears when a test has stopped being
 * self-contained: the SDK import that breaks the whole suite, a real address
 * that passes locally and fails in review, a wrangler invocation.
 *
 * What is deliberately NOT forbidden is naming the managed host. A test may
 * pass `EXECUTION_HOST: 'hosted'` to a pure configuration loader, or assert
 * that `hostFor('hosted')` refuses without a namespace — both are tests ABOUT
 * the hosted path that reach nothing, and several exist on purpose. The first
 * version of this audit flagged them, which would have meant either deleting
 * good tests or learning to ignore this audit.
 */
const FORBIDDEN: { pattern: RegExp; why: string }[] = [
  {
    pattern: /@cloudflare\/sandbox/g,
    why: 'imports the sandbox SDK, which reaches `cloudflare:workers` and cannot load under Bun — this takes the whole suite down, not just this file',
  },
  {
    pattern: /cloudflare:workers/g,
    why: 'imports a module that exists only in the Workers runtime',
  },
  {
    pattern: /https?:\/\/[a-z0-9.-]+\.workers\.dev/g,
    why: 'names a real deployment, so this test depends on something being deployed',
  },
  {
    // Not every URL — tests construct `Request` objects against invented
    // addresses all the time, which is exactly how the router is driven
    // without a server. What is forbidden is a real one being FETCHED.
    pattern:
      /\bfetch\(\s*['"`]https?:\/\/(?!localhost|127\.0\.0\.1|\[::1\]|[a-z0-9.-]*\.(?:invalid|internal|example|test|localhost)\b)/g,
    why: 'fetches a real address, so this test needs a network',
  },
  {
    pattern: /\bwrangler\s+(?:deploy|dev)\b/g,
    why: 'runs wrangler, which needs credentials and a network',
  },
];

const files = [...new Bun.Glob('apps/runner/tests/**/*.ts').scanSync('.')].filter(
  // `e2e/` is the one place any of this is allowed. It is excluded from the
  // `test` script by T004 precisely so that it can be.
  (path) => !path.includes('/e2e/'),
);

const findings: Finding[] = [];
for (const path of files) {
  const source = await Bun.file(path).text();
  const lines = source.split('\n');
  for (const { pattern, why } of FORBIDDEN) {
    // Every occurrence, not just the first: a reviewer fixing one and
    // re-running to find the next is a worse loop than seeing them together.
    for (const match of source.matchAll(pattern)) {
      const line = source.slice(0, match.index).split('\n').length;
      const text = lines[line - 1] ?? '';
      // A string inside a COMMENT, or inside an assertion ABOUT one of these,
      // is fine — a test may legitimately read `hosted.ts` and assert it does
      // not call some API. What is not fine is the test doing it.
      const inComment = /^\s*(?:\/\/|\*|\/\*)/.test(text);
      const inAssertion = /Bun\.file\(|toContain|not\.toContain/.test(text);
      if (inComment || inAssertion) continue;
      findings.push({ where: `${path}:${line}`, detail: `${why} — \`${text.trim()}\`` });
    }
  }
}

/**
 * The other half: the SDK must be imported in as few places as possible, and
 * every one of them must be a place that has said why.
 */
const sourceFiles = [...new Bun.Glob('apps/runner/{src,spikes}/**/*.ts').scanSync('.')];
const importers: string[] = [];
for (const path of sourceFiles) {
  const source = await Bun.file(path).text();
  if (/from '@cloudflare\/sandbox'|from 'cloudflare:workers'/.test(source)) importers.push(path);
}
for (const path of importers) {
  if (SDK_IMPORTERS.includes(path)) continue;
  findings.push({
    where: path,
    detail:
      'imports the sandbox SDK but is not on the permitted list in this audit. Every importer is ' +
      'a file no test can reach, so logic must not live there — extract it, or add this file to ' +
      'SDK_IMPORTERS with a reason',
  });
}

const code = report({
  criterion: 'FR-026 — the whole suite runs with no account, no credentials and no network',
  examined: `${files.length} test file(s) outside e2e/, ${sourceFiles.length} runner source file(s)`,
  findings,
  notes: [
    `the sandbox SDK is imported in ${importers.length} file(s): ${importers.join(', ') || 'none'}`,
    'apps/runner/tests/e2e is exempt and is excluded from the `test` script by T004',
  ],
});

process.exit(code);
