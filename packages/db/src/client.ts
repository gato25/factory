import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index';

export function createClient(url = process.env.DATABASE_URL) {
  if (!url) throw new Error('db: DATABASE_URL is not set');
  const sql = postgres(url, { max: 4, onnotice: () => {} });
  return { db: drizzle(sql, { schema }), sql };
}

export type Database = ReturnType<typeof createClient>['db'];

/** The database the tests are allowed to empty, when nobody has named another. */
const DEFAULT_TEST_DATABASE = 'postgres://postgres:postgres@localhost:5432/factory_test';

/**
 * Refuses any database that is not obviously a test database.
 *
 * The suite's fixtures begin by TRUNCATING every table, and they used to
 * connect to `DATABASE_URL` when it was set. Bun reads `.env` from the working
 * directory by itself, so on a development machine `bun run test` silently
 * pointed that truncate at the development database and emptied it — the
 * account you sign in with included. The failure then arrives much later and
 * wearing a disguise: the sign-in screen says the email address and password
 * do not match, because the account it would have matched is gone.
 *
 * A naming rule is a weak check in general, but it is the right one here:
 * it costs nothing, it cannot be forgotten, and the thing it protects against
 * is not an attacker but a `.env` sitting where a test runner will read it.
 */
export function assertTestDatabase(url: string): void {
  const name = new URL(url).pathname.replace(/^\//, '');
  if (!/(^|[_-])test$/.test(name)) {
    throw new Error(
      `db: refusing to run tests against "${name}" — the fixtures truncate every table, ` +
        'and this is not a test database. Name it with a `_test` suffix, or set ' +
        'TEST_DATABASE_URL. DATABASE_URL is deliberately NOT used here.',
    );
  }
}

/**
 * A client for the tests, which is not the same thing as a client.
 *
 * `TEST_DATABASE_URL`, never `DATABASE_URL` — see `assertTestDatabase` for
 * why reading the latter was the bug rather than the convenience.
 */
export function createTestClient(url = process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_DATABASE) {
  assertTestDatabase(url);
  return createClient(url);
}
