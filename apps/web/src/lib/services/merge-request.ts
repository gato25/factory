import type { Database } from '@factory/db';
import { artifacts, runs, tickets } from '@factory/db/schema';
import { desc, eq, sql } from 'drizzle-orm';

/**
 * The merge request body. A reviewer who never saw the ticket must be able to
 * judge the change from the merge request alone (SC-014), which is why the
 * specification and plan travel with it rather than being linked away.
 */

export interface MergeRequestContent {
  title: string;
  description: string;
  labels: string[];
  targetBranch: string;
  sourceBranch: string;
}

export interface ComposeOptions {
  ticketUrl: string;
  /** Screens embedded above the summary arrive with user story 5 (FR-067a). */
  screenUrls?: string[];
  designSourceUrl?: string;
}

export async function composeMergeRequest(
  database: Database,
  runId: string,
  options: ComposeOptions,
): Promise<MergeRequestContent> {
  const [run] = await database.select().from(runs).where(eq(runs.id, runId)).limit(1);
  if (!run) throw new Error(`no such run: ${runId}`);
  const [ticket] = await database
    .select()
    .from(tickets)
    .where(eq(tickets.id, run.ticketId))
    .limit(1);
  if (!ticket) throw new Error(`run ${runId} has no ticket`);

  const documents = await database
    .select()
    .from(artifacts)
    .where(sql`${artifacts.runId} = ${runId}::uuid and ${artifacts.kind} = 'document'`)
    .orderBy(desc(artifacts.version));

  const latest = (path: string) => documents.find((d) => d.path === path)?.content ?? null;
  const spec = latest('docs/spec.md');
  const plan = latest('docs/plan.md');

  const durationMinutes =
    run.startedAt && run.finishedAt
      ? Math.max(1, Math.round((run.finishedAt.getTime() - run.startedAt.getTime()) / 60_000))
      : null;

  const sections: string[] = [];

  if (ticket.description) sections.push(ticket.description);

  // Screens go above the summary, so a reviewer sees the intended interface
  // before reading the diff (FR-067a).
  if (options.screenUrls?.length) {
    sections.push(
      ['## Screens', ...options.screenUrls.map((url) => `![screen](${url})`)].join('\n\n'),
    );
    if (options.designSourceUrl) {
      sections.push(`[Open the design source](${options.designSourceUrl})`);
    }
  }

  if (ticket.acceptanceCriteria.length > 0) {
    sections.push(
      ['## Acceptance criteria', ...ticket.acceptanceCriteria.map((c) => `- [ ] ${c}`)].join('\n'),
    );
  }

  if (spec) sections.push(collapsible('Specification', spec));
  if (plan) sections.push(collapsible('Plan', plan));

  sections.push(
    [
      '## Run',
      `- Cost: $${run.costUsd}`,
      durationMinutes ? `- Duration: ${durationMinutes} min` : null,
      `- Attempt: ${run.attempt}`,
      `- [Open ticket ${ticket.reference}](${options.ticketUrl})`,
    ]
      .filter(Boolean)
      .join('\n'),
  );

  return {
    title: ticket.title,
    description: sections.join('\n\n'),
    labels: labelsFor(run.snapshot as { pipeline: { name: string } }, ticket.hasUi),
    targetBranch: (run.snapshot as { repo: { default_branch: string } }).repo.default_branch,
    sourceBranch: ticket.branchName ?? '',
  };
}

/**
 * T085 — work produced by the system, and the pipeline that produced it, are
 * identifiable on the provider (FR-068). A ticket classified as interface work
 * gets an additional label (FR-068a).
 */
export function labelsFor(
  snapshot: { pipeline: { name: string } },
  hasUi: boolean | null,
): string[] {
  const labels = ['code-factory', `pipeline:${slug(snapshot.pipeline.name)}`];
  if (hasUi === true) labels.push('ui');
  return labels;
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function collapsible(summary: string, body: string): string {
  return `<details>\n<summary>${summary}</summary>\n\n${body}\n\n</details>`;
}

/**
 * T086 — the merge request address is stored on the ticket, the ticket is
 * marked done and the final cost recorded (FR-069, FR-070a). The activity feed
 * is derived from these rows rather than duplicated into a table of its own.
 *
 * The system never merges (FR-070).
 */
export async function completeRun(
  database: Database,
  runId: string,
  mergeRequestUrl: string,
): Promise<void> {
  const [run] = await database.select().from(runs).where(eq(runs.id, runId)).limit(1);
  if (!run) return;
  await database
    .update(runs)
    .set({ status: 'done', finishedAt: new Date(), updatedAt: new Date() })
    .where(eq(runs.id, runId));
  await database
    .update(tickets)
    .set({ status: 'done', mergeRequestUrl, updatedAt: new Date() })
    .where(eq(tickets.id, run.ticketId));
}
