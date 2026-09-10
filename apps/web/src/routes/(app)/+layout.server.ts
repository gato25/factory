import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

/** Every screen in this group is behind sign-in. */
export const load: LayoutServerLoad = ({ locals, url }) => {
  if (!locals.user) {
    redirect(303, `/login?next=${encodeURIComponent(url.pathname)}`);
  }
  return { user: locals.user };
};
