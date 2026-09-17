import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { FactoryError } from '@factory/shared';
import { TIMEOUT_EXIT_CODE } from '../engines/limits';
import {
  type ContainerHost,
  type ContainerSpec,
  drain,
  type ExecOptions,
  type ExecResult,
} from './host';
import { killTree } from './process-tree';
import { quote } from './shell';
import { resolveShell } from './shell-path';
import { WORKDIR } from './start';
import { annotateUnreachable } from './unreachable';

/**
 * An execution host that runs steps as ordinary processes on this machine.
 *
 * A "sandbox" here is a fresh directory under `root`, one per run, removed
 * when the run ends. Commands run in it as child processes of the runner,
 * with the run's credentials in their environment and nothing else about the
 * run anywhere else. It is what a development machine wants: the Claude CLI,
 * git and node it already has, no image to build, no daemon, no container
 * network to reach back through.
 *
 * What it does NOT give, stated here because the constitution's sandbox
 * invariant assumes it: the process runs as whoever started the runner, not
 * as an unprivileged user; CPU and memory ceilings are recorded and not
 * enforced; and the network cannot be taken away — a run that asks for
 * isolation is refused rather than quietly given the internet. The
 * wall-clock ceiling IS enforced: a sandbox past it is removed with everything
 * it started, exactly as a container's `sleep` ending removes a container.
 *
 * `/work` — the path every module names through `WORKDIR` — is this host's
 * alias for the sandbox's own directory. The alias is resolved wherever a path
 * or a command reaches this host, so the modules above it are written once and
 * run on either host unchanged.
 */

export interface ProcessHostOptions {
  /** Where each sandbox's directory is made. Defaults to `defaultWorkRoot()`. */
  root?: string;
  now?: () => number;
  /** The environment children inherit, before the run's own is laid over it. */
  env?: NodeJS.ProcessEnv;
}

/**
 * Variables a child must never inherit from the runner's own environment.
 *
 * The run's credentials arrive in `ContainerSpec.env`, one model variable and
 * never both — and the person running the runner very likely has their own
 * key in their shell. Left in, the CLI would see two credentials and prefer
 * the wrong one, or a git token that is not this repository's. `CLAUDECODE`
 * is the marker a Claude Code session leaves in the environment of what it
 * starts, and the CLI refuses to start inside another session when it sees it.
 */
const NEVER_INHERITED = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'GIT_TOKEN',
  'GIT_ASKPASS',
  'PEN_CLI_KEY',
  'PENCIL_CLI_KEY',
  'CLAUDECODE',
  'CLAUDE_CODE_ENTRYPOINT',
];

export function defaultWorkRoot(env: NodeJS.ProcessEnv = process.env): string {
  return env.FACTORY_WORK_DIR?.trim() || join(homedir(), '.code-factory', 'runs');
}

interface Box {
  dir: string;
  env: Record<string, string>;
  deadline: number;
  timer: ReturnType<typeof setTimeout>;
  live: Set<ReturnType<typeof Bun.spawn>>;
}

export function processHost(options: ProcessHostOptions = {}): ContainerHost & { root: string } {
  const root = options.root ?? defaultWorkRoot();
  const now = options.now ?? Date.now;
  const inherited = options.env ?? process.env;
  const boxes = new Map<string, Box>();

  /** The sandbox, or `sandbox_lost` — for a directory that is gone OR one past its ceiling. */
  function box(id: string, doing: string): Box {
    const found = boxes.get(id);
    if (!found) {
      throw new FactoryError('sandbox_lost', `the sandbox is gone, so ${doing} could not be done`, {
        detail: `no workspace ${id} under ${root}`,
      });
    }
    if (now() >= found.deadline) {
      void destroy(id);
      throw new FactoryError(
        'sandbox_lost',
        `the sandbox reached its lifetime ceiling, so ${doing} could not be done`,
      );
    }
    return found;
  }

  /** `/work/x` → the sandbox's own `x`; anything else is a path on this machine. */
  function mapPath(b: Box, path: string): string {
    if (path === WORKDIR) return b.dir;
    if (path.startsWith(`${WORKDIR}/`)) return join(b.dir, path.slice(WORKDIR.length + 1));
    return path;
  }

  /** The alias resolved inside a command's text, so `mkdir -p /work/.claude` means this sandbox. */
  function rewrite(b: Box, text: string): string {
    const posix = b.dir.replaceAll('\\', '/');
    return text.replace(/\/work(?=[/'"\s]|$)/g, posix);
  }

  function childEnv(b: Box, extra?: Record<string, string>): Record<string, string> {
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(inherited)) {
      if (value !== undefined && !NEVER_INHERITED.includes(key)) env[key] = value;
    }
    Object.assign(env, b.env, extra ?? {});
    // Never a prompt: there is nobody at this terminal to answer git.
    env.GIT_TERMINAL_PROMPT = '0';
    env.FACTORY_WORKDIR = b.dir;
    return env;
  }

  /**
   * The command as this machine can run it.
   *
   * On Windows every command goes through the POSIX shell — `mkdir`, `git`,
   * the `.cmd` shim for `pen` — because that shell is where those names
   * resolve. The arguments travel INSIDE the script, quoted the POSIX way by
   * `quote`, not as positional parameters after it: the shell's runtime
   * re-parses its command line and splits a positional argument at a newline,
   * so `exec "$0" "$@"` delivered an agent's multi-line prompt as several
   * arguments. A newline inside the `-c` script arrives intact, and inside
   * single quotes the shell interprets nothing at all.
   */
  function command(argv: string[]): string[] {
    if (process.platform !== 'win32') return argv;
    const shell = resolveShell(inherited);
    const [first, ...rest] = argv;
    if (first === 'sh' || first === 'bash') return [shell, ...rest];
    return [shell, '-c', quote(argv)];
  }

  async function destroy(id: string): Promise<void> {
    const b = boxes.get(id);
    if (!b) return;
    boxes.delete(id);
    clearTimeout(b.timer);
    for (const proc of b.live) killTree(proc.pid);
    // Give what was killed a moment to let go of its files, then remove the
    // directory — with patience, because on Windows a file a dying process
    // still holds refuses to be deleted for a little while after the kill.
    await Promise.race([
      Promise.allSettled([...b.live].map((proc) => proc.exited)),
      Bun.sleep(5_000),
    ]);
    for (let attempt = 0; attempt < 8; attempt++) {
      try {
        await rm(b.dir, { recursive: true, force: true });
        return;
      } catch {
        await Bun.sleep(250 * (attempt + 1));
      }
    }
  }

  const host: ContainerHost & { root: string } = {
    root,
    isolates: false,

    async create(spec: ContainerSpec): Promise<string> {
      if (!spec.network) {
        throw new FactoryError(
          'invalid_input',
          'A run on this machine cannot be cut off from the network: it runs as ordinary ' +
            'processes, not in a container. Turn on “Let a sandbox reach the network while ' +
            'code is being written” in Settings, or set EXECUTION_HOST=docker on the runner.',
        );
      }
      const id = `ws-${crypto.randomUUID().slice(0, 8)}`;
      const dir = join(root, id);
      try {
        await mkdir(dir, { recursive: true });
      } catch (error) {
        throw new FactoryError('sandbox_lost', 'could not create the sandbox', {
          detail: `${dir}: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
      const ms = spec.wallClockMinutes * 60_000;
      const timer = setTimeout(() => void destroy(id), ms);
      // The runner must not be kept alive by a ceiling nobody is waiting on.
      (timer as { unref?: () => void }).unref?.();
      boxes.set(id, { dir, env: { ...spec.env }, deadline: now() + ms, timer, live: new Set() });
      return id;
    },

    async exec(id: string, argv: string[], options?: ExecOptions): Promise<ExecResult> {
      const b = box(id, 'running a command');
      const proc = Bun.spawn(command(argv.map((argument) => rewrite(b, argument))), {
        cwd: options?.cwd ? mapPath(b, options.cwd) : b.dir,
        env: childEnv(b, options?.env),
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
      });
      b.live.add(proc);

      let killedAtDeadline = false;
      const deadline = options?.timeoutMs
        ? setTimeout(() => {
            killedAtDeadline = true;
            killTree(proc.pid);
          }, options.timeoutMs)
        : null;

      try {
        const [stdout, stderr] = await Promise.all([
          drain(proc.stdout, (text) => options?.onOutput?.('stdout', text)),
          drain(proc.stderr, (text) => options?.onOutput?.('stderr', text)),
        ]);
        const exitCode = await proc.exited;
        const result: ExecResult = killedAtDeadline
          ? {
              exitCode: TIMEOUT_EXIT_CODE,
              stdout,
              stderr: `${stderr}\nstopped after ${options?.timeoutMs}ms`.trim(),
            }
          : { exitCode, stdout, stderr };
        return result.exitCode === 0
          ? result
          : { ...result, stderr: annotateUnreachable(result.stderr, result.stdout) };
      } finally {
        if (deadline) clearTimeout(deadline);
        b.live.delete(proc);
      }
    },

    async writeFile(id, path, content) {
      const b = box(id, `writing ${path}`);
      const target = mapPath(b, path);
      try {
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, content);
      } catch (error) {
        throw new FactoryError('sandbox_lost', `could not write ${path}`, {
          detail: error instanceof Error ? error.message : String(error),
        });
      }
    },

    async readFile(id, path) {
      const b = box(id, `reading ${path}`);
      try {
        return await readFile(mapPath(b, path), 'utf8');
      } catch (error) {
        // Absent — or a directory, which is not a document either.
        if (isAbsent(error)) return null;
        throw error;
      }
    },

    async stat(id, path) {
      const b = box(id, `looking for ${path}`);
      try {
        const info = await stat(mapPath(b, path));
        return info.isFile() ? { size: info.size } : null;
      } catch (error) {
        if (isAbsent(error)) return null;
        throw error;
      }
    },

    async address() {
      // Nothing is published: a process listens where it listens, and a
      // launch — which needs a port of its own — is given to the Docker host.
      return null;
    },

    async disconnectNetwork() {
      throw new FactoryError(
        'invalid_input',
        'A run on this machine cannot be cut off from the network. Turn on “Let a sandbox ' +
          'reach the network while code is being written” in Settings, or set ' +
          'EXECUTION_HOST=docker on the runner.',
      );
    },

    destroy,
  };
  return host;
}

function isAbsent(error: unknown): boolean {
  const code = (error as { code?: string })?.code;
  return code === 'ENOENT' || code === 'ENOTDIR' || code === 'EISDIR';
}
