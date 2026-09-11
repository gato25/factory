import { getSandbox, Sandbox } from '@cloudflare/sandbox';

/**
 * The spike for T005, T006 and T007 — the three decisions
 * `specs/002-hosted-runner-sandboxes/research.md` documents but has never run.
 *
 * It is a Worker rather than a script because the sandbox SDK reaches a
 * sandbox through a Durable Object binding; there is nothing to run from a
 * terminal. Deploy it and call each route:
 *
 *   bunx wrangler deploy --config apps/runner/wrangler.spike.jsonc
 *   curl "$SPIKE/non-root"   # T005 / D6 / FR-003
 *   curl "$SPIKE/egress"     # T006 / D7 / FR-011, FR-012
 *   curl "$SPIKE/sizes"      # T007 / D4 / FR-005, FR-009
 *
 * Each answers JSON with what it observed and a `verdict`. Record the answers
 * in research.md under D4, D6 and D7 (that is T061) and then delete this
 * directory — a spike that survives becomes a second implementation nobody
 * maintains.
 *
 * Two container classes exist only so the size check has two bindings of
 * different declared sizes to compare. Nothing else needs them.
 */

export class SpikeSmall extends Sandbox<Env> {}
export class SpikeLarge extends Sandbox<Env> {}

interface Env {
  SPIKE_SMALL: DurableObjectNamespace<SpikeSmall>;
  SPIKE_LARGE: DurableObjectNamespace<SpikeLarge>;
}

/** Whatever the command said, with the noise trimmed. */
async function say(
  sandbox: { exec: (command: string) => Promise<{ exitCode: number; stdout: string }> },
  command: string,
): Promise<string> {
  const result = await sandbox.exec(command);
  return `${result.stdout}`.trim() || `(exit ${result.exitCode})`;
}

/**
 * T005 / D6 — does work run as somebody other than root, and can that
 * somebody write to the workspace?
 *
 * The SDK's `ExecOptions` has no user field and the published image's
 * entrypoint is a control server that is not de-privileged, so the answer
 * decides whether the constitution's non-root invariant can be met for the
 * work at all. If `whoami` says root, Complexity Tracking row 2 stops being an
 * accepted cost and becomes a blocker.
 */
async function nonRoot(env: Env): Promise<unknown> {
  const sandbox = getSandbox(env.SPIKE_SMALL, `spike-non-root-${Date.now()}`);
  try {
    const whoami = await say(sandbox, 'whoami');
    const id = await say(sandbox, 'id -u');
    const canWrite = await say(
      sandbox,
      'touch /work/.spike-write && echo writable || echo not-writable',
    );
    const ownership = await say(sandbox, 'stat -c %U:%G /work');
    return {
      check: 'T005 / D6 / FR-003',
      whoami,
      uid: id,
      workdirOwner: ownership,
      workdirWritable: canWrite,
      verdict:
        whoami !== 'root' && canWrite === 'writable'
          ? 'work runs unprivileged and owns its workspace — D6 holds as recorded'
          : 'work runs as root, or cannot write /work — D6 needs rethinking before Phase 3',
    };
  } finally {
    await sandbox.destroy();
  }
}

/**
 * T006 / D7 — is a deny-by-default allowlist real, and can it be changed on a
 * container that is already running?
 *
 * Per-step network reach (FR-011) depends on the second half. If the policy
 * can only be set at creation, a restricted step needs its own sandbox and the
 * cost model changes.
 *
 * `enableInternet: false` with a non-empty `allowedHosts` is the shape the
 * type definitions describe: "allowed hosts get internet access even when
 * enableInternet is false".
 */
async function egress(env: Env): Promise<unknown> {
  const sandbox = getSandbox(env.SPIKE_SMALL, `spike-egress-${Date.now()}`);
  const reach = (host: string) =>
    say(sandbox, `curl -s -o /dev/null -m 8 -w '%{http_code}' https://${host}/ || echo blocked`);
  try {
    // Deny by default, permit exactly one host.
    await sandbox.setAllowedHosts(['api.anthropic.com']);
    const permittedBefore = await reach('api.anthropic.com');
    const refusedBefore = await reach('registry.npmjs.org');

    // The half that matters: widen the policy WITHOUT restarting.
    await sandbox.setAllowedHosts(['api.anthropic.com', 'registry.npmjs.org']);
    const permittedAfter = await reach('registry.npmjs.org');

    // And narrow it again, which is what happens after a restricted step.
    await sandbox.setAllowedHosts(['api.anthropic.com']);
    const refusedAgain = await reach('registry.npmjs.org');

    const switched = refusedBefore === 'blocked' && permittedAfter !== 'blocked';
    return {
      check: 'T006 / D7 / FR-011, FR-012',
      permittedBefore,
      refusedBefore,
      permittedAfter,
      refusedAgain,
      verdict: switched
        ? 'reach changes on a running sandbox — per-step restriction costs no extra sandbox'
        : 'reach did not change without a restart — FR-011 needs a sandbox per step, or a different mechanism',
    };
  } finally {
    await sandbox.destroy();
  }
}

/**
 * T007 / D4 — does a container binding deliver the size it declares?
 *
 * FR-009 resolves a workspace's ceilings DOWNWARDS to the largest offered size
 * that fits within them, and FR-005 fails a run when none does. Both are
 * meaningless unless a binding's declared `instance_type` is what the sandbox
 * actually gets, so this reads the cgroup from inside two differently sized
 * bindings and compares.
 */
async function sizes(env: Env): Promise<unknown> {
  const observe = async (namespace: DurableObjectNamespace<Sandbox<Env>>, label: string) => {
    const sandbox = getSandbox(namespace, `spike-size-${label}-${Date.now()}`);
    try {
      return {
        binding: label,
        // cgroup v2 first, falling back to v1; `max` means no limit was set.
        memoryLimitBytes: await say(
          sandbox,
          'cat /sys/fs/cgroup/memory.max 2>/dev/null || ' +
            'cat /sys/fs/cgroup/memory/memory.limit_in_bytes 2>/dev/null || echo unknown',
        ),
        cpuQuota: await say(sandbox, 'cat /sys/fs/cgroup/cpu.max 2>/dev/null || echo unknown'),
        nproc: await say(sandbox, 'nproc'),
        memTotalKb: await say(sandbox, "awk '/MemTotal/ {print $2}' /proc/meminfo"),
      };
    } finally {
      await sandbox.destroy();
    }
  };

  const small = await observe(env.SPIKE_SMALL, 'small');
  const large = await observe(env.SPIKE_LARGE, 'large');
  return {
    check: 'T007 / D4 / FR-005, FR-009',
    small,
    large,
    verdict:
      small.memoryLimitBytes !== large.memoryLimitBytes
        ? 'bindings deliver distinct sizes — routing to the largest size within the ceilings is buildable'
        : 'both bindings look identical — size routing needs a different shape, and D4 is wrong',
    note:
      'Compare each memoryLimitBytes against the instance_type its binding declares in ' +
      'wrangler.spike.jsonc. A sandbox that gets MORE than its binding declares would break FR-009 ' +
      'outright, because a ceiling would no longer be an upper bound.',
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    const checks: Record<string, (env: Env) => Promise<unknown>> = {
      '/non-root': nonRoot,
      '/egress': egress,
      '/sizes': sizes,
    };
    const check = checks[pathname];
    if (!check) {
      return Response.json(
        { spike: 'specs/002-hosted-runner-sandboxes T005–T007', routes: Object.keys(checks) },
        { status: 404 },
      );
    }
    try {
      return Response.json(await check(env));
    } catch (error) {
      // A spike that swallows its failure teaches nothing.
      return Response.json(
        { failed: pathname, error: error instanceof Error ? error.message : String(error) },
        { status: 500 },
      );
    }
  },
};
