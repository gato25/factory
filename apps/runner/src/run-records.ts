import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PRIVATE_DIR, PRIVATE_FILE } from './orchestrate/state';
import type { RunRecord, RunStore } from './runs';

/**
 * A run's record, kept on disk — everything but its credentials.
 *
 * The record lived in memory only, and a restart lost every one of them.
 * For a run in flight that was survivable: the loop's state file names the
 * sandbox, and adoption rebuilt the record from it. For a run that had
 * FINISHED and whose sandbox was being kept for diagnosis (FR-023, FR-086) it
 * was not: when the retention window ended and the application asked for
 * the sandbox to be released, the runner had no record of the run, answered
 * `released: false`, and the container ran on until its own `sleep` ended.
 *
 * Credentials never go to disk (FR-016, FR-083). They are kept beside the
 * file in memory and rejoined on read, so a record read after a restart has
 * none — which is exactly what `liveRun` treats as a finished run, and what
 * `ensureSandbox` treats as a run to adopt: it fetches fresh credentials from
 * the application, as it always did.
 */
export function fileRunStore(dir: string): RunStore {
  const credentials = new Map<string, RunRecord['credentials']>();
  const pathFor = (runId: string) => join(dir, `${safe(runId)}.json`);
  let sequence = 0;

  return {
    async get(runId) {
      let onDisk: Omit<RunRecord, 'credentials'> | undefined;
      try {
        onDisk = JSON.parse(await readFile(pathFor(runId), 'utf8')) as Omit<
          RunRecord,
          'credentials'
        >;
      } catch {
        return undefined;
      }
      const held = credentials.get(runId);
      return held ? { ...onDisk, credentials: held } : onDisk;
    },

    async set(runId, value) {
      const { credentials: secret, ...rest } = value;
      if (secret) credentials.set(runId, secret);
      else credentials.delete(runId);
      // Private to the runner's user, like the state files: the snapshot in
      // here carries the run's resume secret (see `PRIVATE_FILE`).
      await mkdir(dir, { recursive: true, mode: PRIVATE_DIR });
      const target = pathFor(runId);
      sequence += 1;
      const temporary = `${target}.${process.pid}.${sequence}.tmp`;
      await writeFile(temporary, JSON.stringify(rest, null, 2), { mode: PRIVATE_FILE });
      // rename is atomic on the same volume; a failure leaves the old file.
      await rename(temporary, target);
    },

    async delete(runId) {
      credentials.delete(runId);
      await rm(pathFor(runId), { force: true });
    },
  };
}

/** A run id is a UUID, but the file name is built here and so is checked here. */
function safe(runId: string): string {
  return runId.replace(/[^A-Za-z0-9_-]/g, '_');
}
