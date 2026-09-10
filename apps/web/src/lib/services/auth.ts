import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Database } from '@factory/db';
import { users } from '@factory/db/schema';
import { FactoryError, type Role } from '@factory/shared';
import { eq } from 'drizzle-orm';

/**
 * Three ways in: a GitLab account, a GitHub account, or an email address and
 * password (FR-001). The first successful sign-in creates the user, and no
 * repository need be connected at that point (FR-002).
 *
 * Sessions are a signed, expiring cookie rather than a table: the data model
 * defines fifteen tables and none of them is a session, so state stays out of
 * the database by design.
 */

export type Provider = 'gitlab' | 'github';

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: Role;
}

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 14;

export async function signInWithPassword(
  database: Database,
  email: string,
  password: string,
): Promise<SessionUser> {
  const [found] = await database.select().from(users).where(eq(users.email, email)).limit(1);
  // Same failure whether the address is unknown or the password is wrong.
  const stored = found?.passwordHash;
  const ok = stored ? await Bun.password.verify(password, stored) : false;
  if (!found || !ok) {
    throw new FactoryError('not_authorised', 'that email address and password do not match');
  }
  return toSessionUser(found);
}

/**
 * T030 — find or create. A person arriving from a provider for the first time
 * becomes a member of the workspace with no further setup.
 */
export async function signInWithProvider(
  database: Database,
  provider: Provider,
  profile: { providerUserId: string; email: string; name: string; avatarUrl?: string },
): Promise<SessionUser> {
  const [existing] = await database
    .select()
    .from(users)
    .where(eq(users.email, profile.email))
    .limit(1);

  if (existing) {
    if (existing.provider !== provider || existing.providerUserId !== profile.providerUserId) {
      await database
        .update(users)
        .set({ provider, providerUserId: profile.providerUserId, updatedAt: new Date() })
        .where(eq(users.id, existing.id));
    }
    return toSessionUser(existing);
  }

  const inserted = await database
    .insert(users)
    .values({
      name: profile.name,
      email: profile.email,
      avatarUrl: profile.avatarUrl,
      provider,
      providerUserId: profile.providerUserId,
      role: 'member',
    })
    .returning();

  const created = inserted[0];
  if (!created) throw new FactoryError('conflict', 'could not create the user');
  return toSessionUser(created);
}

function toSessionUser(row: { id: string; name: string; email: string; role: Role }): SessionUser {
  return { id: row.id, name: row.name, email: row.email, role: row.role };
}

// --- session cookie ---

export function createSessionToken(userId: string, secret: string, now = Date.now()): string {
  const expiresAt = Math.floor(now / 1000) + SESSION_TTL_SECONDS;
  const body = `${userId}.${expiresAt}`;
  return `${body}.${sign(body, secret)}`;
}

export function readSessionToken(
  token: string,
  secret: string,
  now = Date.now(),
): { userId: string } | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [userId, expiresAt, signature] = parts as [string, string, string];
  const body = `${userId}.${expiresAt}`;
  const expected = sign(body, secret);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  if (Number(expiresAt) * 1000 <= now) return null;
  return { userId };
}

function sign(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('base64url');
}

export const SESSION_COOKIE = 'factory_session';
export const SESSION_COOKIE_OPTIONS = {
  path: '/',
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: true,
  maxAge: SESSION_TTL_SECONDS,
};
