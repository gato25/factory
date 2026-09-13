#!/usr/bin/env bun
/**
 * No test outside `e2e/` reaches the network.
 *
 * The property being protected is that `bun run verify` needs no account, no
 * credentials and no network. A suite that quietly grew a dependency on
 * something remote would pass on somebody's machine, fail in a contributor's,
 * and — worse — stop being evidence that the Docker path works at all.
 *
 * A static audit rather than a runtime one, deliberately. Catching this by
 * observing a test make a network call means catching it only when somebody
 * runs the suite somewhere the call fails. Reading the source catches it in
 * review.
 *
 *   bun scripts/audit/offline-suite.ts
 */

import { type Finding, report } from './report';

/**
 * What "reaching the network" looks like in source.
 *
 * Not every URL — tests construct `Request` objects against invented addresses
 * all the time, which is exactly how the router is driven without a server.
 * What is forbidden is a REAL address being fetched.
 */
const FORBIDDEN: { pattern: RegExp; why: string }[] = [
  {
    pattern:
      /\bfetch\(\s*['"`]https?:\/\/(?!localhost|127\.0\.0\.1|\[::1\]|[a-z0-9.-]*\.(?:invalid|internal|example|test|localhost)\b)/g,
    why: 'fetches a real address, so this test needs a network',
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
      // is fine. What is not fine is the test doing it.
      const inComment = /^\s*(?:\/\/|\*|\/\*)/.test(text);
      const inAssertion = /Bun\.file\(|toContain|not\.toContain/.test(text);
      if (inComment || inAssertion) continue;
      findings.push({ where: `${path}:${line}`, detail: `${why} — \`${text.trim()}\`` });
    }
  }
}

const code = report({
  criterion: 'the whole suite runs with no account, no credentials and no network',
  examined: `${files.length} test file(s) outside e2e/`,
  findings,
  notes: ['apps/runner/tests/e2e is exempt and is excluded from the `test` script by T004'],
});

process.exit(code);
