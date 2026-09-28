import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

/** Every screen in this group is behind sign-in. */
export const load: LayoutServerLoad = async ({ locals, url }) => {
  if (!locals.user) {
    redirect(303, `/login?next=${encodeURIComponent(url.pathname)}`);
  }
  // The top bar shows the person and nothing about the workspace, as the
  // design's Top Nav does; the sidebar that named the workspace is gone.
  return { user: locals.user };
};
