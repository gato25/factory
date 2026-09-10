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

export const disconnect = command(v.pipe(v.string(), v.uuid()), async (repositoryId) => {
  requireAdmin(user());
  await disconnectRepository(db(), repositoryId);
  await repositories().refresh();
});

export const publicBaseUrl = query(async () => loadWebConfig().publicBaseUrl);
