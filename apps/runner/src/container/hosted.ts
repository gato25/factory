import { getSandbox, isPlatformTransientError, type Sandbox } from '@cloudflare/sandbox';
import { FactoryError } from '@factory/shared';
import { withCapacityRetry } from './capacity';
import type { ContainerHost, ContainerSpec, ExecResult } from './host';
import { commandLine, outerTimeoutMs, WORK_USER } from './hosted-command';
import { quoteOne } from './shell';
import { chooseSize, sandboxId, sizeOf } from './sizes';
import { annotateUnreachable } from './unreachable';

/**
 * The managed sandbox host: the same six methods as `dockerHost`, against a
 * sandbox service instead of a daemon (specs/002-hosted-runner-sandboxes, D2).
 *
 * Everything here is shaped by what the spike measured rather than by what the
 * documentation promised, which turned out to matter three times over:
 *
 * - Commands run as an unprivileged user by way of `setpriv`, because the SDK's
 *   `exec` has no user field and the image's entrypoint is a root control
 *   server. T005 proved both `setpriv` and `su` work; `setpriv` is preferred for
 *   making no TTY assumptions and going nowhere near PAM.
 * - A step's deadline is enforced by `timeout` INSIDE the sandbox, not by the
 *   SDK's own `timeout`. That is what makes FR-014a true: the clock starts when
 *   the command starts, so the seconds a cold container spends becoming ready
 *   are never charged to the step. `timeout(1)` exits 124, which is already
 *   `TIMEOUT_EXIT_CODE`.
 * - There is no per-host network filtering. The allow and deny lists govern
 *   only traffic routed through the SDK's proxy, not sockets a process opens for
 *   itself, so `spec.network` cannot be honoured here and FR-011a requires the
 *   setting to say so rather than be quietly ignored. This host therefore reads
 *   `spec.network` and does nothing with it — deliberately, and noted so that
 *   nobody later reads the omission as an oversight.
 */

/**
 * How long a sandbox may idle before the platform sleeps it.
 *
 * Generous on purpose: a run parked at a human approval checkpoint still holds
 * its sandbox, and the constitution's invariant is that the sandbox lives for
 * the run. The wall-clock alarm is what ends it (D5), not this.
 */
const SLEEP_AFTER = '30m';

type SandboxNamespace = DurableObjectNamespace<Sandbox<unknown>>;

/**
 * One namespace per offered size, keyed by size name (D4).
 *
 * Processing power and memory are deploy-time configuration here, so a
 * deployment declares a container binding per size and a run is routed to one.
 * Which one a sandbox belongs to travels in its identifier, because `exec`,
 * `readFile`, `stat` and `destroy` are given nothing else — see `sandboxId`.
 */
export type SandboxNamespaces = Readonly<Record<string, SandboxNamespace>>;

/**
 * A host bound to one Durable Object namespace.
 *
 * A factory rather than a constant, because the namespace arrives on a Worker's
 * `env` per request and there is no module scope to read it from. `hostFor`
 * therefore takes a thunk that calls this, so nothing outside `worker.ts` has
 * to import the SDK — see the note in `hosts.ts`.
 */
export function hostedHost(namespaces: SandboxNamespaces | SandboxNamespace): ContainerHost {
  /**
   * The namespace a sandbox identifier belongs to.
   *
   * A single namespace is still accepted, and that is not just convenience:
   * it is how a run started before the sized bindings existed still reaches
   * its sandbox, and how the alarm in `worker.ts` releases one without
   * needing to know which size it was.
   */
  const namespaceFor = (containerId: string): SandboxNamespace => {
    if (isSingleNamespace(namespaces)) return namespaces;
    const size = sizeOf(containerId);
    const chosen = size ? namespaces[size.name] : undefined;
    if (!chosen) {
      // Every size in OFFERED_SIZES must have a binding, so this is a
      // deployment mistake rather than a run's problem — said plainly, because
      // the alternative presents as a sandbox that vanished.
      throw new FactoryError(
        'sandbox_lost',
        `this deployment declares no sandbox binding for '${containerId.split('.')[0]}', so that ` +
          "run's sandbox cannot be reached — every size in sizes.ts needs a container binding",
      );
    }
    return chosen;
  };

  const open = (containerId: string) =>
    getSandbox(namespaceFor(containerId), containerId, { sleepAfter: SLEEP_AFTER });

  return {
    async create(spec: ContainerSpec): Promise<string> {
      // Routed to the largest offered size that fits WITHIN the workspace's
      // ceilings, which is what makes those ceilings upper bounds rather than
      // targets (FR-005, FR-009). Throws here, before anything is created,
      // when nothing fits — naming the ceiling that ruled it out.
      const size = chooseSize({ cpu: spec.cpu, memoryMb: spec.memoryMb });

      // The identifier is ours to mint, and it addresses the Durable Object for
      // the life of the run — the caller persists it, so every later request
      // reaches the same sandbox and the same workspace (FR-006). It carries
      // the size because nothing else will be given to the methods that need
      // it.
      const containerId = sandboxId(size, crypto.randomUUID());
      const sandbox = open(containerId);

      await withCapacityRetry(
        async () => {
          // Credentials reach the sandbox as environment and never as files
          // (FR-016, Principle V).
          await sandbox.setEnvVars(spec.env);
          // Proves the container is actually up before anything depends on it,
          // and is where a capacity refusal surfaces.
          await sandbox.exec('true', { timeout: 60_000 });
          // The SDK's own predicate, which knows shapes we would be guessing
          // at. Passing it in is also what keeps the retry logic testable —
          // nothing in this file can be reached from a test.
        },
        { isTransient: isPlatformTransientError },
      );

      try {
        // The workspace belongs to the user the work runs as. `chown` is
        // needed because the control server creates it as root, and a step
        // that cannot write its own workspace is useless (T005).
        const prepared = await sandbox.exec(
          `mkdir -p ${quoteOne(spec.workdir)} && chown ${WORK_USER}:${WORK_USER} ${quoteOne(spec.workdir)}`,
          { timeout: 30_000 },
        );
        if (prepared.exitCode !== 0) {
          throw new FactoryError('sandbox_lost', 'could not prepare the sandbox workspace', {
            detail: prepared.stderr.trim(),
          });
        }
        return containerId;
      } catch (error) {
        // Never leave a half-prepared sandbox behind (C9).
        await sandbox.destroy().catch(() => {});
        throw error;
      }
    },

    async exec(containerId, argv, options): Promise<ExecResult> {
      const sandbox = open(containerId);
      try {
        const result = await sandbox.exec(commandLine(argv, options), {
          ...(options?.cwd ? { cwd: options.cwd } : {}),
          ...(options?.env ? { env: options.env } : {}),
          // An outer bound only. The step's own deadline is enforced inside the
          // sandbox by `timeout`, so this is a safety net for a control server
          // that stops answering — generous enough never to pre-empt the inner
          // one, which is what keeps a deadline distinguishable from a hang.
          timeout: outerTimeoutMs(options?.timeoutMs),
          ...(options?.onOutput ? { stream: true as const, onOutput: options.onOutput } : {}),
        });
        return {
          exitCode: result.exitCode,
          stdout: result.stdout,
          // A failure that was really a dependency being unreachable says so,
          // naming the address (FR-013). Only on the failure path, and only
          // appended: the tooling's own message is what a developer wants, and
          // a registry that is down and a mistyped hostname look identical
          // without this line.
          stderr:
            result.exitCode === 0
              ? result.stderr
              : annotateUnreachable(result.stderr, result.stdout),
        };
      } catch (error) {
        throw asFactoryError(error, 'the sandbox stopped answering while a step was running');
      }
    },

    async writeFile(containerId, path, content): Promise<void> {
      const sandbox = open(containerId);
      try {
        const written = await sandbox.writeFile(path, content);
        if (!written.success) {
          throw new FactoryError('sandbox_lost', `could not write ${path}`);
        }
        // Written by the root control server, so it would otherwise be
        // unreadable-to-modify by the user the work runs as.
        await sandbox.exec(`chown ${WORK_USER}:${WORK_USER} ${quoteOne(path)}`, {
          timeout: 30_000,
        });
      } catch (error) {
        throw asFactoryError(error, `could not write ${path}`);
      }
    },

    async readFile(containerId, path): Promise<string | null> {
      const sandbox = open(containerId);
      try {
        const read = await sandbox.readFile(path);
        return read.success ? read.content : null;
      } catch (error) {
        // A missing document and an unreachable sandbox are different answers,
        // and only one of them is null (F2). Asking `exists` is one extra round
        // trip on the failure path only.
        const present = await sandbox
          .exists(path)
          .then((r) => r.exists)
          .catch(() => null);
        if (present === false) return null;
        throw asFactoryError(error, `could not read ${path}`);
      }
    },

    async stat(containerId, path): Promise<{ size: number } | null> {
      const sandbox = open(containerId);
      try {
        // One round trip, and the same shape `dockerHost` uses: size is what
        // distinguishes an empty document from an absent one (F3, FR-051).
        const result = await sandbox.exec(
          `test -f ${quoteOne(path)} && wc -c < ${quoteOne(path)}`,
          { timeout: 30_000 },
        );
        if (result.exitCode !== 0) return null;
        const size = Number(result.stdout.trim());
        return Number.isFinite(size) ? { size } : null;
      } catch (error) {
        throw asFactoryError(error, `could not stat ${path}`);
      }
    },

    async destroy(containerId): Promise<void> {
      // Never throws (D3). `container/recover.ts` calls this on a sandbox it
      // already believes is gone, inside a `.catch(() => {})`, and a host that
      // threw here would mask the original failure.
      await open(containerId)
        .destroy()
        .catch(() => {});
    },
  };
}

/**
 * Whether a single namespace was passed rather than a map of them.
 *
 * A `DurableObjectNamespace` has methods; a record of them does not. Checked by
 * shape rather than by a flag, so a caller cannot pass the wrong thing and have
 * it silently treated as the other.
 */
function isSingleNamespace(value: SandboxNamespaces | SandboxNamespace): value is SandboxNamespace {
  return typeof (value as SandboxNamespace).idFromName === 'function';
}

/** Anything the SDK throws, as something `runs.ts` can branch on. */
function asFactoryError(error: unknown, message: string): FactoryError {
  if (error instanceof FactoryError) return error;
  return new FactoryError('sandbox_lost', message, {
    detail: error instanceof Error ? error.message : String(error),
  });
}
