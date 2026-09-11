#!/usr/bin/env bun
/**
 * T225, SC-011 — scan every artifact, log chunk and merge request
 * description of every run in a period for credentials. Expect none.
 *
 * Redaction happens where output is INGESTED (Principle V, FR-084), so a
 * finding here is not a display bug to patch downstream: it means something
 * was written to the database unredacted, and it is still there. That is why
 * this scans stored rows rather than rendered pages.
 *
 * The scan is by shape, using the same shapes the redactor enforces
 * (`isClean`). It cannot check by value: the values a run was given are
 * sealed and this audit deliberately does not unseal them — an audit that
 * needed the plaintext of every credential in order to run would be a worse
 * risk than the one it is looking for.
 *
 *   bun scripts/audit/credential-scan.ts [--since 7d]
 */

import { createClient } from '@factory/db';
import { isClean, REDACTION_PLACEHOLDER } from '@factory/shared';
import { type Finding, report, since } from './report';

const { iso, label } = since(Bun.argv);
const { sql } = createClient();

/**
 * What a credential looks like once it HAS been redacted. Finding the
 * placeholder is the system working; only unredacted shapes are findings.
 */
function offending(text: string | null): string | null {
  if (!text) return null;
  const cleaned = isClean(text);
  if (cleaned) return null;
  // Quote a little context so somebody can find the row, without printing
  // the credential itself into a terminal or a CI log.
  const first = text.search(
    /\bghp_|\bgithub_pat_|\bgho_|\bglpat-|\bglrt-|\bsk-ant-|authorization:\s*(?:bearer|basic|token)\s+\S|https?:\/\/[^\s/:@]+:[^\s/@]+@/i,
  );
  const window = text.slice(Math.max(0, first - 20), first + 12);
  return `${JSON.stringify(window)}… (shape recognised, value withheld)`;
}

const findings: Finding[] = [];

const runRows = await sql`
  select r.id, r.attempt, t.reference
  from runs r join tickets t on t.id = r.ticket_id
  where r.created_at >= ${iso}
  order by r.created_at`;

const chunks = await sql`
  select c.run_id, c.step_index, c.seq, c.stream, c.text
  from log_chunks c join runs r on r.id = c.run_id
  where r.created_at >= ${iso}`;

const artifactRows = await sql`
  select a.run_id, a.step_index, a.path, a.kind, a.content
  from artifacts a join runs r on r.id = a.run_id
  where r.created_at >= ${iso} and a.content is not null`;

// A merge request description is written by us from the run's own record, so
// it is the one place a credential could reach a person outside the product.
const mergeRequests = await sql`
  select t.id, t.reference, t.merge_request_url, a.content
  from tickets t
  left join runs r on r.ticket_id = t.id
  left join artifacts a on a.run_id = r.id and a.kind = 'merge_request'
  where t.merge_request_url is not null and t.updated_at >= ${iso}`;

// A step's failure detail is retained and shown, so it is step output in
// every sense the requirement means — and it is the one that leaked.
const failures = await sql`
  select s.run_id, s.step_index, s.error_detail
  from step_results s join runs r on r.id = s.run_id
  where r.created_at >= ${iso} and s.error_detail is not null`;

const runFailures = await sql`
  select id, failure_reason from runs
  where created_at >= ${iso} and failure_reason is not null`;

for (const row of chunks) {
  const found = offending(row.text as string);
  if (found) {
    findings.push({
      where: `log_chunks run=${row.run_id} step=${row.step_index} seq=${row.seq} (${row.stream})`,
      detail: found,
    });
  }
}
for (const row of artifactRows) {
  const found = offending(row.content as string | null);
  if (found) {
    findings.push({
      where: `artifacts run=${row.run_id} step=${row.step_index} ${row.kind} ${row.path}`,
      detail: found,
    });
  }
}
for (const row of mergeRequests) {
  const found = offending(row.content as string | null);
  if (found) {
    findings.push({
      where: `merge request for ${row.reference} — ${row.merge_request_url}`,
      detail: found,
    });
  }
}
for (const row of failures) {
  const found = offending(row.error_detail as string | null);
  if (found) {
    findings.push({
      where: `step_results.error_detail run=${row.run_id} step=${row.step_index}`,
      detail: found,
    });
  }
}
for (const row of runFailures) {
  const found = offending(row.failure_reason as string | null);
  if (found) {
    findings.push({ where: `runs.failure_reason run=${row.id}`, detail: found });
  }
}

const redacted = chunks.filter((row) =>
  (row.text as string).includes(REDACTION_PLACEHOLDER),
).length;

const examined =
  `${runRows.length} run(s) since ${label}: ${chunks.length} log chunk(s), ` +
  `${artifactRows.length} artifact(s) with text, ${mergeRequests.length} merge request(s), ` +
  `${failures.length + runFailures.length} failure detail(s)`;

const code = report({
  criterion: 'SC-011 — no credential appears in any run output',
  examined,
  findings,
  // Nothing to scan proves nothing. Say so rather than passing.
  inconclusive:
    runRows.length === 0
      ? `no runs since ${label}, so nothing was scanned — widen --since or run a pipeline first`
      : undefined,
  notes:
    redacted > 0
      ? [`${redacted} chunk(s) contain ${REDACTION_PLACEHOLDER}: redaction at ingest is working`]
      : [],
});

await sql.end();
process.exit(code);
