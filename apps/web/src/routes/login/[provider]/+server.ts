import { redirect } from '@sveltejs/kit';
import { loadWebConfig } from '$lib/config';
import { authorizeUrl, providerCredentials, signState } from '$lib/services/oauth';
import type { RequestHandler } from './$types';

/**
 * Where "Continue with GitLab" and "Continue with GitHub" go (FR-001). A
 * redirect rather than a page: there is nothing for a person to read here,
 * and rendering something would only delay them.
 */
export const GET: RequestHandler = async ({ params, url }) => {
  const provider =
    params.provider === 'gitlab' || params.provider === 'github' ? params.provider : null;
  if (!provider) redirect(303, '/login?problem=unknown-provider');

  const credentials = providerCredentials(provider);
  // Not configured is not an error to hide: the login screen only offers a
  // provider it can complete, so reaching this means the address was typed
  // or bookmarked. Say which, so it is fixable.
  if (!credentials) redirect(303, `/login?problem=${provider}-not-configured`);

  const config = loadWebConfig();
  redirect(
    303,
    authorizeUrl(provider, {
      clientId: credentials.clientId,
      redirectUri: `${config.publicBaseUrl.replace(/\/+$/, '')}/login/${provider}/callback`,
      // The address to land on travels signed inside the state; in the query
      // string it would be an open redirect.
      state: signState(url.searchParams.get('next') ?? '/', config.sessionSecret),
    }),
  );
};
