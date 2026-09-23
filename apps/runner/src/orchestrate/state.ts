import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Callback, PipelineSnapshot, RunFacts } from '@factory/shared';
import type { SandboxLimits } from '../container/start';

/**
 * Where a run is in its pipeline, written down.
 *
 * The orchestrator used to be a separate service holding each run in one
 * long execution, and when that execution died the run was stuck as
 * `running` with nothing driving it. Here the loop's position is state, and
 * the state is a file: the step to consider next, the facts established so
 * far, the cost spent, what a checkpoint is waiting for. A runner that
 * restarts reads these files and carries on — a step that was in flight runs
 * again, a wait keeps waiting.
 *
 * Never a credential. Those come from the application when needed, exactly
 * as they did before (FR-083); what is on disk is what the application
 * already knows about the run, and nothing an outsider could spend.
 */

export type Phase =
  | 'starting'
  | 'stepping'
  | 'waiting_approval'
  | 'paused'
  | 'finishing'
  | 'finished'
  | 'failed'
  | 'cancelled';

/**
 * A step's outcome that the application has not yet been told.
 *
 * The expensive part of a step is the work; the report is one request. When
 * that request could not be delivered — the application down for a deploy at
 * the moment an Implement step finished — the loop used to fail the run
 * after a few seconds of trying, and a restart in that window re-ran the
 * whole step, because the position on disk still said the step was ahead.
 * So the outcome is written here BEFORE it is sent, and a runner that picks
 * the run up delivers this first and re-runs nothing. A duplicate delivery
 * is a no-op to the application (FR-095), which is what makes writing it
 * before sending it safe.
 */
export interface PendingDelivery {
  /** The callback, complete, as it will be posted. */
  callback: Callback;
  since: string;
  /**
   * What follows delivery: the run goes on; it fails as the step did; or —
   * for a `failed`/`cancelled` callback — the sandbox is released and the
   * run forgotten. The terminal case is here for the same reason the step
   * case is: `fail()` used to post its callback (retried for a quarter of an
   * hour) and only THEN release the sandbox, and a restart in that window
   * found a state marked failed and simply deleted it — sandbox never
   * released, application never told.
   */
  after:
    | { outcome: 'done' }
    | { outcome: 'failed'; reason: string; detail: string }
    | { outcome: 'terminal'; destroy: 'failed' | 'cancelled' };
}

export interface LoopState {
  runId: string;
  snapshot: PipelineSnapshot;
  sandbox: SandboxLimits;
  /** The sandbox this run has, once it has one; kept so a restart can adopt it. */
  containerId?: string;
  /** The step to consider next. */
  index: number;
  facts: RunFacts;
  spentUsd: number;
  /** Screens a design step exported, so later steps are told where they are (FR-109). */
  designScreens: string[];
  /** After a change request: the checkpoint to return to once the re-run step finishes. */
  returningTo: number | null;
  feedback: string | null;
  /** Set by the application's reply to a callback: nothing further begins (FR-096). */
  paused: boolean;
  phase: Phase;
  /** The step a wait belongs to. */
  waitingAt?: number;
  /** A step's outcome not yet delivered to the application; sent before anything else. */
  pending?: PendingDelivery;
  /**
   * The merge request this run opened, the moment it was opened. `finish()`
   * used to hold the address in a local across two deliveries; a restart in
   * between re-drove `finish()`, asked the provider for a second merge
   * request, and failed a completed run on the provider's refusal.
   */
  mergeRequestUrl?: string;
  startedAt: string;
  updatedAt: string;
}

export interface StateStore {
  get(runId: string): Promise<LoopState | undefined>;
  set(state: LoopState): Promise<void>;
  delete(runId: string): Promise<void>;
  all(): Promise<LoopState[]>;
}

export function memoryStateStore(): StateStore {
  const states = new Map<string, LoopState>();
  return {
    get: async (runId) => states.get(runId),
    set: async (state) => {
      states.set(state.runId, state);
    },
    delete: async (runId) => {
      states.delete(runId);
    },
    all: async () => [...states.values()],
  };
}

/**
 * The modes every file this service writes about a run gets.
 *
 * A state file carries the run's snapshot, and the snapshot carries the
 * `resume_secret` — the credential that authenticates this run's callbacks
 * and exchanges for its git token and model key. Written with the default
 * umask it was readable by every account on the machine and by anything
 * that could read the state volume. Private to the runner's own user, then:
 * the directory 0700, each file 0600, the temporary file the same before it
 * is renamed into place.
 */
export const PRIVATE_DIR = 0o700;
export const PRIVATE_FILE = 0o600;

/**
 * One JSON file per run under `dir`. Written whole on every change, through a
 * temporary name, so a runner that dies mid-write leaves the previous state
 * rather than half a file. A temporary name unique to this write, so two
 * writers for one run — the loop and a route — never share an inode and the
 * loser's rename never fails on the winner's file.
 */
export function fileStateStore(dir: string): StateStore {
  const pathFor = (runId: string) => join(dir, `${safe(runId)}.json`);
  let sequence = 0;
  return {
    async get(runId) {
      try {
        return JSON.parse(await readFile(pathFor(runId), 'utf8')) as LoopState;
      } catch {
        return undefined;
      }
    },
    async set(state) {
      await mkdir(dir, { recursive: true, mode: PRIVATE_DIR });
      const target = pathFor(state.runId);
      sequence += 1;
      const temporary = `${target}.${process.pid}.${sequence}.tmp`;
      await writeFile(temporary, JSON.stringify(state, null, 2), { mode: PRIVATE_FILE });
      // rename is atomic on the same volume; a failure leaves the old file.
      const { rename } = await import('node:fs/promises');
      await rename(temporary, target);
    },
    async delete(runId) {
      await rm(pathFor(runId), { force: true });
    },
    async all() {
      let names: string[];
      try {
        names = await readdir(dir);
      } catch {
        return [];
      }
      const states: LoopState[] = [];
      for (const name of names) {
        if (!name.endsWith('.json')) continue;
        try {
          states.push(JSON.parse(await readFile(join(dir, name), 'utf8')) as LoopState);
        } catch {
          // A file that does not parse is not a run this runner can drive.
        }
      }
      return states;
    },
  };
}

/** A run id is a UUID, but the file name is built here and so is checked here. */
function safe(runId: string): string {
  return runId.replace(/[^A-Za-z0-9_-]/g, '_');
}
