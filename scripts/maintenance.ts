#!/usr/bin/env bun
/**
 * The periodic pass an operator schedules. Three requirements need something
 * to happen at a moment nobody triggered — a gate whose waiting time expired
 * (FR-064b), a run past its ceiling (FR-081), a retained sandbox whose period
 * ended (FR-086) — and none of them can be driven by a request, because the
 * whole point is that nobody is there.
 *
 * It lives here rather than as a timer inside the web application on
 * purpose: a schedule an operator can see, change and stop is worth more
 * than one inside a process nobody restarts. Every pass is idempotent, so a
 * missed run costs lateness rather than correctness, and two overlapping
 * runs are safe.
 *
 *   bun scripts/maintenance.ts             # once
 *   bun scripts/maintenance.ts --quiet     # print only when something happened
 *
 * Exits 0 when the pass completed, 1 when part of it could not.
 */

import { createClient } from '@factory/db';
import { sweep } from '../apps/web/src/lib/services/maintenance';
import { runnerRelease } from '../apps/web/src/lib/services/sandbox';

const quiet = Bun.argv.includes('--quiet');
const { db, sql } = createClient();

// The Runner's address comes from the workspace — the same source the
// settings screen configures — and its token from the environment, which is
// where a credential belongs (FR-011).
const [workspace] = await sql`
  select runner_base_url, retain_failed_sandboxes_hours
  from workspaces order by created_at limit 1`;
const baseUrl = (workspace?.runner_base_url as string | null) ?? '';
const retainFailedHours = (workspace?.retain_failed_sandboxes_hours as number | undefined) ?? 0;
const authToken = process.env.RUNNER_AUTH_TOKEN ?? '';

const canRelease = Boolean(baseUrl && authToken);
const result = await sweep(db, {
  releaseSandbox: canRelease ? runnerRelease({ baseUrl, authToken, retainFailedHours }) : undefined,
});

const did =
  result.gatesContinued +
  result.gatesFailed +
  result.runsStopped +
  result.sandboxesReleased +
  result.problems.length;

if (!quiet || did > 0) {
  console.log(
    [
      `gates continued: ${result.gatesContinued}`,
      `gates failed: ${result.gatesFailed}`,
      `runs stopped at a ceiling: ${result.runsStopped}`,
      `sandboxes released: ${result.sandboxesReleased}`,
    ].join('; '),
  );
  for (const problem of result.problems) console.log(`  problem: ${problem}`);
  if (!canRelease) {
    console.log(
      baseUrl
        ? '  note: RUNNER_AUTH_TOKEN is not set, so no sandbox can be released'
        : '  note: the workspace has no runner address, so no sandbox can be released',
    );
  }
}

await sql.end();
process.exit(result.problems.length > 0 ? 1 : 0);
