#!/usr/bin/env bun
/**
 * T227, SC-012 — every sandbox released within five minutes of its run
 * ending, except failures deliberately retained for diagnosis (FR-086).
 *
 * A sandbox is a running container nobody is watching, so "released" has to
 * mean something observable rather than something intended. What the record
 * holds is `runs.container_id`: the Runner clears it when it destroys the
 * workspace, so a finished run that still names a container either has one,
 * or had one and nothing recorded its destruction. Both are the same problem
 * for whoever pays for the machine, and this audit does not distinguish them
 * — it reports what the record says and lets somebody go and look.
 *
 * The retention exception is honoured, and its expiry is checked too: a
 * failure kept for six hours is fine at five hours and a finding at seven.
 *
 *   bun scripts/audit/sandbox-release-check.ts [--since 7d] [--grace 5m]
 */

import { createClient } from '@factory/db';
import { type Finding, report, since } from './report';

const { iso, label } = since(Bun.argv);
const graceIndex = Bun.argv.indexOf('--grace');
const graceRaw = graceIndex === -1 ? '5m' : (Bun.argv[graceIndex + 1] ?? '5m');
const graceMatch = graceRaw.match(/^(\d+)([ms])$/);
if (!graceMatch) throw new Error('--grace expects something like 5m or 30s');
const graceMs = Number(graceMatch[1]) * (graceMatch[2] === 'm' ? 60_000 : 1_000);

const { sql } = createClient();

const [workspace] = await sql`
  select retain_failed_sandboxes_hours from workspaces order by created_at limit 1`;
const retainHours = (workspace?.retain_failed_sandboxes_hours as number | undefined) ?? 0;
const retainMs = retainHours * 3_600_000;

const rows = await sql`
  select r.id, r.status, r.container_id, r.finished_at, t.reference
  from runs r
  join tickets t on t.id = r.ticket_id
  where r.created_at >= ${iso}
    and r.status in ('done', 'failed', 'cancelled')
    and r.finished_at is not null
  order by r.finished_at`;

const findings: Finding[] = [];
const notes: string[] = [];
const now = Date.now();
let stillRetained = 0;
let released = 0;

const minutes = (ms: number) => `${Math.round(ms / 60_000)}m`;

for (const row of rows) {
  const containerId = row.container_id as string | null;
  if (!containerId) {
    released += 1;
    continue;
  }

  const finishedAt = new Date(row.finished_at as string).getTime();
  const held = now - finishedAt;
  // A failure may be kept deliberately. Nothing else may.
  const allowance = row.status === 'failed' ? retainMs + graceMs : graceMs;

  if (held <= allowance) {
    if (row.status === 'failed' && retainMs > 0) {
      stillRetained += 1;
    } else {
      // Inside the grace period, so not yet a finding — but not released
      // either. Counting it as released would be the audit lying.
      notes.push(
        `${row.reference} (${row.status}) finished ${minutes(held)} ago and still names ` +
          `${containerId}; inside the ${minutes(graceMs)} grace period`,
      );
    }
    continue;
  }

  findings.push({
    where: `run=${row.id} ${row.reference} (${row.status}) container=${containerId}`,
    detail:
      row.status === 'failed' && retainMs > 0
        ? `held ${minutes(held)} after finishing; retention is ${retainHours}h plus ` +
          `${minutes(graceMs)} grace, so it is ${minutes(held - allowance)} overdue`
        : `held ${minutes(held)} after finishing; the criterion allows ${minutes(graceMs)}` +
          (row.status === 'failed'
            ? ' (retention is set to zero, so a failure is released like any other run)'
            : ''),
  });
}

notes.unshift(
  retainMs > 0
    ? `failed runs are deliberately retained for ${retainHours}h (FR-086)`
    : 'retention is zero, so every sandbox is released as soon as its run ends',
);
if (stillRetained > 0) {
  notes.push(`${stillRetained} failed run(s) are inside their retention window, as intended`);
}

const code = report({
  criterion: `SC-012 — every sandbox released within ${minutes(graceMs)} of its run ending`,
  examined:
    `${rows.length} finished run(s) since ${label}; ${released} name no container, ` +
    `${rows.length - released} still do`,
  findings,
  inconclusive:
    rows.length === 0 ? `no run finished since ${label}, so no sandbox was examined` : undefined,
  notes,
});

await sql.end();
process.exit(code);
