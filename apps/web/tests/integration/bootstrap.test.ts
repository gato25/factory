import { beforeEach, expect, test } from 'bun:test';
import { credentials, users, workspaces } from '@factory/db/schema';
import { keyRingFromEnv } from '../../src/lib/secrets/store';
import type { SessionUser } from '../../src/lib/services/auth';
import { readiness } from '../../src/lib/services/connections';
import { bootstrapWorkspace, updateWorkspace } from '../../src/lib/services/workspace';
import { connect, seed } from '../fixtures';

/**
 * A fresh deployment starts with Settings filled in from `.env`.
 *
 * The dashboard used to list the runner address, the orchestration address
 * and a model credential as missing, and send the administrator to Settings
 * to type them — two of which were in `.env` already. These tests hold the
 * seed to its one rule: it fills what nobody has set, and never touches what
 * somebody has.
 */

const { db } = connect();
const ring = keyRingFromEnv({ SECRET_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64') });
const fromEnv = {
  runnerBaseUrl: 'http://localhost:8080',
  orchestratorBaseUrl: 'http://localhost:5678',
  modelKey: 'sk-ant-api03-from-env',
  ring,
};

let admin: SessionUser;

beforeEach(async () => {
  const scenario = await seed(db);
  const [row] = await db.select().from(users);
  admin = { id: scenario.userId, name: row?.name ?? 'Bat', email: row?.email ?? '', role: 'admin' };
});

test('a fresh workspace gets both addresses and the model credential', async () => {
  const { seeded } = await bootstrapWorkspace(db, fromEnv);
  expect(seeded.sort()).toEqual(['model credential', 'orchestration address', 'runner address']);

  const [row] = await db.select().from(workspaces);
  expect(row?.runnerBaseUrl).toBe('http://localhost:8080');
  expect(row?.orchestratorBaseUrl).toBe('http://localhost:5678');
  expect(row?.modelCredentialId).toBeTruthy();

  // The point of it all: the dashboard has nothing left to ask for. The seed
  // fixture connects a repository, so this deployment is ready outright.
  const ready = await readiness(db);
  expect(ready.missing).toEqual([]);
  expect(ready.ready).toBe(true);
});

test('the credential is stored sealed, never as the key itself', async () => {
  await bootstrapWorkspace(db, fromEnv);
  const [stored] = await db.select().from(credentials);
  expect(stored?.kind).toBe('model');
  expect(stored?.ciphertext).not.toContain('sk-ant-api03-from-env');
  expect(JSON.stringify(stored)).not.toContain('from-env');
});

test('a value somebody set by hand is never overwritten', async () => {
  await updateWorkspace(db, { runnerBaseUrl: 'https://runner.internal' }, admin);
  const { seeded } = await bootstrapWorkspace(db, fromEnv);

  const [row] = await db.select().from(workspaces);
  expect(row?.runnerBaseUrl).toBe('https://runner.internal');
  // The other address WAS unset, so it is filled — the rule is per field.
  expect(row?.orchestratorBaseUrl).toBe('http://localhost:5678');
  expect(seeded).not.toContain('runner address');
  expect(seeded).toContain('orchestration address');
});

test('running it again seeds nothing and stores no second credential', async () => {
  await bootstrapWorkspace(db, fromEnv);
  const { seeded } = await bootstrapWorkspace(db, { ...fromEnv, modelKey: 'sk-ant-api03-changed' });
  expect(seeded).toEqual([]);

  // Exactly one credential row: the second start neither replaced the first
  // nor left an orphaned sealed copy behind.
  const stored = await db.select().from(credentials);
  expect(stored.filter((c) => c.kind === 'model')).toHaveLength(1);
});

test('two servers starting together store exactly one credential', async () => {
  // The race the conditional link exists for. Both seal and insert; one
  // links; the other finds it linked nothing and removes its own row.
  const results = await Promise.all([
    bootstrapWorkspace(db, fromEnv),
    bootstrapWorkspace(db, fromEnv),
  ]);
  const wins = results.filter((r) => r.seeded.includes('model credential')).length;
  expect(wins).toBe(1);
  const stored = await db.select().from(credentials);
  expect(stored.filter((c) => c.kind === 'model')).toHaveLength(1);
});

test('without a key ring the credential is not stored, and the addresses still are', async () => {
  const { seeded } = await bootstrapWorkspace(db, { ...fromEnv, ring: undefined });
  expect(seeded.sort()).toEqual(['orchestration address', 'runner address']);
  const [row] = await db.select().from(workspaces);
  expect(row?.modelCredentialId).toBeNull();
});

test('an empty bootstrap changes nothing at all', async () => {
  const [before] = await db.select().from(workspaces);
  const { seeded } = await bootstrapWorkspace(db, {});
  expect(seeded).toEqual([]);
  const [after] = await db.select().from(workspaces);
  expect(after?.updatedAt).toEqual(before?.updatedAt);
});
