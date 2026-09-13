import type { Database } from '@factory/db';
import { credentials, pipelines, repositories, tickets } from '@factory/db/schema';
import { FactoryError, invalidInput, notFound } from '@factory/shared';
import { count, eq, inArray } from 'drizzle-orm';
import { type KeyRing, seal } from '$lib/secrets/store';
import {
  type AccessCheck,
  clientFor,
  PERMISSION_NAMES,
  type ProviderClient,
  parseRepositoryUrl,
} from './providers';

/**
 * Connecting a repository. The verification in FR-008 happens before anything
 * is saved, and a failure names the specific missing permission (FR-009)
 * rather than reporting a generic failure.
 */

export interface ConnectInput {
  url: string;
  token: string;
  defaultPipelineId?: string;
}

export interface ConnectDeps {
  database: Database;
  keyRing: KeyRing;
  /** Injected so verification is testable without reaching a provider. */
  clientFor?: (provider: 'gitlab' | 'github') => ProviderClient;
}

/** T049 — verify read, branch-create and merge-request-open, then save. */
export async function connectRepository(input: ConnectInput, deps: ConnectDeps) {
  const parsed = parseRepositoryUrl(input.url); // T051 refuses other hosts
  if (input.token.trim().length === 0) {
    throw new FactoryError('credential_missing', 'Paste an access token for this repository.');
  }

  const client = (deps.clientFor ?? clientFor)(parsed.provider);
  const access = await client.checkAccess(parsed, input.token.trim());
  assertUsable(access, parsed.provider); // T050 names what is missing

  const sealed = seal(input.token.trim(), deps.keyRing);
  const inserted = await deps.database.transaction(async (tx) => {
    const [credential] = await tx
      .insert(credentials)
      .values({
        kind: 'git',
        ciphertext: sealed.ciphertext,
        keyVersion: sealed.keyVersion,
        status: 'valid',
        lastVerifiedAt: new Date().toISOString(),
      })
      .returning();
    if (!credential) throw new FactoryError('conflict', 'could not store the credential');

    return tx
      .insert(repositories)
      .values({
        name: parsed.name,
        fullPath: parsed.fullPath,
        provider: parsed.provider,
        cloneUrl: parsed.cloneUrl,
        defaultBranch: access.defaultBranch ?? 'main',
        credentialId: credential.id,
        defaultPipelineId: input.defaultPipelineId,
        status: 'connected',
      })
      .returning();
  });

  const repository = inserted[0];
  if (!repository) throw new FactoryError('conflict', 'could not save the repository');
  return { repository, hint: sealed.hint };
}

/**
 * T050 — the failure names the permission the provider itself calls it, so
 * the person can go and grant that exact thing.
 */
export function assertUsable(access: AccessCheck, provider: 'gitlab' | 'github'): void {
  const names = PERMISSION_NAMES[provider];
  const missing: string[] = [];
  if (!access.canRead) missing.push(names.canRead);
  if (!access.canCreateBranch) missing.push(names.canCreateBranch);
  if (!access.canOpenMergeRequest) missing.push(names.canOpenMergeRequest);
  if (missing.length === 0) return;

  const suffix = access.detail ? ` (${access.detail})` : '';
  throw new FactoryError(
    'credential_invalid',
    missing.length === 1
      ? `The token is missing ${missing[0]}${suffix}.`
      : `The token is missing ${missing.slice(0, -1).join(', ')} and ${missing.at(-1)}${suffix}.`,
  );
}

/**
 * T055 — a repository whose credential is no longer valid cannot start a new
 * run, and the reason is on the repository (FR-013).
 */
export async function assertRepositoryUsable(database: Database, repositoryId: string) {
  const [repository] = await database
    .select()
    .from(repositories)
    .where(eq(repositories.id, repositoryId))
    .limit(1);
  if (!repository) throw notFound('that repository is not connected');
  if (repository.status !== 'connected') {
    throw new FactoryError(
      repository.status === 'credential_expired' ? 'credential_invalid' : 'credential_missing',
      `${repository.fullPath} cannot start a run: ${
        repository.statusDetail ?? 'its access token is no longer valid'
      }. Replace the token on the repository.`,
    );
  }
  return repository;
}

/** Recorded when a provider rejects the stored credential mid-flight. */
export async function markCredentialExpired(
  database: Database,
  repositoryId: string,
  detail: string,
) {
  await database
    .update(repositories)
    .set({ status: 'credential_expired', statusDetail: detail, updatedAt: new Date() })
    .where(eq(repositories.id, repositoryId));
}

/** Re-verify and replace a token in place, keeping the repository connected. */
export async function replaceCredential(repositoryId: string, token: string, deps: ConnectDeps) {
  const repository = await deps.database
    .select()
    .from(repositories)
    .where(eq(repositories.id, repositoryId))
    .limit(1)
    .then((rows) => rows[0]);
  if (!repository) throw notFound('that repository is not connected');

  const parsed = parseRepositoryUrl(repository.cloneUrl);
  const client = (deps.clientFor ?? clientFor)(parsed.provider);
  const access = await client.checkAccess(parsed, token.trim());
  assertUsable(access, parsed.provider);

  const sealed = seal(token.trim(), deps.keyRing);
  await deps.database.transaction(async (tx) => {
    if (repository.credentialId) {
      await tx
        .update(credentials)
        .set({
          ciphertext: sealed.ciphertext,
          keyVersion: sealed.keyVersion,
          status: 'valid',
          lastVerifiedAt: new Date().toISOString(),
          updatedAt: new Date(),
        })
        .where(eq(credentials.id, repository.credentialId));
    }
    await tx
      .update(repositories)
      .set({ status: 'connected', statusDetail: null, updatedAt: new Date() })
      .where(eq(repositories.id, repositoryId));
  });
  return { hint: sealed.hint };
}

export async function disconnectRepository(database: Database, repositoryId: string) {
  await database.delete(repositories).where(eq(repositories.id, repositoryId));
}

/** For screen 02: running and done counts per repository (FR-012). */
export async function listRepositories(database: Database) {
  const rows = await database.select().from(repositories);
  const running = await database
    .select({ repositoryId: tickets.repositoryId, n: count() })
    .from(tickets)
    .where(inArray(tickets.status, ['queued', 'running', 'waiting_approval']))
    .groupBy(tickets.repositoryId);
  const done = await database
    .select({ repositoryId: tickets.repositoryId, n: count() })
    .from(tickets)
    .where(eq(tickets.status, 'done'))
    .groupBy(tickets.repositoryId);

  const countOf = (list: { repositoryId: string; n: number }[], id: string) =>
    list.find((r) => r.repositoryId === id)?.n ?? 0;

  // The screen names the pipeline rather than showing its id, which means
  // the name has to travel with the row (design.pen, 02 Repositories).
  const named = await database.select({ id: pipelines.id, name: pipelines.name }).from(pipelines);

  return rows.map((repository) => ({
    ...repository,
    ticketsRunning: countOf(running, repository.id),
    ticketsDone: countOf(done, repository.id),
    defaultPipelineName:
      named.find((pipeline) => pipeline.id === repository.defaultPipelineId)?.name ?? null,
  }));
}

/**
 * Which pipeline a new ticket for this repository starts on (FR-012).
 *
 * Settable after connecting, not only during it: a workspace that adds a
 * pipeline later would otherwise have to disconnect and reconnect the
 * repository to use it, which would discard its tickets' history.
 */
export async function setDefaultPipeline(
  database: Database,
  repositoryId: string,
  pipelineId: string | null,
): Promise<{ defaultPipelineId: string | null }> {
  if (pipelineId) {
    const [pipeline] = await database
      .select({ id: pipelines.id })
      .from(pipelines)
      .where(eq(pipelines.id, pipelineId))
      .limit(1);
    if (!pipeline) throw notFound('no such pipeline');
  }
  const updated = await database
    .update(repositories)
    .set({ defaultPipelineId: pipelineId, updatedAt: new Date() })
    .where(eq(repositories.id, repositoryId))
    .returning({ defaultPipelineId: repositories.defaultPipelineId });
  if (updated.length === 0) throw notFound('no such repository');
  return { defaultPipelineId: updated[0]?.defaultPipelineId ?? null };
}

/**
 * How this repository's projects start when launched (003 FR-005).
 *
 * Both empty means detect from the workspace; either set overrides that part.
 * The command runs through a shell inside the sandbox with `PORT` and `HOST`
 * set, so `npm run dev -- --host 0.0.0.0 --port $PORT` is the shape to write.
 */
export async function setRunSettings(
  database: Database,
  repositoryId: string,
  input: { command: string | null; port: number | null },
): Promise<{ runCommand: string | null; runPort: number | null }> {
  const command = input.command?.trim() || null;
  if (command && command.length > 500)
    throw invalidInput('Keep the start command under 500 characters.');
  if (
    input.port !== null &&
    !(Number.isInteger(input.port) && input.port > 0 && input.port < 65536)
  ) {
    throw invalidInput('The port has to be a whole number between 1 and 65535.');
  }
  const updated = await database
    .update(repositories)
    .set({ runCommand: command, runPort: input.port, updatedAt: new Date() })
    .where(eq(repositories.id, repositoryId))
    .returning({ runCommand: repositories.runCommand, runPort: repositories.runPort });
  const row = updated[0];
  if (!row) throw notFound('no such repository');
  return row;
}
