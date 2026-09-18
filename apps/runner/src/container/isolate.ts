import type { SnapshotAgent } from '@factory/shared';
import { TIMEOUT_EXIT_CODE } from '../engines/limits';
import {
  type ContainerHost,
  type ContainerSpec,
  type ExecOptions,
  type ExecResult,
  run,
} from './host';
import { quote } from './shell';
import { WORKDIR } from './start';

/**
 * A container around the steps that need one, over the workspace the rest of
 * the run already uses.
 *
 * Docker was taken out of development because it cost more than it gave: an
 * image to keep built, a daemon to keep running, Windows paths to translate,
 * and installs slow enough to notice — on every step, including the three
 * that only read the repository and write Markdown. Then an agent tidying up
 * after a dev server it had started ran `Get-Process -Name bun |
 * Stop-Process`, which on a developer's machine names the runner supervising
 * it, and the run died four steps in.
 *
 * Both of those are true at once, and the resolution is that the steps are
 * not alike. Specification, Tasks and Design read files and write files. What
 * they can do wrong is bounded by what they can do at all, and they stay
 * where they are: ordinary processes, no daemon, no image, fast. A step whose
 * agent may run SHELL COMMANDS is a different thing, because a shell command
 * is not bounded by anything, and that is the step this puts in a container.
 *
 * The workspace does not move. It is a directory on the machine, made by the
 * process host and handed between steps by being the same directory (the
 * constitution's hand-off invariant); an isolated step gets a fresh container
 * with that directory bind-mounted at `/work`, runs there, and the container
 * is discarded. So the container is per step and the workspace is per run,
 * and a step that runs in one still reads what the step before it wrote.
 *
 * What this does NOT claim to be is the hosted configuration. There the whole
 * run lives in a container it never leaves, which is what `EXECUTION_HOST=docker`
 * still selects and what a deployment MUST use. This is the development
 * machine's compromise: the walls where the risk is, and nowhere else.
 */

/**
 * Tools that can reach past the workspace, so a step permitted any of them
 * runs behind a wall rather than a rule.
 *
 * A shell is the whole list, under both the names a shell is offered by:
 * `Bash` where the CLI runs on a POSIX machine, `PowerShell` where it runs on
 * Windows. `Read`, `Write` and `Edit` act on paths, and a path is held inside
 * the workspace by the working directory; a command is held by nothing, which
 * is the entire point of having one.
 */
const REACHES_OUT = ['Bash', 'PowerShell'];

/**
 * Whether this agent's step should run in a container.
 *
 * Read off the agent's permitted tools rather than the step's name or
 * position, because the name is a label somebody typed and the permission is
 * the thing that actually decides what the step can do. With the default
 * agents this selects Plan, which is permitted a shell to read the repository
 * with, and Implement, which is permitted one to build with.
 */
export function needsIsolation(agent: SnapshotAgent): boolean {
  return agent.allowed_tools.some((tool) => REACHES_OUT.includes(tool));
}

export interface IsolatingHostOptions {
  /** The host that owns the workspace directory; the container mounts it. */
  base: ContainerHost & { root: string };
  /** The image a step's container is made from. */
  image: string;
  /** Injected by a test that must not start a container. */
  exec?: typeof run;
}

/**
 * The base host, plus the ability to run one command in a container over the
 * same workspace.
 *
 * Everything else — creating the workspace, reading and writing files in it,
 * its lifetime ceiling, destroying it — stays with the base host, because the
 * workspace is the base host's. Only `execIsolated` is new, and only the
 * agent steps that need it call it.
 */
export function isolatingHost(options: IsolatingHostOptions): ContainerHost & { root: string } {
  const { base, image } = options;
  const exec = options.exec ?? run;
  // The run's own spec: its credentials, and the ceilings the container is
  // given. Kept here because the base host holds its copy privately, and
  // repopulated by `adopt` so a run that outlived a restart can still be
  // isolated.
  const specs = new Map<string, ContainerSpec>();
  let sequence = 0;

  return {
    ...base,
    // Unchanged and deliberately so: the base host still cannot take a
    // workspace off the network, because the workspace is still a directory
    // on this machine. Only the command runs behind a wall.
    isolates: base.isolates,
    shell: base.shell,

    async create(spec) {
      const id = await base.create(spec);
      specs.set(id, spec);
      return id;
    },

    async adopt(id, spec) {
      await base.adopt?.(id, spec);
      specs.set(id, spec);
    },

    async destroy(id) {
      specs.delete(id);
      await base.destroy(id);
    },

    async execIsolated(id: string, argv: string[], opts?: ExecOptions): Promise<ExecResult> {
      const spec = specs.get(id);
      if (!spec) {
        // Nothing is silently run unwalled: the caller asked for isolation,
        // and a step that cannot have it is a step that should say so.
        return {
          exitCode: 1,
          stdout: '',
          stderr: `no sandbox ${id} is registered, so its command could not be isolated`,
        };
      }

      // A name rather than only `--rm`, because a command stopped at its
      // deadline kills the client and leaves the container running. The name
      // is what lets it be found and removed.
      sequence += 1;
      const name = `factory-${id}-${sequence}`;
      const source = mountSource(base.root, id);

      const script = [
        // The repository is on a bind mount, so its files are owned by
        // somebody the container has never heard of and git refuses to touch
        // it. Granting the exception is what makes `git status` and every
        // commit inside a step work at all.
        `git config --global --add safe.directory ${WORKDIR} >/dev/null 2>&1`,
        // The same decision `config.ts` makes for the workspace, made again
        // here because it does not travel: that one marks the trust in the
        // home directory of whoever runs the runner, and the CLI in here runs
        // as another user, in another home, which the CLI would find empty
        // and then quietly ignore everything the repository's own settings
        // grant. Written rather than merged because this home is one step
        // old and holds nothing to preserve.
        `mkdir -p "$HOME" >/dev/null 2>&1`,
        `printf '{"projects":{"%s":{"hasTrustDialogAccepted":true}}}' ${WORKDIR} > "$HOME/.claude.json" 2>/dev/null || true`,
        quote(argv),
      ].join('; ');

      const result = await exec(
        'docker',
        [
          'run',
          '--rm',
          '--name',
          name,
          // An agent runs arbitrary code against a customer repository
          // (FR-046). The image's workspace is owned by this id.
          '--user',
          '1000:1000',
          '--cpus',
          String(spec.cpu),
          '--memory',
          `${spec.memoryMb}m`,
          '--volume',
          `${source}:${WORKDIR}`,
          '--workdir',
          opts?.cwd ?? WORKDIR,
          ...Object.keys(spec.env).flatMap((key) => ['--env', key]),
          ...Object.keys(opts?.env ?? {}).flatMap((key) => ['--env', key]),
          image,
          'sh',
          '-c',
          script,
        ],
        {
          env: { ...spec.env, ...opts?.env },
          timeoutMs: opts?.timeoutMs,
          onOutput: opts?.onOutput,
        },
      );

      // The deadline killed the client; the container is still working, and
      // still spending, until it is removed.
      if (result.exitCode === TIMEOUT_EXIT_CODE) {
        await exec('docker', ['rm', '--force', name], { timeoutMs: 30_000 }).catch(() => {});
      }
      return result;
    },
  };
}

/**
 * The workspace as the Docker daemon must be told to find it.
 *
 * Forward slashes on Windows: the daemon accepts `C:/Users/...` and reads
 * `C:\Users\...` ambiguously depending on what parsed the argument first.
 */
export function mountSource(root: string, id: string): string {
  const joined = `${root.replace(/[\\/]+$/, '')}/${id}`;
  return joined.replaceAll('\\', '/');
}
