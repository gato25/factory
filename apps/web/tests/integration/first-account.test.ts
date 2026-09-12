import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { users } from '@factory/db/schema';
import { FactoryError } from '@factory/shared';
import {
  hasAnyUser,
  registerFirstUser,
  signInWithPassword,
  signInWithProvider,
} from '../../src/lib/services/auth';
import { requireAdmin } from '../../src/lib/services/authz';
import { connect, reset } from '../fixtures';

/**
 * That a fresh deployment can configure itself.
 *
 * It could not. `role` defaults to `member`, opening Settings and storing a
 * credential both require `admin`, and inviting an admin requires being one —
 * so the only way into a new install was hand-written SQL against the database.
 * There was also no sign-up route at all: the password form verified against a
 * `password_hash` that nothing ever wrote.
 *
 * Two rules resolve it, and the second is what keeps the first safe:
 *
 * 1. The first account, by any route, is the administrator.
 * 2. Only the FIRST may be self-created. After that people arrive by invitation
 *    or through a provider — open registration on a tool holding push
 *    credentials and a model key is not a default anybody should get by
 *    accident.
 */

const { db, sql: raw } = connect();

const account = {
  name: 'Gantogtokh',
  email: 'first@example.com',
  password: 'a-long-enough-password',
};

beforeEach(async () => {
  await reset(db);
});

afterAll(async () => {
  await raw.end();
});

describe('the first account', () => {
  test('can be created with no existing user and no SQL', async () => {
    expect(await hasAnyUser(db)).toBe(false);

    const created = await registerFirstUser(db, account);
    expect(created.email).toBe(account.email);
    expect(await hasAnyUser(db)).toBe(true);
  });

  test('is an administrator, so the deployment can be configured', async () => {
    const created = await registerFirstUser(db, account);
    expect(created.role).toBe('admin');
    // The thing that was actually blocked: every Settings operation runs this.
    expect(() => requireAdmin(created)).not.toThrow();
  });

  test('can then sign in with the password it was given', async () => {
    // The half that was missing before: the login form verified a hash that
    // nothing wrote, so the form could never succeed.
    await registerFirstUser(db, account);
    const signedIn = await signInWithPassword(db, account.email, account.password);
    expect(signedIn.role).toBe('admin');
  });

  test('an address typed with capitals can still sign in afterwards', async () => {
    // The bug this caught. Registration lowercased the address and sign-in did
    // not, so somebody who typed capitals created an account they could never
    // get back into — right password, right account, lookup missed.
    await registerFirstUser(db, { ...account, email: 'First@Example.COM' });
    const [row] = await db.select().from(users);
    expect(row?.email).toBe('first@example.com');

    const signedIn = await signInWithPassword(db, 'First@Example.COM', account.password);
    expect(signedIn.role).toBe('admin');
  });
});

describe('after the first account exists', () => {
  beforeEach(async () => {
    await registerFirstUser(db, account);
  });

  test('self-registration is refused, naming what to do instead', async () => {
    let thrown: unknown;
    try {
      await registerFirstUser(db, { ...account, email: 'second@example.com' });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(FactoryError);
    expect((thrown as FactoryError).message).toContain('invite');
    // And nothing was created.
    expect(await db.select().from(users)).toHaveLength(1);
  });

  test('somebody arriving through a provider is a member, not an admin', async () => {
    const joined = await signInWithProvider(db, 'gitlab', {
      providerUserId: '42',
      email: 'colleague@example.com',
      name: 'A Colleague',
    });
    expect(joined.role).toBe('member');
    expect(() => requireAdmin(joined)).toThrow();
  });
});

describe('the first account by any route', () => {
  test('a provider sign-in on an empty deployment is also the administrator', async () => {
    // Otherwise a deployment whose only sign-in is a provider is still
    // unconfigurable — the same dead end, reached a different way.
    const first = await signInWithProvider(db, 'github', {
      providerUserId: '1',
      email: 'owner@example.com',
      name: 'Owner',
    });
    expect(first.role).toBe('admin');

    const second = await signInWithProvider(db, 'github', {
      providerUserId: '2',
      email: 'later@example.com',
      name: 'Later',
    });
    expect(second.role).toBe('member');
  });
});

describe('the password the first account is given', () => {
  test('a short one is refused, and says why it matters', async () => {
    let thrown: unknown;
    try {
      await registerFirstUser(db, { ...account, password: 'short' });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(FactoryError);
    // The reason, not just the rule: this account can read every credential
    // the workspace stores.
    expect((thrown as FactoryError).message).toContain('credential');
    expect(await hasAnyUser(db)).toBe(false);
  });

  test('is stored hashed, never in the clear', async () => {
    await registerFirstUser(db, account);
    const [row] = await db.select().from(users);
    expect(row?.passwordHash).toBeTruthy();
    expect(row?.passwordHash).not.toBe(account.password);
    expect(JSON.stringify(row)).not.toContain(account.password);
  });
});
