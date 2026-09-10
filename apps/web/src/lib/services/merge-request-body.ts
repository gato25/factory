import type { Database } from '@factory/db';
import { artifacts } from '@factory/db/schema';
import type { PipelineSnapshot } from '@factory/shared';
import { sql } from 'drizzle-orm';
import { designSourceUrl } from './gate';
import { composeMergeRequest, type MergeRequestContent } from './merge-request';
import { getRun } from './run';

/**
 * Everything the merge request needs, resolved from the run's own record.
 *
 * This exists because the composer needs three things the orchestration
 * service cannot know: the ticket's address on this deployment, the screens'
 * addresses on this deployment, and where the committed design source can be
 * opened on the provider. Only the application has all three, which is why
 * the workflow fetches the body rather than assembling it.
 */
export async function mergeRequestBody(
  database: Database,
  runId: string,
  publicBaseUrl: string,
): Promise<MergeRequestContent> {
  const run = await getRun(database, runId);
  const snapshot = run.snapshot as PipelineSnapshot;
  const base = publicBaseUrl.replace(/\/+$/, '');

  const rows = await database
    .select({
      id: artifacts.id,
      kind: artifacts.kind,
      path: artifacts.path,
      version: artifacts.version,
      screenName: artifacts.screenName,
    })
    .from(artifacts)
    .where(
      sql`${artifacts.runId} = ${runId}::uuid and ${artifacts.kind} in ('screen', 'design_file')`,
    )
    // Creation order: the order the design step produced them, which is the
    // only order that means anything. Sorted by path, "sign-in-error" comes
    // before "sign-in" — a reviewer meets the failure state before the thing
    // that fails.
    .orderBy(artifacts.createdAt, artifacts.id);

  // The newest version of each path, in the order that path first appeared.
  // A revised design replaces its predecessor for the reviewer's purposes,
  // while the old one stays readable on the run — and a revision does not
  // move the screen to the end of the list.
  const newest = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    const existing = newest.get(row.path);
    if (!existing || row.version > existing.version) newest.set(row.path, row);
  }

  const chosen = [...newest.values()];
  const screens = chosen
    .filter((row) => row.kind === 'screen')
    .map((row) => ({ url: `${base}/api/artifacts/${row.id}/image`, name: row.screenName }));
  const source = chosen.find((row) => row.kind === 'design_file');

  return composeMergeRequest(database, runId, {
    ticketUrl: `${base}/tickets/${run.ticketId}`,
    screens: screens.length > 0 ? screens : undefined,
    designSourceUrl: source ? (designSourceUrl(snapshot, source.path) ?? undefined) : undefined,
  });
}
