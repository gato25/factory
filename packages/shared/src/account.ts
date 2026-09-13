/**
 * Rules about an account that both the sign-in screen and the service behind
 * it have to agree on.
 *
 * In `shared` rather than beside the service, for a reason that cost a
 * broken page to learn: `apps/web/src/lib/services/auth.ts` imports
 * `node:crypto` to sign a session cookie, so a Svelte component importing
 * anything from it drags `node:crypto` into the browser bundle. Vite
 * externalises the module rather than failing the build, and the page dies at
 * runtime with "Module node:crypto has been externalized for browser
 * compatibility" — on the one screen a new deployment cannot get past.
 *
 * `shared` has no Node imports at all, which is what makes it the safe place
 * for a value both sides need.
 */

/**
 * The shortest password the first account may have.
 *
 * One constant so the form and the check cannot drift: a form that accepts
 * what the service refuses submits and then fails for no visible reason.
 *
 * Low, and lower than it was, at the request of the person running this. The
 * trade is worth stating rather than burying: the first account is the
 * administrator, and an administrator can read every credential the workspace
 * stores — a git push token and a model key.
 */
export const MIN_PASSWORD_LENGTH = 6;
