import { afterAll, beforeEach, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { credentials, repositories, workspaces } from '@factory/db/schema';
import { eq } from 'drizzle-orm';
import { keyRingFromEnv, mask, revealForRun, seal } from '../../src/lib/secrets/store';
import { getWorkspace } from '../../src/lib/services/workspace';
import { connect, type Scenario, seed } from '../fixtures';

/**
 * FR-011 — no stored credential is readable back in full through any
 * interface. The only path out is `revealForRun`, which exists so a sandbox
 * can be given an environment variable, and nothing that answers a browser
 * calls it.
 *
 * This is asserted structurally as well as behaviourally: a future read path
 * would be a new caller of `revealForRun`, and the count of those is what
 * this holds down.
 */

const { db, sql: raw } = connect();
let scenario: Scenario;
const ring = keyRingFromEnv({
  SECRET_ENCRYPTION_KEY: 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=',
});
const TOKEN = 'glpat-supersecretvalue1234567890';

const WEB = resolve(import.meta.dir, '../..');

beforeEach(async () => {
  scenario = await seed(db);
});
afterAll(async () => {
  await raw.end();
});

// --- what is stored is not the credential ---

test('what is stored is ciphertext, and the plaintext is nowhere in the row', async () => {
  const sealed = seal(TOKEN, ring);
  const [row] = await db
    .insert(credentials)
    .values({
      kind: 'model',
      ciphertext: sealed.ciphertext,
      keyVersion: sealed.keyVersion,
      status: 'unverified',
    })
    .returning();
  if (!row) throw new Error('no credential');

  expect(row.ciphertext).not.toContain(TOKEN);
  expect(JSON.stringify(row)).not.toContain(TOKEN);
  // And no column holds it in any encoding a reader could undo by eye.
  expect(row.ciphertext).not.toContain(Buffer.from(TOKEN).toString('base64'));
});

test('sealing the same value twice gives different ciphertext', () => {
  // A deterministic sealing would let anyone confirm a guess by comparing.
  expect(seal(TOKEN, ring).ciphertext).not.toBe(seal(TOKEN, ring).ciphertext);
});

test('the sealed value round-trips only through revealForRun', () => {
  const sealed = seal(TOKEN, ring);
  expect(revealForRun(sealed, ring)).toBe(TOKEN);
});

test('a tampered ciphertext does not decrypt to something usable', () => {
  const sealed = seal(TOKEN, ring);
  const flipped = {
    ...sealed,
    ciphertext: `${sealed.ciphertext.slice(0, -4)}${sealed.ciphertext.slice(-4) === 'AAAA' ? 'BBBB' : 'AAAA'}`,
  };
  expect(() => revealForRun(flipped, ring)).toThrow();
});

// --- what any interface can see ---

test('the workspace view says whether a credential exists, never what it is', async () => {
  const sealed = seal(TOKEN, ring);
  const [row] = await db
    .insert(credentials)
    .values({
      kind: 'model',
      ciphertext: sealed.ciphertext,
      keyVersion: sealed.keyVersion,
      status: 'valid',
    })
    .returning();
  await db.update(workspaces).set({ modelCredentialId: row?.id });

  const view = await getWorkspace(db);
  expect(view.hasModelCredential).toBe(true);
  // The whole view, serialised, holds nothing of the credential.
  expect(JSON.stringify(view)).not.toContain(TOKEN);
  expect(JSON.stringify(view)).not.toContain('ciphertext');
  expect(Object.keys(view)).not.toContain('modelCredentialId');
});

test("a repository's view does not carry its token either", async () => {
  const [repo] = await db
    .select()
    .from(repositories)
    .where(eq(repositories.id, scenario.repositoryId))
    .limit(1);
  const { listRepositories } = await import('../../src/lib/services/repository');
  const listed = await listRepositories(db);

  expect(repo?.credentialId).toBeTruthy();
  // The id of a credential is not the credential; the value never appears.
  expect(JSON.stringify(listed)).not.toContain(TOKEN);
  expect(JSON.stringify(listed)).not.toContain('ciphertext');
});

test('a mask shows only enough to recognise which credential it is', () => {
  const masked = mask(TOKEN);
  expect(masked).not.toBe(TOKEN);
  expect(masked).not.toContain('supersecret');
  // Enough to tell two apart, not enough to use.
  expect(masked.length).toBeLessThan(TOKEN.length);
});

// --- structurally: nothing that answers a browser can reveal ---

function filesUnder(directory: string, extension: string): string[] {
  const out: string[] = [];
  const walk = (path: string) => {
    for (const entry of readdirSync(path)) {
      const full = join(path, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (full.endsWith(extension)) out.push(full);
    }
  };
  walk(directory);
  return out;
}

test('no remote function and no route reveals a credential', () => {
  const surfaces = [
    ...filesUnder(join(WEB, 'src/lib/remote'), '.ts'),
    ...filesUnder(join(WEB, 'src/routes'), '.ts'),
  ];
  expect(surfaces.length).toBeGreaterThan(0);

  for (const file of surfaces) {
    const source = readFileSync(file, 'utf8');
    // Nothing that answers a browser turns a stored credential back into a
    // value. Writing one is fine — that is how it gets stored.
    expect(source.includes('revealForRun'), `${file} reveals a credential`).toBe(false);
    expect(source.includes('credentials.ciphertext'), `${file} reads a stored ciphertext`).toBe(
      false,
    );
  }
});

test('revealForRun is called only where a run needs an environment', () => {
  // Paths as forward-slash names whatever the platform, so the exclusion and
  // the list below are one list; the suffix match used to miss on Windows and
  // count the definer itself as a caller.
  const names = filesUnder(join(WEB, 'src'), '.ts')
    .map((file) => file.slice(WEB.length + 1).replaceAll('\\', '/'))
    .filter(
      (name) =>
        name !== 'src/lib/secrets/store.ts' &&
        readFileSync(join(WEB, name), 'utf8').includes('revealForRun('),
    )
    .sort();
  // Exactly one place: where a run is handed to the Runner, which needs
  // environment variables for the sandbox. A new caller here is a new way
  // out, and should be a deliberate change rather than a surprise.
  expect(names).toEqual(['src/lib/services/run-credentials.ts']);
});

test('the design credential is not even read for a run that does not need it', async () => {
  const { resolveRunCredentials } = await import('../../src/lib/services/run-credentials');
  const { startRun } = await import('../../src/lib/services/run');

  // A model credential, but no design one.
  const sealed = seal(TOKEN, ring);
  const [model] = await db
    .insert(credentials)
    .values({
      kind: 'model',
      ciphertext: sealed.ciphertext,
      keyVersion: sealed.keyVersion,
      status: 'valid',
    })
    .returning();
  await db.update(workspaces).set({ modelCredentialId: model?.id, designCredentialId: null });
  // The repository's own credential has to be readable with this ring too.
  const repoSealed = seal('glpat-repo-token', ring);
  await db
    .update(credentials)
    .set({ ciphertext: repoSealed.ciphertext, keyVersion: repoSealed.keyVersion })
    .where(eq(credentials.kind, 'git'));

  const started = await startRun(db, {
    ticketId: scenario.ticketId,
    callbackBaseUrl: 'https://factory.example',
  });
  // The fixture's pipeline has no design step, so this succeeds despite
  // there being no design credential at all (FR-083a).
  const resolved = await resolveRunCredentials(db, started.snapshot, ring);
  expect(resolved.gitToken).toBe('glpat-repo-token');
  expect(resolved.modelKey).toBe(TOKEN);
  expect(resolved.designKey).toBeUndefined();
});

test('a credential never reaches the snapshot in plaintext', async () => {
  const { startRun } = await import('../../src/lib/services/run');
  const started = await startRun(db, {
    ticketId: scenario.ticketId,
    callbackBaseUrl: 'https://factory.example',
  });

  // The snapshot carries a REFERENCE, so the Runner asks for the value and
  // the orchestrator never holds one (FR-083).
  expect(started.snapshot.repo.credential_ref).toBeTruthy();
  const serialised = JSON.stringify(started.snapshot);
  expect(serialised).not.toContain('sealed');
  expect(serialised).not.toContain('ciphertext');
});
