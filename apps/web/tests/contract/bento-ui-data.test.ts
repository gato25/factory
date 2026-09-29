import { expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * specs/004-bento-redesign contracts/ui-data.md — where each query the
 * redesigned screens read lives, that it is a `query`, what it takes, and
 * that the ones the dashboard stopped reading are gone. The shape and meaning
 * of each are held against Postgres by the integration tests the contract
 * names (dashboard, first-attempt, board-steps, pipeline-list, repositories).
 */

const REMOTE_DIR = resolve(import.meta.dir, '../../src/lib/remote');
const remoteFiles = readdirSync(REMOTE_DIR).filter((f) => f.endsWith('.remote.ts'));
const read = (file: string) => readFileSync(join(REMOTE_DIR, file), 'utf8');

/** Every `export const name = kind(` in a file, with the text of what follows. */
function exported(source: string) {
  return [...source.matchAll(/export const (\w+) = (query|command|form)\(([^\n]*)/g)].map(
    (match) => ({ name: match[1] as string, kind: match[2] as string, rest: match[3] as string }),
  );
}

function declaration(file: string, name: string) {
  return exported(read(file)).find((entry) => entry.name === name);
}

test('dashboardTickets and dashboardFigures are queries in runs.remote.ts that take no input', () => {
  for (const name of ['dashboardTickets', 'dashboardFigures']) {
    const found = declaration('runs.remote.ts', name);
    expect(found?.kind, `${name} in runs.remote.ts`).toBe('query');
    // A query with no validator is called with its handler first.
    expect(found?.rest.trimStart().startsWith('async ()'), `${name} takes no input`).toBe(true);
  }
});

test('each is defined once, in the file the contract names', () => {
  for (const name of ['dashboardTickets', 'dashboardFigures']) {
    const homes = remoteFiles.filter((file) => declaration(file, name));
    expect(homes).toEqual(['runs.remote.ts']);
  }
});

test('the dashboard parts it superseded are gone: no remote file exports tiles, active or activity', () => {
  // 001 FR-071 and FR-073, superseded by 004 (spec: Divergence; research D6).
  for (const file of remoteFiles) {
    const names = exported(read(file)).map((entry) => entry.name);
    for (const removed of ['tiles', 'active', 'activity']) {
      expect(names, `${file} still exports ${removed}`).not.toContain(removed);
    }
  }
});

test('pipelines is still a query in pipelines.remote.ts, now carrying each step count', () => {
  expect(declaration('pipelines.remote.ts', 'pipelines')?.kind).toBe('query');
});

test('repositories is still a query in repositories.remote.ts, now carrying each latest ticket', () => {
  expect(declaration('repositories.remote.ts', 'repositories')?.kind).toBe('query');
});

test('settings() says whether the runner token is set, reading it only through runnerSummary', () => {
  const source = read('settings.remote.ts');
  expect(declaration('settings.remote.ts', 'settings')?.kind).toBe('query');
  expect(source).toContain('runner: runnerSummary(');
  // The token is never read here directly, so nothing but the boolean can
  // reach the page (research D13, Constitution V).
  expect(source).not.toContain('RUNNER_AUTH_TOKEN');
});

test('ticketFile reads one document, by the ticket and the file, from tickets.remote.ts', () => {
  const found = declaration('tickets.remote.ts', 'ticketFile');
  expect(found?.kind).toBe('query');
  // The ticket is part of the question: a file id from another ticket reads nothing.
  expect(read('tickets.remote.ts')).toMatch(/ticketFile = query\(\s*v\.object\(\{ ticketId:/);
  expect(remoteFiles.filter((file) => declaration(file, 'ticketFile'))).toEqual([
    'tickets.remote.ts',
  ]);
  // The list stays a list: its query never carries a document's text.
  expect(declaration('tickets.remote.ts', 'ticketFiles')?.kind).toBe('query');
});

test('start says why it refused, in the reply, rather than throwing what the browser cannot read', () => {
  const source = read('tickets.remote.ts');
  expect(declaration('tickets.remote.ts', 'start')?.kind).toBe('command');
  const body = source.slice(source.indexOf('export const start = command('));
  expect(body).toContain('ok: true as const');
  expect(body).toContain('ok: false as const');
  expect(body).toContain('error instanceof FactoryError');
});
