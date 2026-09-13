import { describe, expect, test } from 'bun:test';
import { detectStart, explainNoStart, type WorkspaceFiles } from '../../src/launch/detect';

/**
 * Working out how a project starts, from its own files (003 FR-004, FR-016).
 *
 * The property every case here protects is the bind address. A dev server
 * that listens on localhost inside a container is unreachable from outside it
 * however the port is published, and it presents as "started, nothing
 * answers" — so every proposal must carry its framework's flag for every
 * interface, and the generic one must say so in words.
 */

const pkg = (json: object, extra: WorkspaceFiles = {}): WorkspaceFiles => ({
  'package.json': JSON.stringify(json),
  ...extra,
});

describe('frameworks whose server needs telling where to listen', () => {
  test('Vite', () => {
    const p = detectStart(pkg({ scripts: { dev: 'vite' }, devDependencies: { vite: '^6' } }));
    expect(p?.command).toBe('npm run dev -- --host 0.0.0.0 --port $PORT');
    expect(p?.port).toBe(5173);
    expect(p?.from).toContain('Vite');
  });

  test('SvelteKit wins over the vite it depends on', () => {
    const p = detectStart(
      pkg({ scripts: { dev: 'vite dev' }, devDependencies: { '@sveltejs/kit': '^2', vite: '^6' } }),
    );
    expect(p?.from).toContain('SvelteKit');
    expect(p?.command).toContain('--host 0.0.0.0');
  });

  test('Next.js uses its own flags', () => {
    const p = detectStart(pkg({ scripts: { dev: 'next dev' }, dependencies: { next: '15' } }));
    expect(p?.command).toBe('npm run dev -- -H 0.0.0.0 -p $PORT');
    expect(p?.port).toBe(3000);
  });

  test.each([
    ['nuxt', 3000],
    ['astro', 4321],
    ['@angular/cli', 4200],
  ])('%s binds every interface', (dependency, port) => {
    const p = detectStart(pkg({ scripts: { dev: 'x' }, devDependencies: { [dependency]: '1' } }));
    expect(p?.command).toContain('0.0.0.0');
    expect(p?.port).toBe(port);
  });
});

describe('a project with no framework this knows', () => {
  test('runs its dev script and says what the server must do', () => {
    const p = detectStart(pkg({ scripts: { dev: 'node server.js' } }));
    expect(p?.command).toBe('npm run dev');
    // The generic case cannot add a flag, so the note has to carry the fact.
    expect(p?.notes.join(' ')).toContain('0.0.0.0');
    expect(p?.notes.join(' ')).toContain('PORT');
  });

  test('falls back to start when there is no dev', () => {
    const p = detectStart(pkg({ scripts: { start: 'node index.js' } }));
    expect(p?.command).toBe('npm run start');
  });

  test('prefers dev over start', () => {
    const p = detectStart(pkg({ scripts: { start: 'node dist', dev: 'tsx watch src' } }));
    expect(p?.command).toBe('npm run dev');
  });
});

describe('installing', () => {
  test('a package-lock means npm ci', () => {
    const p = detectStart(pkg({ scripts: { dev: 'x' } }, { 'package-lock.json': '{}' }));
    expect(p?.install).toBe('npm ci');
    // Nothing to say about the lockfile; the only note is the generic HOST/PORT one.
    expect(p?.notes.join(' ')).not.toContain('lock');
  });

  test('another lockfile still installs with npm, and says so', () => {
    for (const lock of ['pnpm-lock.yaml', 'yarn.lock', 'bun.lock']) {
      const p = detectStart(pkg({ scripts: { dev: 'x' } }, { [lock]: 'x' }));
      expect(p?.install).toBe('npm install');
      expect(p?.notes.join(' ')).toContain(lock);
    }
  });
});

describe('refusing, in the project’s own terms (FR-016)', () => {
  test('a package.json with neither dev nor start', () => {
    const files = pkg({ scripts: { test: 'vitest' } });
    expect(detectStart(files)).toBeNull();
    expect(explainNoStart(files)).toContain('neither a `dev` nor a `start`');
  });

  test('a Dockerfile project', () => {
    const files: WorkspaceFiles = { Dockerfile: 'FROM node' };
    expect(detectStart(files)).toBeNull();
    expect(explainNoStart(files)).toContain('Dockerfile');
  });

  test.each([
    ['requirements.txt', 'Python'],
    ['pyproject.toml', 'Python'],
    ['go.mod', 'Go'],
    ['Cargo.toml', 'Rust'],
  ])('%s names the language the sandbox lacks', (file, language) => {
    const files: WorkspaceFiles = { [file]: 'x' };
    expect(detectStart(files)).toBeNull();
    expect(explainNoStart(files)).toContain(language);
  });

  test('an empty workspace', () => {
    expect(detectStart({})).toBeNull();
    expect(explainNoStart({})).toContain('Nothing in the workspace');
  });

  test('an unparseable package.json is not a crash', () => {
    expect(detectStart({ 'package.json': '{ not json' })).toBeNull();
  });
});
