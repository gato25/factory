import { FactoryError } from '@factory/shared';
import { redirect } from '@sveltejs/kit';
import { loadWebConfig } from '$lib/config';
import { db } from '$lib/db';
import {
  createSessionToken,
  SESSION_COOKIE,
  SESSION_COOKIE_OPTIONS,
  signInWithProvider,
} from '$lib/services/auth';
import { exchange, providerCredentials, readState } from '$lib/services/oauth';
import type { RequestHandler } from './$types';

/**
 * Where the provider sends the person back. Every failure lands on the login
 * screen with a reason rather than an error page: somebody who cannot sign in
 * needs the next thing to try, not a stack trace.
 */
export const GET: RequestHandler = async ({ params, url, cookies }) => {
  const provider =
    params.provider === 'gitlab' || params.provider === 'github' ? params.provider : null;
  if (!provider) redirect(303, '/login?problem=unknown-provider');

  // The person declined, or the provider refused. Their own words if we have
  // them; either way not a fault to report as one.
  const denied = url.searchParams.get('error');
  if (denied) redirect(303, `/login?problem=${encodeURIComponent(denied)}`);

  const code = url.searchParams.get('code') ?? '';
  const state = url.searchParams.get('state') ?? '';
  const config = loadWebConfig();
  const verified = readState(state, config.sessionSecret);
  // A missing or unsigned state is somebody else's authorisation arriving in
  // this browser, which is exactly what state is for.
  if (!code || !verified) redirect(303, '/login?problem=bad-state');

  const credentials = providerCredentials(provider);
  if (!credentials) redirect(303, `/login?problem=${provider}-not-configured`);

  let next = verified.next;
  try {
    const profile = await exchange(provider, {
      code,
      redirectUri: `${config.publicBaseUrl.replace(/\/+$/, '')}/login/${provider}/callback`,
      credentials,
    });
    // Find or create (FR-002): a person arriving for the first time becomes a
    // member of the workspace with no further setup.
    const user = await signInWithProvider(db(), provider, profile);
    cookies.set(
      SESSION_COOKIE,
      createSessionToken(user.id, config.sessionSecret),
      SESSION_COOKIE_OPTIONS,
    );
  } catch (error) {
    const problem =
      error instanceof FactoryError ? error.message : 'Одоохондоо нэвтрүүлж чадсангүй.';
    next = `/login?problem=${encodeURIComponent(problem)}`;
  }
  redirect(303, next);
};
