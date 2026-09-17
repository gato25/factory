import { users } from '@factory/db/schema';
import { createLogger } from '@factory/shared';
import type { Handle, ServerInit } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { bootstrapFromEnv, loadWebConfig } from '$lib/config';
import { db } from '$lib/db';
import { keyRingFromEnv } from '$lib/secrets/store';
import { readSessionToken, SESSION_COOKIE } from '$lib/services/auth';
import { bootstrapWorkspace } from '$lib/services/workspace';

const log = createLogger('web');

/** Resolves the session cookie into locals.user once per request. */
export const handle: Handle = async ({ event, resolve }) => {
  event.locals.user = null;
  const token = event.cookies.get(SESSION_COOKIE);
  if (token) {
    const session = readSessionToken(token, loadWebConfig().sessionSecret);
    if (session) {
      const [row] = await db().select().from(users).where(eq(users.id, session.userId)).limit(1);
      if (row) {
        event.locals.user = {
          id: row.id,
          name: row.name,
          email: row.email,
          role: row.role,
        };
      }
    }
  }
  return resolve(event);
};

/**
 * Once, when the server starts: give the workspace what `.env` already says.
 *
 * Here rather than on the request path, for two reasons. It should happen
 * before anybody looks at the dashboard, so the dashboard has nothing to ask
 * for. And it should read the environment in exactly one place that tests
 * never run — a service that reached into `process.env` on every request
 * would seed the test database from whatever `.env` the developer happens to
 * have, and a test asserting "the runner address is missing" would pass on
 * one machine and fail on the next.
 *
 * Startup must not die on this. Anything it cannot do, the settings screen
 * still can, so a failure is logged and the server comes up.
 */
export const init: ServerInit = async () => {
  const from = bootstrapFromEnv();
  try {
    // The key ring is needed only to seal a model key, and building it throws
    // on a malformed SECRET_ENCRYPTION_KEY — so it is built only when there
    // is something to seal, and inside the try.
    const ring = from.modelKey && process.env.SECRET_ENCRYPTION_KEY ? keyRingFromEnv() : undefined;
    const { seeded } = await bootstrapWorkspace(db(), {
      runnerBaseUrl: from.runnerBaseUrl,
      orchestratorBaseUrl: from.orchestratorBaseUrl,
      orchestratorWorkflowId: from.orchestratorWorkflowId,
      modelKey: from.modelKey?.value,
      ring,
    });
    if (seeded.length > 0) {
      // Names of fields, never values.
      log.info('workspace settings taken from the environment', {
        seeded,
        ...(seeded.includes('model credential') ? { model_key_from: from.modelKey?.from } : {}),
      });
    }
    if (from.modelKey && !ring) {
      log.warn(
        'a model key is in the environment but SECRET_ENCRYPTION_KEY is not set, so it was not stored',
        { model_key_from: from.modelKey.from, remedy: 'set SECRET_ENCRYPTION_KEY and restart' },
      );
    }
  } catch (error) {
    log.error('could not seed the workspace from the environment', {
      detail: error instanceof Error ? error.message : String(error),
    });
  }
};
