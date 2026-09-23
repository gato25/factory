import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { log as runnerLog } from '../errors';
import { PRIVATE_DIR, PRIVATE_FILE } from './state';

/**
 * Two things checked before this service takes a single request, because
 * discovering either later costs runs.
 *
 * THE STATE DIRECTORY MUST BE WRITABLE. Every change of a run's position is
 * a file written here; on a full disk or a read-only volume every `save`
 * throws, the loop turns that into a failed run, and the failure says
 * nothing about disk. One file written and removed at startup finds that
 * out while nothing is running.
 *
 * ONE RUNNER PER STATE DIRECTORY. The loop's position is a file, and two
 * processes reading and writing the same files drive every run twice —
 * silently, each believing itself alone. A lock file with a heartbeat says
 * who holds the directory; a second runner finding a fresh one refuses to
 * start and names the first. A stale one — a runner that died without
 * releasing it — is taken over, because refusing to start behind a corpse
 * would be worse than starting.
 */

export interface InstanceLock {
  /** Stops the heartbeat and removes the file. Idempotent. */
  release(): Promise<void>;
  /** The file's path, for a message. */
  path: string;
}

interface LockRecord {
  pid: number;
  hostname: string;
  startedAt: string;
  heartbeatAt: string;
}

export const LOCK_FILE = 'runner.lock';
/** A heartbeat older than this belongs to a runner that is gone. */
export const LOCK_STALE_MS = 2 * 60_000;
export const LOCK_HEARTBEAT_MS = 30_000;

/** Throws, naming the directory, when a file cannot be written there. */
export async function assertWritable(dir: string): Promise<void> {
  const probe = join(dir, `.write-probe-${process.pid}`);
  try {
    await mkdir(dir, { recursive: true, mode: PRIVATE_DIR });
    await writeFile(probe, new Date().toISOString(), { mode: PRIVATE_FILE });
    await rm(probe, { force: true });
  } catch (error) {
    throw new Error(
      `runner: the state directory ${dir} is not writable, and every run's position is written there: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

export interface LockOptions {
  now?: () => number;
  pid?: number;
  host?: string;
  staleMs?: number;
  heartbeatMs?: number;
  /** Whether a process on THIS machine is alive; a test says. */
  isAlive?: (pid: number) => boolean;
  log?: Pick<typeof runnerLog, 'warn'>;
}

/** Whether a process on this machine exists, asked with the null signal. */
export function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means it exists and is somebody else's: alive.
    return (error as { code?: string }).code === 'EPERM';
  }
}

/**
 * Takes the directory's lock, or throws naming the runner that holds it.
 */
export async function acquireInstanceLock(
  dir: string,
  options: LockOptions = {},
): Promise<InstanceLock> {
  const now = options.now ?? Date.now;
  const pid = options.pid ?? process.pid;
  const host = options.host ?? hostname();
  const staleMs = options.staleMs ?? LOCK_STALE_MS;
  const heartbeatMs = options.heartbeatMs ?? LOCK_HEARTBEAT_MS;
  const isAlive = options.isAlive ?? processIsAlive;
  const log = options.log ?? runnerLog;
  const path = join(dir, LOCK_FILE);

  await mkdir(dir, { recursive: true, mode: PRIVATE_DIR });
  const existing = await readLock(path);
  if (existing) {
    const age = now() - Date.parse(existing.heartbeatAt);
    const ours = existing.pid === pid && existing.hostname === host;
    // On this machine the process itself can be asked, and a lock left by
    // one that has died is stale however fresh its heartbeat: a supervisor
    // restarting a crashed runner must not be refused by the crash's own
    // lock for the next two minutes. On another machine the heartbeat is
    // all there is to go on.
    const holderAlive =
      existing.hostname === host ? isAlive(existing.pid) : Number.isFinite(age) && age < staleMs;
    if (!ours && holderAlive) {
      throw new Error(
        `runner: another runner holds ${dir} — pid ${existing.pid} on ${existing.hostname}, ` +
          `heartbeat ${Math.round(age / 1000)}s ago. Two runners on one state directory would ` +
          'drive every run twice. Stop it first, or give this one its own FACTORY_STATE_DIR.',
      );
    }
    if (!ours) {
      log.warn('taking over a state directory whose runner is gone', {
        dir,
        previous_pid: existing.pid,
        previous_host: existing.hostname,
        last_heartbeat: existing.heartbeatAt,
      });
    }
  }

  const startedAt = new Date(now()).toISOString();
  const write = async () => {
    const record: LockRecord = {
      pid,
      hostname: host,
      startedAt,
      heartbeatAt: new Date(now()).toISOString(),
    };
    const temporary = `${path}.${pid}.tmp`;
    await writeFile(temporary, JSON.stringify(record, null, 2), { mode: PRIVATE_FILE });
    await rename(temporary, path);
  };
  await write();

  let timer: ReturnType<typeof setInterval> | null = setInterval(() => {
    void write().catch((error) =>
      log.warn('could not refresh the runner lock', {
        path,
        detail: error instanceof Error ? error.message : String(error),
      }),
    );
  }, heartbeatMs);
  (timer as unknown as { unref?: () => void }).unref?.();

  return {
    path,
    async release() {
      if (timer) clearInterval(timer);
      timer = null;
      // Only our own: a lock another runner took over after our heartbeat
      // went stale is theirs to keep.
      const current = await readLock(path);
      if (current && (current.pid !== pid || current.hostname !== host)) return;
      await rm(path, { force: true });
    },
  };
}

async function readLock(path: string): Promise<LockRecord | undefined> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as Partial<LockRecord>;
    if (typeof parsed.pid !== 'number' || typeof parsed.heartbeatAt !== 'string') return undefined;
    return {
      pid: parsed.pid,
      hostname: parsed.hostname ?? 'unknown',
      startedAt: parsed.startedAt ?? parsed.heartbeatAt,
      heartbeatAt: parsed.heartbeatAt,
    };
  } catch {
    return undefined;
  }
}
