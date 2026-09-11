import { getSandbox, isPlatformTransientError, type Sandbox } from '@cloudflare/sandbox';
import { FactoryError } from '@factory/shared';
import type { ContainerHost, ContainerSpec, ExecResult } from './host';
import { commandLine, outerTimeoutMs, WORK_USER } from './hosted-command';
import { quoteOne } from './shell';

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

/** Capacity refusals clear in seconds. FR-024 bounds how long we wait. */
const CAPACITY_RETRY_MS = 30_000;

type SandboxNamespace = DurableObjectNamespace<Sandbox<unknown>>;

/**
 * A host bound to one Durable Object namespace.
 *
 * A factory rather than a constant, because the namespace arrives on a Worker's
 * `env` per request and there is no module scope to read it from. `hostFor`
 * therefore takes a thunk that calls this, so nothing outside `worker.ts` has
 * to import the SDK — see the note in `hosts.ts`.
 */
export function hostedHost(namespace: SandboxNamespace): ContainerHost {
  const open = (containerId: string) =>
    getSandbox(namespace, containerId, { sleepAfter: SLEEP_AFTER });

  return {
    async create(spec: ContainerSpec): Promise<string> {
      // The identifier is ours to mint, and it addresses the Durable Object for
      // the life of the run — the caller persists it, so every later request
      // reaches the same sandbox and the same workspace (FR-006).
      const containerId = crypto.randomUUID();
      const sandbox = open(containerId);

      await withCapacityRetry(async () => {
        // Credentials reach the sandbox as environment and never as files
        // (FR-016, Principle V).
        await sandbox.setEnvVars(spec.env);
        // Proves the container is actually up before anything depends on it,
        // and is where a capacity refusal surfaces.
        await sandbox.exec('true', { timeout: 60_000 });
      });

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
        return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr };
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
 * Retries a capacity refusal over a bounded period, then gives up (FR-024,
 * FR-024a, C8).
 *
 * Only the platform's transient refusal is retried. The spike surfaced two
 * failures that read alike and are not: "there is no container instance that
 * can be provided to this Durable Object" is transient and clears in seconds,
 * while "maximum number of running container instances exceeded … configuring a
 * higher value for max_instances" is a configuration mistake that will never
 * clear — and which the SDK already burns ~140 s retrying on its own. Retrying
 * that again would spend a run's patience on something only a deploy can fix.
 */
async function withCapacityRetry<T>(work: () => Promise<T>): Promise<T> {
  const deadline = Date.now() + CAPACITY_RETRY_MS;
  let delay = 1_000;
  for (;;) {
    try {
      return await work();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/max_instances/i.test(message)) {
        throw new FactoryError(
          'sandbox_lost',
          'the execution host refused a sandbox because its per-class instance limit is ' +
            'reached — this is a deployment setting and will not clear on its own',
          { detail: message },
        );
      }
      if (!isPlatformTransientError(error) || Date.now() + delay >= deadline) {
        throw new FactoryError('sandbox_lost', 'the execution host had no capacity for a sandbox', {
          detail: message,
        });
      }
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay *= 2;
    }
  }
}

/** Anything the SDK throws, as something `runs.ts` can branch on. */
function asFactoryError(error: unknown, message: string): FactoryError {
  if (error instanceof FactoryError) return error;
  return new FactoryError('sandbox_lost', message, {
    detail: error instanceof Error ? error.message : String(error),
  });
}
