import type { Database } from '@factory/db';
import { artifacts, runs, stepResults, tickets } from '@factory/db/schema';
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
  /**
   * Screens embedded above the summary (FR-067a). Each carries its name: a
   * page of images all captioned "screen" tells a reviewer nothing about
   * which is which, and the name is already on the artifact.
   */
  screens?: { url: string; name: string | null }[];
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

  const latest = (path: string) => documents.find((d) => d.path === path);
  const spec = latest('docs/spec.md');
  const plan = latest('docs/plan.md');

  // A step that did not run is part of what a reviewer needs to know: a
  // ticket labelled `ui` with no screens is otherwise just puzzling
  // (FR-111).
  const skipped = await database
    .select({ index: stepResults.stepIndex, why: stepResults.conditionNotMet })
    .from(stepResults)
    .where(sql`${stepResults.runId} = ${runId}::uuid and ${stepResults.status} = 'skipped'`)
    .orderBy(stepResults.stepIndex);

  const durationMinutes =
    run.startedAt && run.finishedAt
      ? Math.max(1, Math.round((run.finishedAt.getTime() - run.startedAt.getTime()) / 60_000))
      : null;

  const sections: string[] = [];

  if (ticket.description) sections.push(ticket.description);

  // Screens go above the summary, so a reviewer sees the intended interface
  // before reading the diff (FR-067a).
  if (options.screens?.length) {
    sections.push(
      [
        '## Screens',
        ...options.screens.map(
          (screen, i) => `![${screen.name ?? `Screen ${i + 1}`}](${screen.url})`,
        ),
      ].join('\n\n'),
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

  // The specification is NOT collapsed. It is the part a reviewer needs to
  // judge whether the change is the right change, and SC-014 asks that they
  // can do that from the merge request alone — behind a disclosure triangle
  // is a place things go to be unread. The plan stays collapsed: it is how
  // the work was done, which the diff already shows.
  if (spec) {
    sections.push(`## Specification${edited(spec)}\n\n${spec.content ?? ''}`);
  }
  if (plan) sections.push(collapsible(`Plan${edited(plan)}`, plan.content ?? ''));

  if (skipped.length > 0) {
    sections.push(
      [
        '## Steps that did not run',
        ...skipped.map(
          (step) => `- Step ${step.index + 1}: ${step.why ?? 'its condition was not met'}`,
        ),
      ].join('\n'),
    );
  }

  sections.push(
    [
      '## Run',
      `- Cost: $${trimMoney(run.costUsd)}`,
      durationMinutes ? `- Duration: ${durationMinutes} min` : null,
      // "Attempt 2" without saying so reads as a detail; saying it plainly
      // tells a reviewer this change has been tried before.
      run.attempt === 1 ? '- First attempt' : `- Attempt ${run.attempt} for this ticket`,
      `- [Open ticket ${ticket.reference}](${options.ticketUrl})`,
      // The system never merges (FR-070), and a reviewer should not be left
      // wondering whether it is about to.
      '- Opened by Code Factory, which never merges: this waits for a person.',
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
 * Whether a person changed this document at a gate. It changes how much
 * weight a reviewer should give it — an edited specification is a human's
 * words, not an agent's — and `created_by` already records it, so saying
 * nothing was throwing the fact away.
 */
function edited(document: { createdBy: string | null }): string {
  return document.createdBy ? ' (edited by a person at a review gate)' : '';
}

/** `1.8400` reads like machine output; `1.84` reads like money. */
function trimMoney(value: string): string {
  return value.includes('.') ? value.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '') : value;
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
