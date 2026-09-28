#!/usr/bin/env bun
/**
 * T230, SC-002 — at least 70% of tickets whose acceptance criteria are
 * complete and unambiguous reach an open merge request on the first attempt,
 * with no human editing of the produced code.
 *
 * Three parts of that sentence need care, because each is a place where an
 * audit could quietly measure something easier:
 *
 * "complete and unambiguous" is a judgement about a written ticket, and this
 * script cannot make it. So it does not pretend to: it excludes only what it
 * can defend excluding — a ticket with no criteria at all — and reports the
 * population it measured so a person can see what the number is about. A
 * ticket may be marked `--exclude <reference>` when somebody has read it and
 * judged its criteria incomplete; the exclusions are printed, so the number
 * always comes with its own caveats attached.
 *
 * "on the first attempt" means attempt 1 reached the merge request. A ticket
 * that succeeded on attempt 2 counts against the rate, which is the whole
 * point: retrying is recovery, not success.
 *
 * "no human editing of the produced code" is observable. An artifact edited
 * at a gate carries `created_by`, so a first attempt whose merge request
 * rests on a human-edited artifact is not a first-attempt success.
 *
 *   bun scripts/audit/first-attempt-rate.ts [--since 30d] [--target 0.7]
 *                                           [--exclude '#142,#150']
 */

import { createClient } from '@factory/db';
import {
  firstAttemptOf,
  firstAttemptRows,
  type Miss,
} from '../../apps/web/src/lib/services/first-attempt';
import { type Finding, report, since } from './report';

const { iso, label } = since(Bun.argv, '30d');
const targetIndex = Bun.argv.indexOf('--target');
const target = targetIndex === -1 ? 0.7 : Number(Bun.argv[targetIndex + 1]);
if (!Number.isFinite(target) || target <= 0 || target > 1) {
  throw new Error('--target expects a fraction, for example 0.7 for 70%');
}
const excludeIndex = Bun.argv.indexOf('--exclude');
const excluded = new Set(
  excludeIndex === -1
    ? []
    : (Bun.argv[excludeIndex + 1] ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
);

const { db, sql } = createClient();

// The counting is the dashboard's, so the two report the same number by
// construction (specs/004-bento-redesign SC-004). What stays here is what only
// the audit does: the hand exclusions, the target, and saying why each miss
// missed.
const rows = await firstAttemptRows(db, new Date(iso));
const {
  noCriteria,
  excluded: byHand,
  undecided,
  decided,
  successes: firstAttemptSuccesses,
  missed,
  rate: measured,
} = firstAttemptOf(rows, { exclude: excluded });
const population = [...undecided, ...decided];
const rate = measured ?? 0;

const findings: Finding[] = [];
const notes: string[] = [];

const said = (why: Miss): string => {
  switch (why.kind) {
    case 'no_merge_request':
      return `no merge request (ticket is ${why.status}, first attempt ${why.firstStatus})`;
    case 'later_attempt':
      return `succeeded on attempt ${why.attempts}, not the first`;
    case 'edited':
      return `${why.artifacts} artifact(s) on the first attempt were edited by a person`;
    case 'first_attempt_ended':
      return `first attempt ended ${why.firstStatus}`;
  }
};

if (decided.length > 0 && rate < target) {
  findings.push({
    where: `${firstAttemptSuccesses.length} of ${decided.length} tickets`,
    detail:
      `${Math.round(rate * 100)}% reached an open merge request on the first attempt with no ` +
      `human editing; the criterion is ${Math.round(target * 100)}%`,
  });

  // Naming why each of the rest missed is the useful half: a rate on its own
  // says nothing about what to fix.
  for (const { row, why } of missed) {
    findings.push({ where: `  ${row.reference} ${row.title}`, detail: said(why) });
  }
}

if (noCriteria.length > 0) {
  notes.push(
    `${noCriteria.length} ticket(s) have no acceptance criteria and are outside the criterion, ` +
      'which is about tickets whose criteria are complete',
  );
}
if (byHand.length > 0) {
  notes.push(
    `excluded by hand: ${byHand.map((row) => row.reference).join(', ')} — somebody judged ` +
      'their criteria incomplete or ambiguous',
  );
}
if (undecided.length > 0) {
  notes.push(`${undecided.length} ticket(s) are still in flight, so their outcome is not counted`);
}
if (decided.length > 0) {
  notes.push(
    `${firstAttemptSuccesses.length} of ${decided.length} on the first attempt = ` +
      `${Math.round(rate * 100)}%`,
  );
}

const code = report({
  criterion: `SC-002 — at least ${Math.round(target * 100)}% reach a merge request on the first attempt`,
  examined:
    `${rows.length} non-draft ticket(s) since ${label}; ${population.length} in the population, ` +
    `${decided.length} with a settled outcome`,
  findings,
  inconclusive:
    decided.length === 0
      ? `no ticket with acceptance criteria has settled since ${label}, so there is no rate to ` +
        'report — a percentage of nothing is not a measurement'
      : undefined,
  notes,
});

await sql.end();
process.exit(code);
