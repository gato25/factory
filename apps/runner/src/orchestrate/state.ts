import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { PipelineSnapshot, RunFacts } from '@factory/shared';
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
 * One JSON file per run under `dir`. Written whole on every change, through a
 * temporary name, so a runner that dies mid-write leaves the previous state
 * rather than half a file.
 */
export function fileStateStore(dir: string): StateStore {
  const pathFor = (runId: string) => join(dir, `${safe(runId)}.json`);
  return {
    async get(runId) {
      try {
        return JSON.parse(await readFile(pathFor(runId), 'utf8')) as LoopState;
      } catch {
        return undefined;
      }
    },
    async set(state) {
      await mkdir(dir, { recursive: true });
      const target = pathFor(state.runId);
      const temporary = `${target}.tmp`;
      await writeFile(temporary, JSON.stringify(state, null, 2));
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
