import { redirect } from '@sveltejs/kit';
import { db } from '$lib/db';
import { getWorkspace } from '$lib/services/workspace';
import type { LayoutServerLoad } from './$types';

/** Every screen in this group is behind sign-in. */
export const load: LayoutServerLoad = async ({ locals, url }) => {
  if (!locals.user) {
    redirect(303, `/login?next=${encodeURIComponent(url.pathname)}`);
  }
  // The sidebar names the workspace under the signed-in person, as the
  // design does — "Netgroup workspace" rather than a role.
  const workspace = await getWorkspace(db());
  return { user: locals.user, workspace: { name: workspace.name } };
};
