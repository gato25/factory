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
  // Normalised the same way registration stores it. Without this, an address
  // typed with capitals registers as lowercase and can then never sign in —
  // the account exists, the password is right, and the lookup misses.
  const [found] = await database
    .select()
    .from(users)
    .where(eq(users.email, normaliseEmail(email)))
    .limit(1);
  // Same failure whether the address is unknown or the password is wrong.
  const stored = found?.passwordHash;
  const ok = stored ? await Bun.password.verify(password, stored) : false;
  if (!found || !ok) {
    throw new FactoryError('not_authorised', 'that email address and password do not match');
  }
  return toSessionUser(found);
}

/**
 * One spelling of an address, so the same person is the same account.
 *
 * Registration stores this form and sign-in looks it up, and they have to
 * agree: an address typed with capitals once registered as lowercase and then
 * matched nothing on the way back in.
 */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * What role a new account gets: `admin` if it is the first, `member` after.
 *
 * Without this a fresh install cannot configure itself. `role` defaults to
 * `member`, storing a credential and opening Settings both require `admin`,
 * and inviting an admin requires being one — so the only way in was hand-written
 * SQL against the database. That is not an installation, it is a puzzle.
 *
 * **The residual race, stated rather than hidden.** Two people registering in
 * the same instant can both see an empty table and both become admin. It is not
 * worth a lock: this runs once in a deployment's life, at a moment when the only
 * person present is the operator setting it up, and the failure is "two admins
 * on a fresh install" — which is what an operator would have made anyway.
 */
async function roleForNewUser(database: Database): Promise<Role> {
  const [anyone] = await database.select({ id: users.id }).from(users).limit(1);
  return anyone ? 'member' : 'admin';
}

/** Whether anybody has an account yet — what the sign-in screen branches on. */
export async function hasAnyUser(database: Database): Promise<boolean> {
  const [anyone] = await database.select({ id: users.id }).from(users).limit(1);
  return Boolean(anyone);
}

/**
 * The shortest password the first account may have.
 *
 * Exported so the form and the check cannot drift: a form that accepts what
 * the service refuses produces a submission that fails for no visible reason.
 *
 * Deliberately low, and lower than it was. This account can read every
 * credential the workspace stores — a git push token and a model key — so the
 * figure is a real trade rather than a formality, and it is set here, in one
 * place, so that raising it is one edit.
 */
export const MIN_PASSWORD_LENGTH = 6;

/**
 * Creates the first account on a fresh deployment.
 *
 * Deliberately refuses once anybody exists. Open registration on a tool that
 * holds push credentials and a model key is not a default anyone should get by
 * accident — after the first account, people arrive by invitation (FR-004) or
 * through a provider.
 */
export async function registerFirstUser(
  database: Database,
  input: { name: string; email: string; password: string },
): Promise<SessionUser> {
  const email = normaliseEmail(input.email);
  if (input.password.length < MIN_PASSWORD_LENGTH) {
    throw new FactoryError(
      'invalid_input',
      `Use at least ${MIN_PASSWORD_LENGTH} characters. This account can read every credential the workspace stores.`,
    );
  }
  if (await hasAnyUser(database)) {
    throw new FactoryError(
      'not_authorised',
      'This workspace already has an account. Ask an administrator to invite you.',
    );
  }

  const inserted = await database
    .insert(users)
    .values({
      name: input.name.trim() || email,
      email,
      role: await roleForNewUser(database),
      passwordHash: await Bun.password.hash(input.password),
    })
    .returning();

  const created = inserted[0];
  if (!created) throw new FactoryError('conflict', 'could not create the account');
  return toSessionUser(created);
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
      // The first person through ANY door is the administrator, not just the
      // first to use a password — otherwise a deployment whose only sign-in is
      // a provider is still unconfigurable.
      role: await roleForNewUser(database),
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
