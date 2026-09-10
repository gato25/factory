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
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
  if (locals.user) redirect(303, '/');
  return {};
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
