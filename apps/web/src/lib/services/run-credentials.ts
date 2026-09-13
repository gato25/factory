import type { Database } from '@factory/db';
import { credentials, repositories, workspaces } from '@factory/db/schema';
import { FactoryError, type PipelineSnapshot } from '@factory/shared';
import { eq } from 'drizzle-orm';
import { type KeyRing, revealForRun } from '$lib/secrets/store';

/**
 * The one place a stored credential becomes a value again (FR-011,
 * Principle V). It exists because the Runner needs environment variables for
 * the sandbox, and it is called only when handing a run to the Runner —
 * never in answer to a browser.
 *
 * The snapshot carries a credential REFERENCE rather than a value, so the
 * orchestration service never holds one (FR-083). This is where the
 * reference is exchanged, on the app's side of the boundary.
 */

export interface RunCredentials {
  gitToken: string;
  modelKey: string;
  designKey?: string;
}

function pipelineNeedsDesign(snapshot: PipelineSnapshot): boolean {
  return snapshot.pipeline.steps.some((step) => step.type === 'design');
}

/**
 * One stored credential, as a value, for a sandbox. Exported for launches
 * (003 FR-017), which need the repository token the way a run does and must
 * get it the same way — sealed at rest, revealed only on this side of the
 * boundary, handed over as environment.
 */
export async function revealCredential(
  database: Database,
  credentialId: string | null,
  ring: KeyRing,
  what: string,
): Promise<string> {
  if (!credentialId) {
    throw new FactoryError('credential_missing', `no ${what} is configured`);
  }
  const [row] = await database
    .select()
    .from(credentials)
    .where(eq(credentials.id, credentialId))
    .limit(1);
  if (!row) throw new FactoryError('credential_missing', `the ${what} is missing`);

  try {
    return revealForRun({ ciphertext: row.ciphertext, keyVersion: row.keyVersion, hint: '' }, ring);
  } catch (error) {
    throw new FactoryError(
      'credential_invalid',
      `The ${what} could not be read. It may have been sealed with a key that is no longer ` +
        'configured; replace it in Settings.',
      { detail: error instanceof Error ? error.message : String(error) },
    );
  }
}

/**
 * The design credential is resolved ONLY for a run whose pipeline contains a
 * design step (FR-083a) — not withheld from the sandbox afterwards, but never
 * read at all, so a run that does not need it cannot leak it.
 */
export async function resolveRunCredentials(
  database: Database,
  snapshot: PipelineSnapshot,
  ring: KeyRing,
): Promise<RunCredentials> {
  const [workspace] = await database
    .select()
    .from(workspaces)
    .orderBy(workspaces.createdAt)
    .limit(1);
  if (!workspace) throw new FactoryError('invalid_input', 'the workspace is not configured');

  const gitToken = await revealCredential(
    database,
    snapshot.repo.credential_ref,
    ring,
    'repository credential',
  );
  const modelKey = await revealCredential(
    database,
    workspace.modelCredentialId,
    ring,
    'model credential',
  );

  if (!pipelineNeedsDesign(snapshot)) return { gitToken, modelKey };

  const designKey = await revealCredential(
    database,
    workspace.designCredentialId,
    ring,
    'design service credential',
  );
  return { gitToken, modelKey, designKey };
}
