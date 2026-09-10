import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { FactoryError } from '@factory/shared';
import type { Provider } from './auth';

/**
 * FR-001 — signing in with a GitLab or GitHub account. Only these two
 * providers exist (FR-014a), and the same two the product can host a
 * repository on, which is why one authorisation serves both purposes for a
 * person who has only one account.
 *
 * The two flows differ in three places and nowhere else: the addresses, the
 * scope names, and the shape of the profile that comes back. That is what
 * this table is; everything around it is shared, so there is one flow to
 * reason about rather than two.
 */

export interface OAuthProvider {
  authorizeUrl: string;
  tokenUrl: string;
  /** What the flow asks for: reading the account's own identity, no more. */
  scope: string;
  profile(accessToken: string, doFetch: typeof fetch): Promise<OAuthProfile>;
}

export interface OAuthProfile {
  providerUserId: string;
  email: string;
  name: string;
  avatarUrl?: string;
}

async function json(
  doFetch: typeof fetch,
  url: string,
  accessToken: string,
): Promise<Record<string, unknown>> {
  const response = await doFetch(url, {
    headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
  });
  if (!response.ok) {
    throw new FactoryError(
      'not_authorised',
      `${new URL(url).host} answered ${response.status} when asked who you are`,
    );
  }
  return (await response.json()) as Record<string, unknown>;
}

export const PROVIDERS: Record<Provider, OAuthProvider> = {
  gitlab: {
    authorizeUrl: 'https://gitlab.com/oauth/authorize',
    tokenUrl: 'https://gitlab.com/oauth/token',
    scope: 'read_user',
    async profile(accessToken, doFetch) {
      const me = await json(doFetch, 'https://gitlab.com/api/v4/user', accessToken);
      const email = typeof me.email === 'string' ? me.email : '';
      if (!email) {
        // Without an address there is nothing to match an invited account
        // against, and a user record keyed on nothing would be unreachable.
        throw new FactoryError(
          'invalid_input',
          'Your GitLab account has no visible email address, so there is nothing to sign you ' +
            'in as. Make one public, or sign in with an email address and password.',
        );
      }
      return {
        providerUserId: String(me.id),
        email: email.toLowerCase(),
        name: typeof me.name === 'string' && me.name ? me.name : email,
        avatarUrl: typeof me.avatar_url === 'string' ? me.avatar_url : undefined,
      };
    },
  },
  github: {
    authorizeUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    scope: 'read:user user:email',
    async profile(accessToken, doFetch) {
      const me = await json(doFetch, 'https://api.github.com/user', accessToken);
      let email = typeof me.email === 'string' ? me.email : '';
      if (!email) {
        // GitHub omits a private address from /user; it is on /user/emails,
        // which `user:email` is asked for precisely so this case works.
        const addresses = (await doFetch('https://api.github.com/user/emails', {
          headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
        }).then((r) => (r.ok ? r.json() : []))) as {
          email?: string;
          primary?: boolean;
          verified?: boolean;
        }[];
        email =
          addresses.find((a) => a.primary && a.verified)?.email ??
          addresses.find((a) => a.verified)?.email ??
          '';
      }
      if (!email) {
        throw new FactoryError(
          'invalid_input',
          'Your GitHub account has no verified email address, so there is nothing to sign you ' +
            'in as. Verify one, or sign in with an email address and password.',
        );
      }
      const login = typeof me.login === 'string' ? me.login : email;
      return {
        providerUserId: String(me.id),
        email: email.toLowerCase(),
        name: typeof me.name === 'string' && me.name ? me.name : login,
        avatarUrl: typeof me.avatar_url === 'string' ? me.avatar_url : undefined,
      };
    },
  },
};

export interface ProviderCredentials {
  clientId: string;
  clientSecret: string;
}

/**
 * Whether a provider is set up. A button that leads nowhere is worse than no
 * button, so the login screen asks this and offers only what will work.
 */
export function providerCredentials(
  provider: Provider,
  env: NodeJS.ProcessEnv = process.env,
): ProviderCredentials | null {
  const prefix = provider === 'gitlab' ? 'GITLAB' : 'GITHUB';
  const clientId = env[`${prefix}_CLIENT_ID`] ?? '';
  const clientSecret = env[`${prefix}_CLIENT_SECRET`] ?? '';
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export function configuredProviders(env: NodeJS.ProcessEnv = process.env): Provider[] {
  return (['gitlab', 'github'] as Provider[]).filter((p) => providerCredentials(p, env) !== null);
}

/**
 * The `state` parameter, which is what stops somebody else's authorisation
 * being replayed into this browser. Signed rather than stored: it has to
 * survive a round trip through the provider, and a signature does that
 * without a table whose rows nobody would ever clean up.
 *
 * The `next` address travels inside it for the same reason — carried in the
 * query string it would be an open redirect.
 */
export function signState(next: string, secret: string): string {
  const nonce = randomBytes(16).toString('base64url');
  // Only a path, never an absolute address: an attacker who could choose
  // where sign-in lands could send somebody to their own site.
  const safe = next.startsWith('/') && !next.startsWith('//') ? next : '/';
  const body = `${nonce}.${Buffer.from(safe).toString('base64url')}`;
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
}

export function readState(state: string, secret: string): { next: string } | null {
  const parts = state.split('.');
  if (parts.length !== 3) return null;
  const [nonce, encoded, signature] = parts as [string, string, string];
  const expected = createHmac('sha256', secret).update(`${nonce}.${encoded}`).digest('base64url');
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const next = Buffer.from(encoded, 'base64url').toString('utf8');
  return { next: next.startsWith('/') && !next.startsWith('//') ? next : '/' };
}

export function authorizeUrl(
  provider: Provider,
  input: { clientId: string; redirectUri: string; state: string },
): string {
  const spec = PROVIDERS[provider];
  const query = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    response_type: 'code',
    scope: spec.scope,
    state: input.state,
  });
  return `${spec.authorizeUrl}?${query}`;
}

/** Exchanges the code for a token, then the token for a profile. */
export async function exchange(
  provider: Provider,
  input: {
    code: string;
    redirectUri: string;
    credentials: ProviderCredentials;
  },
  doFetch: typeof fetch = fetch,
): Promise<OAuthProfile> {
  const spec = PROVIDERS[provider];
  const response = await doFetch(spec.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({
      client_id: input.credentials.clientId,
      client_secret: input.credentials.clientSecret,
      code: input.code,
      grant_type: 'authorization_code',
      redirect_uri: input.redirectUri,
    }),
  });
  if (!response.ok) {
    throw new FactoryError(
      'not_authorised',
      `${provider} refused the sign-in (${response.status}). Try again.`,
    );
  }
  const body = (await response.json()) as { access_token?: string; error_description?: string };
  if (!body.access_token) {
    // The provider's own words are more use than ours: it knows whether the
    // code expired, was reused, or the client secret is wrong.
    throw new FactoryError(
      'not_authorised',
      body.error_description ?? `${provider} did not return an access token.`,
    );
  }
  return spec.profile(body.access_token, doFetch);
}
