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

/**
 * `enableInternet = false` is what makes the egress check mean anything: the
 * type definitions say "allowed hosts get internet access even when
 * enableInternet is false", so deny-by-default plus an allowlist is the shape
 * FR-012 asks for. With internet enabled, `setAllowedHosts` would have nothing
 * to prove and the check would report a false negative.
 */
export class SpikeSmall extends Sandbox<Env> {
  override enableInternet = false;
}
export class SpikeLarge extends Sandbox<Env> {
  override enableInternet = false;
}

interface Env {
  SPIKE_SMALL: DurableObjectNamespace<SpikeSmall>;
  SPIKE_LARGE: DurableObjectNamespace<SpikeLarge>;
}

/**
 * One sandbox per check, addressed by a STABLE id.
 *
 * An earlier version used `${Date.now()}`, so every call asked for a brand-new
 * container. With `max_instances` at 2 the third request could never start, and
 * the SDK retried for ~140s before giving up — which is what "it hangs for two
 * minutes" turned out to be. A stable id reuses a warm container instead.
 */
function sandboxFor(namespace: DurableObjectNamespace<Sandbox<Env>>, check: string) {
  // `sleepAfter` bounds what a leaked container costs. The default is 10
  // minutes, and containers DO leak here: when the client gives up, the Worker
  // request is cancelled and any cleanup in a `finally` is cancelled with it —
  // confirmed in the logs as `SpikeSmall.destroy - Canceled`. Two minutes is
  // plenty for a spike and reaps a leak quickly.
  //
  // That cancellation is the same reason the real execution service cannot rely
  // on tidy cleanup and needs the wall-clock alarm as its backstop (D5, D9).
  return getSandbox(namespace, `spike-${check}`, { sleepAfter: '2m' });
}

/**
 * One script, one round trip, with the elapsed time reported.
 *
 * The first version ran four commands as four separate `exec` calls — four
 * round trips of Worker → Durable Object → the container's control server, for
 * four trivial questions. A real run creates one sandbox and then runs many
 * commands against it while it is warm, so measuring four cold round trips
 * measured nothing anybody will experience.
 *
 * The timeout stays mandatory: the SDK's `exec` has no default, so a sandbox
 * that never becomes ready hangs the request instead of reporting.
 */
async function script(
  sandbox: {
    exec: (
      c: string,
      o?: { timeout?: number },
    ) => Promise<{ exitCode: number; stdout: string; stderr: string }>;
  },
  lines: string[],
  timeout = 60_000,
): Promise<{ out: Record<string, string>; exitCode: number; elapsedMs: number; stderr: string }> {
  const started = Date.now();
  const result = await sandbox.exec(lines.join('\n'), { timeout });
  const out: Record<string, string> = {};
  for (const line of result.stdout.split('\n')) {
    const at = line.indexOf('=');
    if (at > 0) out[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  return {
    out,
    exitCode: result.exitCode,
    elapsedMs: Date.now() - started,
    stderr: `${result.stderr}`.trim().slice(0, 400),
  };
}

/**
 * T005 / D6 — can a step's work be made to run as somebody other than root?
 *
 * The earlier version of this check only asked what the DEFAULT user is, and
 * then declared "D6 needs rethinking" if it was root. That conclusion would
 * have been wrong: the default IS root, by construction — the SDK's
 * `ExecOptions` has no user field and the image's entrypoint is a control
 * server that is not de-privileged. T025's job is to WRAP each command so it
 * runs as `factory`.
 *
 * So the real question is whether such a wrapping works, and which mechanism to
 * use. This tries the two candidates the base image should carry and reports
 * which one survives — including whether the wrapped user can write /work,
 * because an unprivileged user that cannot write the workspace is useless.
 */
async function nonRoot(env: Env): Promise<unknown> {
  const sandbox = sandboxFor(env.SPIKE_SMALL, 'non-root');
  const probe = await script(sandbox, [
    'echo default_user=$(whoami)',
    'echo default_uid=$(id -u)',
    'echo factory_exists=$(id -u factory 2>/dev/null || echo no)',
    'echo workdir_owner=$(stat -c %U:%G /work 2>/dev/null || echo missing)',
    // Candidate 1: su. Present everywhere, sometimes unhappy without a TTY.
    "echo su_user=$(su factory -s /bin/sh -c 'whoami' 2>&1 | tail -1)",
    "echo su_can_write=$(su factory -s /bin/sh -c 'touch /work/.spike-su && echo yes || echo no' 2>&1 | tail -1)",
    // Candidate 2: setpriv, from util-linux. No TTY assumptions, no PAM.
    'echo setpriv_user=$(setpriv --reuid=factory --regid=factory --clear-groups whoami 2>&1 | tail -1)',
    "echo setpriv_can_write=$(setpriv --reuid=factory --regid=factory --clear-groups sh -c 'touch /work/.spike-setpriv && echo yes || echo no' 2>&1 | tail -1)",
  ]);

  const works = (user?: string, write?: string) => user === 'factory' && write === 'yes';
  const viaSu = works(probe.out.su_user, probe.out.su_can_write);
  const viaSetpriv = works(probe.out.setpriv_user, probe.out.setpriv_can_write);

  return {
    check: 'T005 / D6 / FR-003',
    elapsedMs: probe.elapsedMs,
    observed: probe.out,
    stderr: probe.stderr || undefined,
    verdict: viaSetpriv
      ? 'setpriv works — T025 should wrap commands with setpriv; D6 holds as recorded'
      : viaSu
        ? 'su works, setpriv does not — T025 should wrap with su; D6 holds as recorded'
        : 'NEITHER mechanism ran work as factory. D6 stops being an accepted cost and ' +
          'becomes a blocker: read `observed` to see which half failed — the user, or the write.',
    note:
      'default_user being root is EXPECTED and not the finding. The finding is whether a ' +
      'wrapped command can be factory AND write /work.',
  };
}

/**
 * T006 / D7 — is a deny-by-default allowlist real, and can it be changed on a
 * container that is already running?
 *
 * Per-step network reach (FR-011) depends entirely on the second half. If the
 * policy can only be set when a sandbox is created, a restricted step needs its
 * own sandbox and the cost model changes.
 *
 * `enableInternet: false` with a non-empty `allowedHosts` is the shape the type
 * definitions describe: "allowed hosts get internet access even when
 * enableInternet is false".
 */
async function egress(env: Env): Promise<unknown> {
  const sandbox = sandboxFor(env.SPIKE_SMALL, 'egress');
  // Both hosts probed in ONE round trip, so a policy change sits between two
  // measurements rather than between four.
  const probe = () =>
    script(
      sandbox,
      [
        "echo model=$(curl -s -o /dev/null -m 8 -w '%{http_code}' https://api.anthropic.com/ 2>/dev/null || echo blocked)",
        "echo registry=$(curl -s -o /dev/null -m 8 -w '%{http_code}' https://registry.npmjs.org/ 2>/dev/null || echo blocked)",
      ],
      40_000,
    );

  await sandbox.setAllowedHosts(['api.anthropic.com']);
  const narrow = await probe();

  // The half that matters: widen WITHOUT restarting.
  await sandbox.setAllowedHosts(['api.anthropic.com', 'registry.npmjs.org']);
  const wide = await probe();

  // And narrow again, which is what happens after a restricted step ends.
  await sandbox.setAllowedHosts(['api.anthropic.com']);
  const narrowAgain = await probe();

  const blocked = (v?: string) => v === 'blocked' || v === '000';
  const switchedOpen = blocked(narrow.out.registry) && !blocked(wide.out.registry);
  const switchedShut = !blocked(wide.out.registry) && blocked(narrowAgain.out.registry);

  return {
    check: 'T006 / D7 / FR-011, FR-012',
    elapsedMs: narrow.elapsedMs + wide.elapsedMs + narrowAgain.elapsedMs,
    allowlistOnly: narrow.out,
    afterWidening: wide.out,
    afterNarrowingAgain: narrowAgain.out,
    verdict:
      switchedOpen && switchedShut
        ? 'reach opens AND shuts on a running sandbox — per-step restriction costs no extra sandbox'
        : switchedOpen
          ? 'reach opens on a running sandbox but did not shut again — a restricted step could ' +
            "inherit an earlier step's wider reach, which FR-011 forbids"
          : 'reach did not change without a restart — FR-011 needs a sandbox per step, or a ' +
            'different mechanism, and D7 is wrong',
    note:
      'The model service must stay reachable throughout: a restricted step IS a call to it, ' +
      'so `model` blocked at any point would make every agent step fail (FR-012).',
  };
}

/**
 * T007 / D4 — does a container binding deliver the size it declares?
 *
 * FR-009 resolves a workspace's ceilings DOWNWARDS to the largest offered size
 * that fits within them, and FR-005 fails a run when none does. Both are
 * meaningless unless a binding's declared `instance_type` is what the sandbox
 * actually gets — and a sandbox that got MORE than its binding declares would
 * break FR-009 outright, because a ceiling would stop being an upper bound.
 */
async function sizes(env: Env): Promise<unknown> {
  const observe = async (namespace: DurableObjectNamespace<Sandbox<Env>>, label: string) => {
    const probe = await script(sandboxFor(namespace, `size-${label}`), [
      // cgroup v2 first, then v1. `max` means no limit was set.
      'echo memory_limit_bytes=$(cat /sys/fs/cgroup/memory.max 2>/dev/null || cat /sys/fs/cgroup/memory/memory.limit_in_bytes 2>/dev/null || echo unknown)',
      'echo cpu_max=$(cat /sys/fs/cgroup/cpu.max 2>/dev/null || echo unknown)',
      'echo nproc=$(nproc)',
      "echo mem_total_kb=$(awk '/MemTotal/ {print $2}' /proc/meminfo)",
    ]);
    return {
      binding: label,
      elapsedMs: probe.elapsedMs,
      values: probe.out,
      stderr: probe.stderr || undefined,
    };
  };

  const small = await observe(env.SPIKE_SMALL, 'small');
  const large = await observe(env.SPIKE_LARGE, 'large');
  return {
    check: 'T007 / D4 / FR-005, FR-009',
    declared: {
      small: '1 vCPU / 4096 MiB — what FR-009 routes a default workspace to',
      large: '4 vCPU / 12288 MiB',
    },
    small,
    large,
    verdict:
      small.values.memory_limit_bytes !== large.values.memory_limit_bytes
        ? 'bindings deliver distinct sizes — routing to the largest size within the ceilings is buildable'
        : 'both bindings look identical — size routing needs a different shape, and D4 is wrong',
    note:
      'Check each memory_limit_bytes against what its binding declares. 4096 MiB is ' +
      '4294967296 bytes; 12288 MiB is 12884901888.',
  };
}

/**
 * The cheapest possible question: does a sandbox start and answer at all?
 *
 * Worth its own route because the first failure mode is not any of the three
 * checks — it is an image the SDK cannot drive, which looks like a hang rather
 * than an error. Run this first.
 */
async function ping(env: Env): Promise<unknown> {
  const probe = await script(sandboxFor(env.SPIKE_SMALL, 'ping'), ['echo said=ok'], 30_000);
  return {
    check: 'readiness',
    elapsedMs: probe.elapsedMs,
    said: probe.out.said,
    verdict:
      probe.out.said === 'ok'
        ? 'a sandbox starts and runs commands — the image carries the control server'
        : `a sandbox answered unexpectedly: ${JSON.stringify(probe)}`,
    note:
      'Call twice. The first is a cold start; the second reuses the warm container and is ' +
      'what a run actually pays between steps.',
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    const checks: Record<string, (env: Env) => Promise<unknown>> = {
      '/ping': ping,
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
