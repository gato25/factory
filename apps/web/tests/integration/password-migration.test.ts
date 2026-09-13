import { beforeEach, expect, test } from 'bun:test';
import { users } from '@factory/db/schema';
import { eq } from 'drizzle-orm';
import { registerFirstUser, signInWithPassword } from '../../src/lib/services/auth';
import { needsRehash } from '../../src/lib/services/password';
import { connect, reset } from '../fixtures';

/**
 * Accounts created before password hashing became portable.
 *
 * Their hashes were written by `Bun.password` and are verifiable only where
 * the `Bun` global exists. This suite runs under Bun, so it can prove the
 * upgrade: such an account signs in once, and afterwards its hash is one any
 * runtime can check. Under Node the same account is refused with a line in
 * the log naming the remedy — that half is asserted in the unit tests, which
 * spawn Node to do it.
 */

const { db } = connect();

const account = { name: 'Bat', email: 'bat@netgroup.mn', password: 'a-perfectly-fine-password' };

beforeEach(async () => {
  await reset(db);
});

test('a Bun-era hash is upgraded to the portable form on the first sign-in', async () => {
  const user = await registerFirstUser(db, account);
  // Put the account back the way it would have been before this change.
  const legacy = await Bun.password.hash(account.password);
  await db.update(users).set({ passwordHash: legacy }).where(eq(users.id, user.id));

  const signedIn = await signInWithPassword(db, account.email, account.password);
  expect(signedIn.id).toBe(user.id);

  const [row] = await db.select().from(users).where(eq(users.id, user.id));
  expect(row?.passwordHash?.startsWith('scrypt$')).toBe(true);
  expect(needsRehash(row?.passwordHash as string)).toBe(false);

  // And it keeps working, now through the portable path.
  const again = await signInWithPassword(db, account.email, account.password);
  expect(again.id).toBe(user.id);
});

test('a wrong password against a Bun-era hash is refused and nothing is rewritten', async () => {
  const user = await registerFirstUser(db, account);
  const legacy = await Bun.password.hash(account.password);
  await db.update(users).set({ passwordHash: legacy }).where(eq(users.id, user.id));

  await expect(signInWithPassword(db, account.email, 'not-it')).rejects.toThrow(/do not match/);

  // The upgrade happens only after a successful check — the plaintext must
  // be the right one before it is hashed and stored.
  const [row] = await db.select().from(users).where(eq(users.id, user.id));
  expect(row?.passwordHash).toBe(legacy);
});

test('a hash at an older scrypt cost is upgraded the same way', async () => {
  const user = await registerFirstUser(db, account);
  const { scryptSync } = await import('node:crypto');
  const salt = Buffer.from('0123456789abcdef');
  const key = scryptSync(account.password, salt, 64, { N: 16384, r: 8, p: 1 });
  const oldCost = `scrypt$16384$8$1$${salt.toString('base64')}$${key.toString('base64')}`;
  await db.update(users).set({ passwordHash: oldCost }).where(eq(users.id, user.id));

  await signInWithPassword(db, account.email, account.password);

  const [row] = await db.select().from(users).where(eq(users.id, user.id));
  expect(row?.passwordHash?.startsWith('scrypt$16384$8$5$')).toBe(true);
});
