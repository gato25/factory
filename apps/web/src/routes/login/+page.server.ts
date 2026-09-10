import { FactoryError } from '@factory/shared';
import { fail, redirect } from '@sveltejs/kit';
import { loadWebConfig } from '$lib/config';
import { db } from '$lib/db';
import {
  createSessionToken,
  SESSION_COOKIE,
  SESSION_COOKIE_OPTIONS,
  signInWithPassword,
} from '$lib/services/auth';
import { configuredProviders } from '$lib/services/oauth';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, url }) => {
  if (locals.user) redirect(303, '/');
  return {
    // Only providers this deployment can actually complete a sign-in with. A
    // button that leads nowhere is worse than no button.
    providers: configuredProviders(),
    // A round trip that failed comes back here with its reason, rather than
    // an error page: somebody who cannot sign in needs the next thing to
    // try.
    problem: url.searchParams.get('problem'),
  };
};

export const actions: Actions = {
  password: async ({ request, cookies, url }) => {
    const form = await request.formData();
    const email = String(form.get('email') ?? '').trim();
    const password = String(form.get('password') ?? '');
    if (!email || !password) {
      return fail(400, { email, message: 'Enter your email address and password.' });
    }
    try {
      const user = await signInWithPassword(db(), email, password);
      cookies.set(
        SESSION_COOKIE,
        createSessionToken(user.id, loadWebConfig().sessionSecret),
        SESSION_COOKIE_OPTIONS,
      );
    } catch (error) {
      const message =
        error instanceof FactoryError ? error.message : 'Could not sign you in just now.';
      return fail(401, { email, message });
    }
    redirect(303, url.searchParams.get('next') ?? '/');
  },
};
