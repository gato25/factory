import type { Database } from '@factory/db';
import { tickets } from '@factory/db/schema';
import { and, gte, ne, sql } from 'drizzle-orm';

/**
 * How often a ticket reaches a merge request on its first attempt with nobody
 * editing what the agents wrote — counted ONE way, for the two places that
 * report it: the dashboard's figure (specs/004-bento-redesign FR-012) and the
 * audit, `scripts/audit/first-attempt-rate.ts` (001 SC-002).
 *
 * They were going to be two copies of the same rule, and two copies drift:
 * the dashboard would say 92% while the audit said 88%, and nobody could say
 * which was wrong. So the audit's counting moved here and both call it; the
 * two numbers are equal because they are the same number (SC-004).
 *
 * The rule, as the audit has always applied it:
 *   - the population is the tickets created in the window, not drafts, that
 *     have at least one acceptance criterion — a ticket with none cannot be
 *     judged against a criterion about tickets with complete criteria;
 *   - of those, only the decided count: one still queued, running or waiting
 *     has no outcome yet, and counting it as a failure would make the rate a
 *     function of when it was read;
 *   - a success reached a merge request, took one attempt, that attempt
 *     finished done, and no artifact of it was edited by a person.
 *
 * Imports nothing through `$lib`, because the audit loads it outside
 * SvelteKit.
 */

export interface FirstAttemptRow {
  id: string;
  reference: string;
  title: string;
  status: string;
  mergeRequestUrl: string | null;
  criteria: number;
  attempts: number | null;
  editedOnFirst: number;
  firstStatus: string | null;
}

/**
 * One query, whatever the size of the window. The correlated subqueries name
 * `"tickets"."id"` in full: the query builder writes a lone column bare in a
 * single-table select, and a bare `"id"` inside them would be the run's own.
 */
export async function firstAttemptRows(
  database: Database,
  since: Date,
): Promise<FirstAttemptRow[]> {
  return database
    .select({
      id: tickets.id,
      reference: tickets.reference,
      title: tickets.title,
      status: tickets.status,
      mergeRequestUrl: tickets.mergeRequestUrl,
      criteria: sql<number>`coalesce(array_length(${tickets.acceptanceCriteria}, 1), 0)`,
      attempts: sql<
        number | null
      >`(select max(r.attempt) from runs r where r.ticket_id = "tickets"."id")`,
      editedOnFirst: sql<number>`(select count(*)::int from artifacts a
          join runs r on r.id = a.run_id
         where r.ticket_id = "tickets"."id" and r.attempt = 1 and a.created_by is not null)`,
      firstStatus: sql<string | null>`(select r.status::text from runs r
         where r.ticket_id = "tickets"."id" and r.attempt = 1)`,
    })
    .from(tickets)
    .where(and(gte(tickets.createdAt, since), ne(tickets.status, 'draft')))
    .orderBy(tickets.createdAt);
}

const UNDECIDED = ['queued', 'running', 'waiting_approval'];

/** Why a decided ticket did not count as a first-attempt success. */
export type Miss =
  | { kind: 'no_merge_request'; status: string; firstStatus: string | null }
  | { kind: 'later_attempt'; attempts: number }
  | { kind: 'edited'; artifacts: number }
  | { kind: 'first_attempt_ended'; firstStatus: string | null };

export interface FirstAttemptCount {
  /** Created in the window with no acceptance criteria: outside the criterion. */
  noCriteria: FirstAttemptRow[];
  /** Left out by hand (the audit's `--exclude`); the dashboard never excludes. */
  excluded: FirstAttemptRow[];
  undecided: FirstAttemptRow[];
  decided: FirstAttemptRow[];
  successes: FirstAttemptRow[];
  missed: { row: FirstAttemptRow; why: Miss }[];
  counted: number;
  /** `null` when nothing is decided: there is nothing to measure, which is not 0%. */
  rate: number | null;
}

export function firstAttemptOf(
  rows: FirstAttemptRow[],
  options: { exclude?: ReadonlySet<string> } = {},
): FirstAttemptCount {
  const exclude = options.exclude ?? new Set<string>();
  const noCriteria = rows.filter((row) => row.criteria === 0);
  const excluded = rows.filter((row) => row.criteria > 0 && exclude.has(row.reference));
  const population = rows.filter((row) => row.criteria > 0 && !exclude.has(row.reference));
  const undecided = population.filter((row) => UNDECIDED.includes(row.status));
  const decided = population.filter((row) => !UNDECIDED.includes(row.status));

  const successes: FirstAttemptRow[] = [];
  const missed: FirstAttemptCount['missed'] = [];
  for (const row of decided) {
    const why = missOf(row);
    if (why) missed.push({ row, why });
    else successes.push(row);
  }

  return {
    noCriteria,
    excluded,
    undecided,
    decided,
    successes,
    missed,
    counted: decided.length,
    rate: decided.length === 0 ? null : successes.length / decided.length,
  };
}

function missOf(row: FirstAttemptRow): Miss | null {
  if (row.mergeRequestUrl === null) {
    return { kind: 'no_merge_request', status: row.status, firstStatus: row.firstStatus };
  }
  if ((row.attempts ?? 0) > 1) return { kind: 'later_attempt', attempts: row.attempts ?? 0 };
  if (row.editedOnFirst > 0) return { kind: 'edited', artifacts: row.editedOnFirst };
  if (row.attempts !== 1 || row.firstStatus !== 'done') {
    return { kind: 'first_attempt_ended', firstStatus: row.firstStatus };
  }
  return null;
}

/** The dashboard's figure: how many were counted, how many succeeded, and the share. */
export async function firstAttempt(
  database: Database,
  window: { since: Date },
): Promise<{ counted: number; successes: number; rate: number | null }> {
  const result = firstAttemptOf(await firstAttemptRows(database, window.since));
  return { counted: result.counted, successes: result.successes.length, rate: result.rate };
}
