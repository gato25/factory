import type { Database } from '@factory/db';
import { pipelines, repositories, tickets } from '@factory/db/schema';
import { FactoryError, invalidInput, notFound, type Step } from '@factory/shared';
import { desc, eq, sql } from 'drizzle-orm';
import { assertRepositoryUsable } from './repository';
import { m } from '$lib/i18n';

/**
 * A ticket names one repository and carries a title, a free-text description
 * and any number of acceptance criteria (FR-015). Only the repository and the
 * title are required (FR-016).
 */

export interface CreateTicketInput {
  repositoryId: string;
  title: string;
  description?: string;
  acceptanceCriteria?: string[];
  pipelineId?: string;
  /** FR-017 — a ticket may be saved without being started. */
  start: boolean;
}

/** T058 — the state vocabulary a ticket moves through (FR-022). */
export const TICKET_STATES = [
  'draft',
  'queued',
  'running',
  'waiting_approval',
  'done',
  'failed',
  'cancelled',
] as const;
export type TicketState = (typeof TICKET_STATES)[number];

const TERMINAL_STATES: TicketState[] = ['done', 'failed', 'cancelled'];
/** T057 — a stable, human-readable identifier, and the branch derived from it. */
export function branchNameFor(reference: string, title: string): string {
  const number = reference.replace(/^#/, '');
  return `factory/${number}-${slugify(title)}`;
}

export function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
  return slug.length > 0 ? slug : 'change';
}

async function nextReference(database: Database): Promise<string> {
  const [row] = await database
    .select({
      max: sql<number>`coalesce(max(nullif(regexp_replace(${tickets.reference},
      '[^0-9]', '', 'g'), '')::int), 0)`,
    })
    .from(tickets);
  return `#${(row?.max ?? 0) + 1}`;
}

export async function createTicket(
  database: Database,
  input: CreateTicketInput,
  createdBy: string,
) {
  const title = input.title.trim();
  if (title.length === 0) {
    throw invalidInput(m.form.ticketTitleLong);
  }
  // A repository whose credential no longer works cannot start a run (FR-013).
  const repository = input.start
    ? await assertRepositoryUsable(database, input.repositoryId)
    : await database
        .select()
        .from(repositories)
        .where(eq(repositories.id, input.repositoryId))
        .limit(1)
        .then((rows) => {
          const found = rows[0];
          if (!found) throw notFound(m.error.repositoryNotConnected);
          return found;
        });

  // T059 — default to the repository's pipeline, but the author may choose (FR-018).
  const pipelineId = input.pipelineId ?? repository.defaultPipelineId ?? undefined;
  if (input.start && !pipelineId) {
    throw invalidInput(
      `${repository.fullPath} has no default pipeline. Choose one, or set a default on the repository.`,
    );
  }
  const pipelineVersion = pipelineId
    ? await database
        .select({ version: pipelines.currentVersion })
        .from(pipelines)
        .where(eq(pipelines.id, pipelineId))
        .limit(1)
        .then((rows) => rows[0]?.version)
    : undefined;
  if (input.start && pipelineVersion === undefined) {
    throw notFound(m.error.pipelineDoesNotExist);
  }

  const reference = await nextReference(database);
  const inserted = await database
    .insert(tickets)
    .values({
      repositoryId: repository.id,
      createdBy,
      reference,
      title,
      description: input.description?.trim() || null,
      // May be empty (FR-016), but each line is one criterion.
      acceptanceCriteria: (input.acceptanceCriteria ?? [])
        .map((line) => line.trim())
        .filter((line) => line.length > 0),
      pipelineId,
      // Pinned when the run starts, so a later pipeline edit cannot reach it.
      pipelineVersion: input.start ? pipelineVersion : null,
      status: input.start ? 'queued' : 'draft',
      branchName: branchNameFor(reference, title),
    })
    .returning();

  const ticket = inserted[0];
  if (!ticket) throw new FactoryError('conflict', 'could not create the ticket');
  return ticket;
}

export async function getTicket(database: Database, id: string) {
  const [ticket] = await database.select().from(tickets).where(eq(tickets.id, id)).limit(1);
  if (!ticket) throw notFound(m.error.noSuchTicket);
  return ticket;
}

export async function listTickets(database: Database) {
  return database.select().from(tickets).orderBy(desc(tickets.createdAt));
}

/** A ticket's status mirrors its current run's status (spec §6). */
export async function setTicketStatus(database: Database, id: string, status: TicketState) {
  await database.update(tickets).set({ status, updatedAt: new Date() }).where(eq(tickets.id, id));
}

/**
 * The specification step decides whether the ticket changes the interface
 * (FR-099). Everything the app does with that decision goes through here.
 */

/** The step expected to classify: the first one that writes a document. */
export function classifyingStepIndex(steps: Step[]): number | null {
  const index = steps.findIndex(
    (step) => step.type === 'agent' && (step.output_files?.length ?? 0) > 0,
  );
  return index === -1 ? null : index;
}

/** A usable decision arrived: stored on the ticket with its reason (FR-100). */
export async function recordClassification(
  database: Database,
  ticketId: string,
  decision: { hasUi: boolean; rationale: string },
) {
  await database
    .update(tickets)
    .set({
      hasUi: decision.hasUi,
      uiRationale: decision.rationale,
      classificationMissing: false,
      updatedAt: new Date(),
    })
    .where(eq(tickets.id, ticketId));
}

/**
 * No usable decision arrived. The ticket is treated as not changing the
 * interface, the run continues, and the absence is recorded as a field so the
 * warning is a state rather than a line in step output (FR-102).
 *
 * `has_ui` is deliberately left null. Writing `false` would claim a decision
 * nobody made, and the difference between "decided no" and "could not tell"
 * is exactly what this warning exists to show.
 */
export async function noteMissingClassification(
  database: Database,
  ticketId: string,
): Promise<{ noted: boolean }> {
  const updated = await database
    .update(tickets)
    .set({ classificationMissing: true, updatedAt: new Date() })
    .where(
      sql`${tickets.id} = ${ticketId}::uuid
        and ${tickets.hasUi} is null
        and ${tickets.classificationMissing} = false`,
    )
    .returning({ id: tickets.id });
  return { noted: updated.length > 0 };
}

/**
 * What a conditional step is evaluated against. An absent decision reads as
 * no interface change, which is what FR-102 requires and what the
 * orchestrator's own copy of this logic does.
 */
export function ticketHasUi(ticket: { hasUi: boolean | null }): boolean {
  return ticket.hasUi === true;
}
