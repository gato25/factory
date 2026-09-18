import { createLogger, FactoryError } from '@factory/shared';
import { fail, redirect } from '@sveltejs/kit';
import { loadWebConfig } from '$lib/config';
import { db } from '$lib/db';
import {
  createSessionToken,
  hasAnyUser,
  registerFirstUser,
  SESSION_COOKIE,
  SESSION_COOKIE_OPTIONS,
  signInWithPassword,
} from '$lib/services/auth';
import { configuredProviders } from '$lib/services/oauth';
import type { Actions, PageServerLoad } from './$types';

const log = createLogger('web');

export const load: PageServerLoad = async ({ locals, url }) => {
  if (locals.user) redirect(303, '/');
  return {
    /**
     * On a deployment nobody has an account on, this screen asks for one
     * instead of asking to sign in — because there is nothing to sign in to
     * yet, and the alternative was hand-written SQL against the database.
     * That first account is the administrator (FR-004).
     */
    needsFirstAccount: !(await hasAnyUser(db())),
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
  /**
   * The first account on a fresh deployment, and only the first — after that
   * people arrive by invitation or through a provider. Open registration on a
   * tool holding push credentials and a model key is not a default anyone
   * should get by accident.
   */
  register: async ({ request, cookies, url }) => {
    const form = await request.formData();
    const name = String(form.get('name') ?? '').trim();
    const email = String(form.get('email') ?? '').trim();
    const password = String(form.get('password') ?? '');
    if (!email || !password) {
      return fail(400, { email, message: 'И-мэйл хаяг, нууц үгээ оруулна уу.' });
    }
    try {
      const user = await registerFirstUser(db(), { name, email, password });
      cookies.set(
        SESSION_COOKIE,
        createSessionToken(user.id, loadWebConfig().sessionSecret),
        SESSION_COOKIE_OPTIONS,
      );
    } catch (error) {
      // A FactoryError is a refusal with a reason somebody can act on, and it
      // is shown as written. Anything else is a fault — an unreachable
      // database, a schema that was never migrated — and the screen cannot
      // say which. What it must not do is swallow it: the first version
      // showed "Could not create the account just now." and logged nothing at
      // all, which left the person looking at the screen with no way to find
      // out and nowhere to look.
      if (!(error instanceof FactoryError)) {
        log.error('the first account could not be created', {
          detail: error instanceof Error ? error.message : String(error),
        });
      }
      const message =
        error instanceof FactoryError
          ? error.message
          : 'Бүртгэл үүсгэж чадсангүй. Шалтгаан нь аппликэйшний гаралтад бичигдсэн байгаа.';
      return fail(400, { email, message });
    }
    redirect(303, url.searchParams.get('next') ?? '/');
  },

  password: async ({ request, cookies, url }) => {
    const form = await request.formData();
    const email = String(form.get('email') ?? '').trim();
    const password = String(form.get('password') ?? '');
    if (!email || !password) {
      return fail(400, { email, message: 'И-мэйл хаяг, нууц үгээ оруулна уу.' });
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
        error instanceof FactoryError ? error.message : 'Одоохондоо нэвтрүүлж чадсангүй.';
      return fail(401, { email, message });
    }
    redirect(303, url.searchParams.get('next') ?? '/');
  },
};
