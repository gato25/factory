import { users } from '@factory/db/schema';
import type { Handle } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { loadWebConfig } from '$lib/config';
import { db } from '$lib/db';
import { readSessionToken, SESSION_COOKIE } from '$lib/services/auth';

/** Resolves the session cookie into locals.user once per request. */
export const handle: Handle = async ({ event, resolve }) => {
  event.locals.user = null;
  const token = event.cookies.get(SESSION_COOKIE);
  if (token) {
    const session = readSessionToken(token, loadWebConfig().sessionSecret);
    if (session) {
      const [row] = await db().select().from(users).where(eq(users.id, session.userId)).limit(1);
      if (row) {
        event.locals.user = {
          id: row.id,
          name: row.name,
          email: row.email,
          role: row.role,
        };
      }
    }
  }
  return resolve(event);
};
