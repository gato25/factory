import { query } from '$app/server';

/**
 * Smallest possible remote function, kept as a live probe that the
 * experimental API still works after a SvelteKit bump (research.md risk 1).
 * Remote functions stay thin: validate, then call a service module.
 */
export const health = query(async () => {
  return { status: 'ok' as const, at: new Date().toISOString() };
});
