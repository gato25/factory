import type { Database } from '@factory/db';
import { type artifactKind, artifacts } from '@factory/db/schema';
import { notFound } from '@factory/shared';
import { and, desc, eq } from 'drizzle-orm';
import type { SessionUser } from './auth';
import { notifyRun } from './notify';

/**
 * Documents and screens a run produced. Every write is a new version and the
 * previous one is retained, so a human's edit never destroys what the agent
 * wrote (FR-054, FR-062).
 */

export interface ArtifactVersion {
  id: string;
  stepIndex: number;
  kind: (typeof artifactKind.enumValues)[number];
  path: string;
  version: number;
  content: string | null;
  screenName: string | null;
  /** An edit carries the person who made it; an agent's output does not. */
  editedBy: string | null;
  createdAt: Date;
}

/** The newest version of one path, which is the version a later step reads. */
export async function currentVersion(
  database: Database,
  runId: string,
  path: string,
): Promise<ArtifactVersion | null> {
  const [row] = await database
    .select()
    .from(artifacts)
    .where(and(eq(artifacts.runId, runId), eq(artifacts.path, path)))
    .orderBy(desc(artifacts.version))
    .limit(1);
  return row ? toVersion(row) : null;
}

/**
 * The newest version of every path. This is what a subsequent step is handed:
 * if a human edited docs/spec.md at a gate, the step after the gate reads
 * their version, not the agent's (FR-062).
 */
export async function currentVersions(
  database: Database,
  runId: string,
): Promise<ArtifactVersion[]> {
  const rows = await database
    .select()
    .from(artifacts)
    .where(eq(artifacts.runId, runId))
    .orderBy(artifacts.path, desc(artifacts.version));
  const latest = new Map<string, ArtifactVersion>();
  for (const row of rows) if (!latest.has(row.path)) latest.set(row.path, toVersion(row));
  return [...latest.values()];
}

/** Every version of one path, newest first — the earlier ones are kept. */
export async function history(
  database: Database,
  runId: string,
  path: string,
): Promise<ArtifactVersion[]> {
  const rows = await database
    .select()
    .from(artifacts)
    .where(and(eq(artifacts.runId, runId), eq(artifacts.path, path)))
    .orderBy(desc(artifacts.version));
  return rows.map(toVersion);
}

/**
 * A human's edit is written as the next version of the same path, attributed
 * to them. The version they replaced stays readable (FR-062, FR-054).
 */
export async function editArtifact(
  database: Database,
  runId: string,
  path: string,
  content: string,
  user: SessionUser,
): Promise<ArtifactVersion> {
  const previous = await currentVersion(database, runId, path);
  if (!previous) throw notFound(`энэ ажиллагаанд засах ${path} алга`);

  const [row] = await database
    .insert(artifacts)
    .values({
      runId,
      stepIndex: previous.stepIndex,
      kind: previous.kind,
      path,
      version: previous.version + 1,
      content,
      screenName: previous.screenName,
      createdBy: user.id,
    })
    .returning();
  if (!row) throw new Error('the edit was not written');

  await notifyRun(database, runId, {
    event: 'artifact_added',
    stepIndex: previous.stepIndex,
    path,
  });
  return toVersion(row);
}

function toVersion(row: typeof artifacts.$inferSelect): ArtifactVersion {
  return {
    id: row.id,
    stepIndex: row.stepIndex,
    kind: row.kind,
    path: row.path,
    version: row.version,
    content: row.content,
    screenName: row.screenName,
    editedBy: row.createdBy,
    createdAt: row.createdAt,
  };
}
