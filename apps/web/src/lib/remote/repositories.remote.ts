import * as v from 'valibot';
import { command, form, getRequestEvent, query } from '$app/server';
import { loadWebConfig } from '$lib/config';
import { db } from '$lib/db';
import { keyRingFromEnv } from '$lib/secrets/store';
import { requireAdmin } from '$lib/services/authz';
import { REQUIRED_SCOPES } from '$lib/services/providers';
import {
  connectRepository,
  disconnectRepository,
  listRepositories,
  replaceCredential,
  setDefaultPipeline,
  setRunSettings,
} from '$lib/services/repository';

/**
 * Thin by design: validate, check authorisation, call a service. No business
 * logic lives here, because the remote-functions API is experimental and a
 * signature change must stay a mechanical edit (research.md risk 1).
 */

function user() {
  return getRequestEvent().locals.user;
}

/** Anyone in the workspace may see the repositories. */
export const repositories = query(async () => {
  return listRepositories(db());
});

/** The scopes to state at the point the credential is entered (FR-010). */
export const requiredScopes = query(async () => REQUIRED_SCOPES);

const ConnectSchema = v.object({
  url: v.pipe(v.string(), v.trim(), v.minLength(1, 'Paste the repository address.')),
  token: v.pipe(v.string(), v.minLength(1, 'Paste an access token.')),
  defaultPipelineId: v.optional(v.string()),
});

/**
 * A form rather than a command, so connecting works without JavaScript
 * (contracts/ui-data.md).
 */
export const connect = form(ConnectSchema, async (data) => {
  requireAdmin(user());
  const { repository, hint } = await connectRepository(
    {
      url: data.url,
      token: data.token,
      defaultPipelineId: data.defaultPipelineId || undefined,
    },
    { database: db(), keyRing: keyRingFromEnv() },
  );
  await repositories().refresh();
  return { id: repository.id, fullPath: repository.fullPath, hint };
});

export const replaceToken = form(
  v.object({
    repositoryId: v.pipe(v.string(), v.uuid()),
    token: v.pipe(v.string(), v.minLength(1, 'Paste the new access token.')),
  }),
  async (data) => {
    requireAdmin(user());
    const { hint } = await replaceCredential(data.repositoryId, data.token, {
      database: db(),
      keyRing: keyRingFromEnv(),
    });
    await repositories().refresh();
    return { hint };
  },
);

/**
 * Which pipeline a new ticket here starts on. Administrator-only, like every
 * other change to a repository's connection (FR-004).
 */
export const changeDefaultPipeline = command(
  v.object({
    repositoryId: v.pipe(v.string(), v.uuid()),
    // Empty means none: a repository may have no default, and a ticket then
    // asks for a pipeline rather than assuming one.
    pipelineId: v.optional(v.string(), ''),
  }),
  async ({ repositoryId, pipelineId }) => {
    requireAdmin(user());
    await setDefaultPipeline(db(), repositoryId, pipelineId || null);
    await repositories().refresh();
  },
);

/**
 * How this repository's projects start when a ticket is launched (003
 * FR-005). Empty fields mean "detect it". Administrator-only, like every other
 * change to a repository.
 */
export const changeRunSettings = form(
  v.object({
    repositoryId: v.pipe(v.string(), v.uuid()),
    command: v.pipe(
      v.optional(v.string(), ''),
      v.trim(),
      v.maxLength(500, 'Keep the start command under 500 characters.'),
    ),
    port: v.pipe(
      v.optional(v.string(), ''),
      v.trim(),
      v.check(
        (text) =>
          text === '' || (/^\d{1,5}$/.test(text) && Number(text) >= 1 && Number(text) <= 65535),
        'The port has to be a whole number between 1 and 65535.',
      ),
    ),
  }),
  async (data) => {
    requireAdmin(user());
    await setRunSettings(db(), data.repositoryId, {
      command: data.command || null,
      port: data.port === '' ? null : Number(data.port),
    });
    await repositories().refresh();
    return { saved: true };
  },
);

export const disconnect = command(v.pipe(v.string(), v.uuid()), async (repositoryId) => {
  requireAdmin(user());
  await disconnectRepository(db(), repositoryId);
  await repositories().refresh();
});

export const publicBaseUrl = query(async () => loadWebConfig().publicBaseUrl);

/**
 * The address the EXECUTION service reaches this application at.
 *
 * Not the same as `publicBaseUrl`, and the settings screen showed that one
 * next to the words "n8n posts step results and approvals here" — which was
 * true until n8n moved into a container, where `localhost` is the container
 * itself. Somebody diagnosing a callback that never arrived would have
 * checked the address they were shown, found it correct, and looked
 * elsewhere.
 */
export const callbackBaseUrl = query(async () => loadWebConfig().callbackBaseUrl);
