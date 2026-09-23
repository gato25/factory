import { log as runnerLog } from '../errors';
import { type ExecResult, run } from './host';
import { KIND_LABEL, LAUNCH_LABEL, OWNED_FILTER, RUN_LABEL, RUNNER_LABEL } from './labels';

/**
 * Removes the containers this service made that have stopped.
 *
 * A sandbox is removed when its run ends (`destroyRun`), and one created
 * now removes itself when its `sleep` ends (`--rm`). What neither covers is
 * what a crash leaves: a runner that died between `docker run` and writing
 * the id down, a sandbox made by an earlier version of this service without
 * `--rm`, a launch whose runner restarted and forgot it. Those run out their
 * wall-clock ceiling on their own — the ceiling is the daemon's `sleep`, not
 * this service's timer (002 FR-010) — and then sit, exited, holding their
 * writable layer on disk with nothing left to release them.
 *
 * So: every container carrying this service's label that is no longer
 * running is removed, at startup and then on a timer. Only stopped ones. A
 * container that is still running may be a retained failed sandbox somebody
 * is inspecting (FR-023), or a run this restarted service has not adopted
 * yet; its own ceiling bounds it, and it becomes this sweep's the moment it
 * stops. Nothing here decides that a running sandbox is unwanted.
 */

export interface ReapDeps {
  /** Injected by tests, which must not need a daemon. */
  exec?: (command: string, argv: string[], options?: { timeoutMs?: number }) => Promise<ExecResult>;
  log?: Pick<typeof runnerLog, 'info' | 'warn'>;
}

export interface Reaped {
  id: string;
  kind: string;
  /** The run or launch it belonged to, when the label says. */
  of: string;
  status: string;
}

/** The fields asked of `docker ps`, tab-separated so a status with spaces survives. */
const FORMAT = [
  '{{.ID}}',
  `{{.Label "${KIND_LABEL}"}}`,
  `{{.Label "${RUN_LABEL}"}}{{.Label "${LAUNCH_LABEL}"}}`,
  '{{.Status}}',
].join('\t');

export async function reapStoppedContainers(
  deps: ReapDeps = {},
): Promise<{ removed: Reaped[]; failed: Reaped[] }> {
  const exec = deps.exec ?? run;
  const log = deps.log ?? runnerLog;
  const listed = await exec(
    'docker',
    [
      'ps',
      '--all',
      '--no-trunc',
      '--filter',
      OWNED_FILTER,
      '--filter',
      'status=exited',
      '--filter',
      'status=dead',
      '--format',
      FORMAT,
    ],
    { timeoutMs: 15_000 },
  ).catch(
    (error): ExecResult => ({
      exitCode: 1,
      stdout: '',
      stderr: error instanceof Error ? error.message : String(error),
    }),
  );
  if (listed.exitCode !== 0) {
    // No daemon, or one that would not answer: nothing to reap from, and the
    // watch on the host is what says so. Not this sweep's news to repeat.
    return { removed: [], failed: [] };
  }

  const stopped = parseListing(listed.stdout);
  const removed: Reaped[] = [];
  const failed: Reaped[] = [];
  for (const container of stopped) {
    // `--volumes` takes the anonymous volumes with it; a sandbox has no
    // named ones, so nothing anybody kept on purpose is touched.
    const result = await exec('docker', ['rm', '--force', '--volumes', container.id], {
      timeoutMs: 30_000,
    }).catch(
      (error): ExecResult => ({
        exitCode: 1,
        stdout: '',
        stderr: error instanceof Error ? error.message : String(error),
      }),
    );
    (result.exitCode === 0 ? removed : failed).push(container);
  }
  if (removed.length > 0) {
    log.info('removed stopped sandboxes nothing was going to release', {
      count: removed.length,
      containers: removed.map((c) => `${c.kind} ${c.of} (${c.id.slice(0, 12)}, ${c.status})`),
    });
  }
  if (failed.length > 0) {
    log.warn('some stopped sandboxes could not be removed', {
      count: failed.length,
      containers: failed.map((c) => `${c.kind} ${c.of} (${c.id.slice(0, 12)})`),
    });
  }
  return { removed, failed };
}

/** One `Reaped` per line of the listing; a line that is not four fields is not one. */
export function parseListing(stdout: string): Reaped[] {
  return stdout
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .flatMap((line) => {
      const [id, kind, of, status] = line.split('\t');
      if (!id || status === undefined) return [];
      return [{ id, kind: kind || 'unknown', of: of || 'unknown', status }];
    });
}

/**
 * Removes the launch containers this runner made and no longer knows about.
 *
 * A launch lives in memory only — the ticket's branch, started for somebody
 * to look at, stopped when they stop looking (003 FR-011). A restart forgets
 * every one of them, and a forgotten launch is provably useless: nothing can
 * show it, stop it, or reach it by its address any more, yet it keeps its
 * port and its CPU until its own `sleep` ends. So at startup the running
 * launch containers that carry THIS runner's identity and are not in the
 * store are removed. Another runner's, on the same daemon, are not touched;
 * neither is any run's sandbox — a running one of those may be retained for
 * diagnosis, and is `recover`'s to adopt.
 */
export async function reapForgottenLaunches(options: {
  /** This runner's identity, as `labels.ts` marks containers with it. */
  runner: string;
  /** The launches this runner knows about. */
  known: Set<string>;
  exec?: ReapDeps['exec'];
  log?: ReapDeps['log'];
}): Promise<{ removed: Reaped[]; failed: Reaped[] }> {
  const exec = options.exec ?? run;
  const log = options.log ?? runnerLog;
  const listed = await exec(
    'docker',
    [
      'ps',
      '--no-trunc',
      '--filter',
      OWNED_FILTER,
      '--filter',
      `label=${KIND_LABEL}=launch`,
      '--filter',
      `label=${RUNNER_LABEL}=${options.runner}`,
      '--format',
      FORMAT,
    ],
    { timeoutMs: 15_000 },
  ).catch(
    (error): ExecResult => ({
      exitCode: 1,
      stdout: '',
      stderr: error instanceof Error ? error.message : String(error),
    }),
  );
  if (listed.exitCode !== 0) return { removed: [], failed: [] };

  const removed: Reaped[] = [];
  const failed: Reaped[] = [];
  for (const container of parseListing(listed.stdout)) {
    if (options.known.has(container.of)) continue;
    const result = await exec('docker', ['rm', '--force', '--volumes', container.id], {
      timeoutMs: 30_000,
    }).catch(
      (error): ExecResult => ({
        exitCode: 1,
        stdout: '',
        stderr: error instanceof Error ? error.message : String(error),
      }),
    );
    (result.exitCode === 0 ? removed : failed).push(container);
  }
  if (removed.length > 0) {
    log.info('stopped launches a restart had forgotten', {
      count: removed.length,
      launches: removed.map((c) => `${c.of} (${c.id.slice(0, 12)})`),
    });
  }
  if (failed.length > 0) {
    log.warn('some forgotten launches could not be stopped', {
      count: failed.length,
      launches: failed.map((c) => `${c.of} (${c.id.slice(0, 12)})`),
    });
  }
  return { removed, failed };
}
