import { afterAll, beforeEach, expect, test } from 'bun:test';
import { users } from '@factory/db/schema';
import { eq } from 'drizzle-orm';
import { signInWithProvider } from '../../src/lib/services/auth';
import {
  authorizeUrl,
  configuredProviders,
  exchange,
  providerCredentials,
  readState,
  signState,
} from '../../src/lib/services/oauth';
import { connect, seed } from '../fixtures';

/**
 * FR-001 and FR-002 — signing in with a GitLab or GitHub account, and
 * becoming a member of the workspace on the first successful sign-in.
 *
 * The login screen offered "Continue with GitLab" and "Continue with GitHub"
 * as links to routes that did not exist, and `signInWithProvider` had no
 * caller: two of the three sign-in paths were dead. These are the flow's own
 * decisions, tested without a provider — the round trip itself needs one.
 */

const { db, sql: raw } = connect();
const SECRET = 'a-session-secret-long-enough-to-sign-with';

beforeEach(async () => {
  await seed(db);
});
afterAll(async () => {
  await raw.end();
});

test('the authorize address asks for identity and nothing more', () => {
  const gitlab = new URL(
    authorizeUrl('gitlab', {
      clientId: 'abc',
      redirectUri: 'https://factory.example/login/gitlab/callback',
      state: 'signed-state',
    }),
  );
  expect(gitlab.origin + gitlab.pathname).toBe('https://gitlab.com/oauth/authorize');
  expect(gitlab.searchParams.get('response_type')).toBe('code');
  expect(gitlab.searchParams.get('state')).toBe('signed-state');
  // Reading the account's own identity. Not its repositories: a sign-in that
  // asked for more than it needs would be asking a person to grant it.
  expect(gitlab.searchParams.get('scope')).toBe('read_user');

  const github = new URL(
    authorizeUrl('github', {
      clientId: 'abc',
      redirectUri: 'https://factory.example/login/github/callback',
      state: 's',
    }),
  );
  expect(github.searchParams.get('scope')).toBe('read:user user:email');
});

test('a state survives the round trip and carries where to land', () => {
  const state = signState('/tickets/abc', SECRET);
  expect(readState(state, SECRET)).toEqual({ next: '/tickets/abc' });
});

test('a tampered or foreign state is refused, which is what state is for', () => {
  const state = signState('/', SECRET);
  expect(readState(state, 'a-different-secret-entirely-here-ok')).toBeNull();
  expect(readState(`${state}x`, SECRET)).toBeNull();
  expect(readState('not-a-state', SECRET)).toBeNull();
  expect(readState('', SECRET)).toBeNull();
});

test('two states for the same address differ, so one cannot be replayed', () => {
  expect(signState('/', SECRET)).not.toBe(signState('/', SECRET));
});

test('an absolute address cannot be smuggled through the state', () => {
  // Otherwise anyone who could hand somebody a sign-in link could choose
  // where they landed afterwards.
  for (const hostile of ['https://evil.example/', '//evil.example/', 'javascript:alert(1)']) {
    expect(readState(signState(hostile, SECRET), SECRET)).toEqual({ next: '/' });
  }
});

test('an unconfigured provider is not offered', () => {
  expect(configuredProviders({} as NodeJS.ProcessEnv)).toEqual([]);
  // Half-configured is unconfigured: a client id with no secret cannot
  // complete a sign-in, so offering it would be offering a dead end.
  expect(configuredProviders({ GITLAB_CLIENT_ID: 'a' } as NodeJS.ProcessEnv)).toEqual([]);
  expect(
    configuredProviders({
      GITLAB_CLIENT_ID: 'a',
      GITLAB_CLIENT_SECRET: 'b',
    } as NodeJS.ProcessEnv),
  ).toEqual(['gitlab']);
  expect(
    configuredProviders({
      GITLAB_CLIENT_ID: 'a',
      GITLAB_CLIENT_SECRET: 'b',
      GITHUB_CLIENT_ID: 'c',
      GITHUB_CLIENT_SECRET: 'd',
    } as NodeJS.ProcessEnv),
  ).toEqual(['gitlab', 'github']);
  expect(providerCredentials('github', {} as NodeJS.ProcessEnv)).toBeNull();
});

/** Answers as a provider would, and records what was asked. */
function provider(replies: Record<string, unknown>) {
  const seen: string[] = [];
  return {
    seen,
    fetch: (async (url: string) => {
      seen.push(url);
      // Longest prefix wins: `/user/emails` also starts with `/user`, and
      // matching the shorter one would answer the wrong question.
      const match = Object.keys(replies)
        .filter((key) => url.startsWith(key))
        .sort((a, b) => b.length - a.length)[0];
      if (!match) return new Response('not found', { status: 404 });
      return Response.json(replies[match]);
    }) as unknown as typeof fetch,
  };
}

test('a GitLab sign-in yields a profile the workspace can key on', async () => {
  const p = provider({
    'https://gitlab.com/oauth/token': { access_token: 'tok' },
    'https://gitlab.com/api/v4/user': {
      id: 4242,
      email: 'Sara@Netgroup.MN',
      name: 'Sara',
      avatar_url: 'https://gitlab.com/a.png',
    },
  });
  const profile = await exchange(
    'gitlab',
    {
      code: 'c',
      redirectUri: 'https://factory.example/login/gitlab/callback',
      credentials: { clientId: 'id', clientSecret: 'secret' },
    },
    p.fetch,
  );
  expect(profile).toEqual({
    providerUserId: '4242',
    // Lowercased, so the same person cannot end up with two accounts by
    // typing their address differently on the password path.
    email: 'sara@netgroup.mn',
    name: 'Sara',
    avatarUrl: 'https://gitlab.com/a.png',
  });
});

test('a GitHub account with a private address is found on the addresses route', async () => {
  const p = provider({
    'https://github.com/login/oauth/access_token': { access_token: 'tok' },
    'https://api.github.com/user': { id: 9, login: 'sara', email: null, name: 'Sara' },
    'https://api.github.com/user/emails': [
      { email: 'old@netgroup.mn', primary: false, verified: true },
      { email: 'sara@netgroup.mn', primary: true, verified: true },
    ],
  });
  const profile = await exchange(
    'github',
    {
      code: 'c',
      redirectUri: 'https://factory.example/login/github/callback',
      credentials: { clientId: 'id', clientSecret: 'secret' },
    },
    p.fetch,
  );
  // The primary verified one, not merely the first.
  expect(profile.email).toBe('sara@netgroup.mn');
  expect(p.seen).toContain('https://api.github.com/user/emails');
});

test('an unverified GitHub address is not accepted as an identity', async () => {
  const p = provider({
    'https://github.com/login/oauth/access_token': { access_token: 'tok' },
    'https://api.github.com/user': { id: 9, login: 'sara', email: null },
    'https://api.github.com/user/emails': [
      { email: 'unverified@netgroup.mn', primary: true, verified: false },
    ],
  });
  // Accepting it would let somebody claim an address they do not control,
  // and an invited account is matched by address.
  await expect(
    exchange(
      'github',
      {
        code: 'c',
        redirectUri: 'https://factory.example/login/github/callback',
        credentials: { clientId: 'id', clientSecret: 'secret' },
      },
      p.fetch,
    ),
  ).rejects.toThrow(/no verified email address/);
});

test("the provider's own words are used when it refuses", async () => {
  const p = provider({
    'https://gitlab.com/oauth/token': {
      error_description: 'The provided authorization grant is expired.',
    },
  });
  // It knows whether the code expired, was reused, or the secret is wrong;
  // we do not, and inventing a message would send somebody to fix the wrong
  // thing.
  await expect(
    exchange(
      'gitlab',
      {
        code: 'c',
        redirectUri: 'https://factory.example/login/gitlab/callback',
        credentials: { clientId: 'id', clientSecret: 'secret' },
      },
      p.fetch,
    ),
  ).rejects.toThrow(/authorization grant is expired/);
});

test('arriving for the first time creates a member, with no repository needed', async () => {
  const user = await signInWithProvider(db, 'gitlab', {
    providerUserId: '4242',
    email: 'sara@netgroup.mn',
    name: 'Sara',
  });
  // FR-002: a workspace member, immediately, with no further setup.
  expect(user.role).toBe('member');

  const [row] = await db.select().from(users).where(eq(users.id, user.id));
  expect(row?.provider).toBe('gitlab');
  expect(row?.providerUserId).toBe('4242');
  // No password: signing in through a provider is the path, and an unused
  // account is not a credential anyone could guess.
  expect(row?.passwordHash).toBeNull();
});

test('arriving again is the same person, not a second account', async () => {
  const first = await signInWithProvider(db, 'gitlab', {
    providerUserId: '4242',
    email: 'sara@netgroup.mn',
    name: 'Sara',
  });
  const again = await signInWithProvider(db, 'gitlab', {
    providerUserId: '4242',
    email: 'sara@netgroup.mn',
    name: 'Sara Renamed',
  });
  expect(again.id).toBe(first.id);
  expect(await db.select().from(users).where(eq(users.email, 'sara@netgroup.mn'))).toHaveLength(1);
});

test('somebody invited by email claims their account by signing in', async () => {
  const { invite } = await import('../../src/lib/services/members');
  const [adminRow] = await db
    .insert(users)
    .values({ name: 'Admin', email: 'admin@netgroup.mn', role: 'admin' })
    .returning();
  if (!adminRow) throw new Error('no admin');
  const admin = { id: adminRow.id, name: 'Admin', email: adminRow.email, role: 'admin' as const };
  const { id } = await invite(db, { name: 'Sara', email: 'sara@netgroup.mn' }, admin);

  // The invitation IS the account; a provider sign-in with the same address
  // has to land on it, or an invited person would get a second row and lose
  // whatever role they were given.
  const user = await signInWithProvider(db, 'github', {
    providerUserId: '9',
    email: 'sara@netgroup.mn',
    name: 'Sara from GitHub',
  });
  expect(user.id).toBe(id);
  const [row] = await db.select().from(users).where(eq(users.id, id));
  expect(row?.provider).toBe('github');
  // And their name is not overwritten by the provider's version of it.
  expect(row?.name).toBe('Sara');
});
