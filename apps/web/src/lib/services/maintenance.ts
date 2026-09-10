import type { Database } from '@factory/db';
import { runs } from '@factory/db/schema';
import { createLogger } from '@factory/shared';
import { eq } from 'drizzle-orm';
import { enforceCeilings } from '$lib/ledger/enforce';
import { applyTimeout, expiredGates } from './gate';
import type { ReleaseSandbox } from './sandbox';
import { sandboxesToRelease } from './workspace';

const log = createLogger('web');

/**
 * The periodic work. Three requirements need something to happen at a moment
 * nobody triggered:
 *
 *   FR-064b  a gate whose waiting time expired must continue or fail
 *   FR-081   a run past its ceiling must be stopped
 *   FR-086   a retained sandbox must be destroyed when its period ends
 *
 * None of them can be driven by a request, because the whole point is that
 * nobody is there. The services that decide each one already existed; what
 * was missing was anything that called them, which meant a retained sandbox
 * was retained forever and SC-012 could not pass. This is that caller, and
 * it is deliberately a plain function: an operator schedules
 * `scripts/maintenance.ts`, so the schedule lives where operators can see
 * and change it rather than inside a process nobody restarts.
 *
 * Every pass is idempotent, so running it twice, or twice at once, is safe.
 */

export interface SweepDeps {
  /** Destroying a sandbox. The Runner owns the container host, not us. */
  releaseSandbox?: ReleaseSandbox;
}

export interface SweepResult {
  gatesContinued: number;
  gatesFailed: number;
  runsStopped: number;
  sandboxesReleased: number;
  /** What went wrong, without stopping the rest of the pass. */
  problems: string[];
}

export async function sweep(database: Database, deps: SweepDeps = {}): Promise<SweepResult> {
  const result: SweepResult = {
    gatesContinued: 0,
    gatesFailed: 0,
    runsStopped: 0,
    sandboxesReleased: 0,
    problems: [],
  };

  // 1. Gates whose waiting time expired (FR-064b).
  for (const gate of await expiredGates(database)) {
    try {
      const { action } = await applyTimeout(database, gate.runId, gate.stepIndex);
      if (action === 'continue') result.gatesContinued += 1;
      if (action === 'fail') result.gatesFailed += 1;
    } catch (error) {
      result.problems.push(`gate ${gate.runId}/${gate.stepIndex}: ${describe(error)}`);
    }
  }

  // 2. Runs past a ceiling (FR-081). Only runs still in flight can breach:
  // a finished one has stopped consuming whatever it consumed.
  const inFlight = await database
    .select({ id: runs.id })
    .from(runs)
    .where(eq(runs.status, 'running'));
  for (const run of inFlight) {
    try {
      const outcome = await enforceCeilings(database, run.id, {
        releaseSandbox: deps.releaseSandbox,
      });
      if (outcome.failed) result.runsStopped += 1;
    } catch (error) {
      result.problems.push(`ceilings ${run.id}: ${describe(error)}`);
    }
  }

  // 3. Sandboxes due for release (FR-086, SC-012).
  for (const due of await sandboxesToRelease(database)) {
    if (!deps.releaseSandbox) {
      result.problems.push(
        `${due.containerId} is due for release (${due.why}) but nothing can destroy it: ` +
          'the runner address is not configured',
      );
      continue;
    }
    try {
      // Always `done`, whatever the run's own outcome was. Reaching this
      // list IS the decision that retention is over — `sandboxesToRelease`
      // applied it (FR-086) — so asking the Runner to treat it as a failure
      // would start the retention again and the sandbox would never go.
      await deps.releaseSandbox({
        runId: due.runId,
        containerId: due.containerId,
        outcome: 'done',
      });
      // Clearing the id is what records the release. Left set, the row
      // claims the run still holds a container and this pass would try
      // again forever.
      await database
        .update(runs)
        .set({ containerId: null, updatedAt: new Date() })
        .where(eq(runs.id, due.runId));
      result.sandboxesReleased += 1;
    } catch (error) {
      // The id stays on the row: it is the only handle anything has for
      // reclaiming the container, so the next pass tries again.
      result.problems.push(`sandbox ${due.containerId} (run ${due.runId}): ${describe(error)}`);
    }
  }

  if (result.problems.length > 0) {
    log.warn('maintenance pass finished with problems', {
      problems: result.problems.length,
      first: result.problems[0],
    });
  }
  return result;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
