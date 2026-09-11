import { getSandbox, Sandbox } from '@cloudflare/sandbox';

/**
 * Required for egress interception, and not obvious: without it the SDK reports
 * "ctx.exports.ContainerProxy is undefined, export ContainerProxy from the
 * containers package in your worker entrypoint". It is a `WorkerEntrypoint`
 * found through `ctx.exports`, so a plain re-export is all it needs — no
 * wrangler binding. The real execution service will need this too (T047).
 */
export { ContainerProxy } from '@cloudflare/sandbox';

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
export class SpikeSmall extends Sandbox<Env> {}
export class SpikeLarge extends Sandbox<Env> {}

/**
 * Three classes, because the egress ladder has to separate three explanations
 * for the same symptom, and `enableInternet` / `allowedHosts` are read when the
 * container STARTS — so they cannot be varied at runtime on one class.
 *
 * The first attempt set `enableInternet = false` and then called
 * `setAllowedHosts` at runtime. Everything was blocked, including the host on
 * the allowlist from the first probe. That rules nothing out on its own: it is
 * equally consistent with "internet off means off", "the allowlist must be set
 * before start", and "the allowlist only governs proxied HTTP, not raw TCP".
 */

/** Baseline. If curl fails HERE, the container has no egress at all and no list matters. */
export class SpikeOpen extends Sandbox<Env> {
  override enableInternet = true;
}

/** Deny-list with internet ON. The types say denied hosts are blocked unconditionally. */
export class SpikeDeny extends Sandbox<Env> {
  override enableInternet = true;
  override deniedHosts?: string[] = ['registry.npmjs.org'];
}

/** Allow-list with internet OFF, declared BEFORE start rather than applied after. */
export class SpikeAllow extends Sandbox<Env> {
  override enableInternet = false;
  override allowedHosts?: string[] = ['api.anthropic.com'];
}

interface Env {
  SPIKE_SMALL: DurableObjectNamespace<SpikeSmall>;
  SPIKE_LARGE: DurableObjectNamespace<SpikeLarge>;
  SPIKE_OPEN: DurableObjectNamespace<SpikeOpen>;
  SPIKE_DENY: DurableObjectNamespace<SpikeDeny>;
  SPIKE_ALLOW: DurableObjectNamespace<SpikeAllow>;
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
  // Both hosts in one round trip. `%{http_code}` prints 000 when curl never
  // connects, and the `|| echo blocked` appends to it — so `000blocked` means
  // no connection at all, while a bare status code means it reached something.
  const probe = (namespace: DurableObjectNamespace<Sandbox<Env>>, id: string) =>
    script(
      sandboxFor(namespace, id),
      [
        "echo model=$(curl -s -o /dev/null -m 8 -w '%{http_code}' https://api.anthropic.com/ 2>/dev/null || echo blocked)",
        "echo registry=$(curl -s -o /dev/null -m 8 -w '%{http_code}' https://registry.npmjs.org/ 2>/dev/null || echo blocked)",
        // Separates "cannot resolve" from "resolved but refused", which the
        // http_code alone cannot: both show as 000.
        'echo dns=$(getent hosts api.anthropic.com >/dev/null 2>&1 && echo resolves || echo no-dns)',
        'echo proxy_env=$(env | grep -ci "_proxy=" || true)',
      ],
      40_000,
    );

  const reached = (v?: string) => Boolean(v) && !v?.startsWith('000');

  // Rung 1 — internet on, no lists. If this fails, nothing below means anything.
  const open = await probe(env.SPIKE_OPEN, 'egress-open');
  // Rung 2 — internet on, one host denied. Types: denied is unconditional.
  const deny = await probe(env.SPIKE_DENY, 'egress-deny');
  // Rung 3 — internet off, allowlist declared BEFORE start rather than after.
  const allow = await probe(env.SPIKE_ALLOW, 'egress-allow');

  const baselineWorks = reached(open.out.model) && reached(open.out.registry);
  const denyWorks = reached(deny.out.model) && !reached(deny.out.registry);
  const allowWorks = reached(allow.out.model) && !reached(allow.out.registry);

  return {
    check: 'T006 / D7 / FR-011, FR-012',
    elapsedMs: open.elapsedMs + deny.elapsedMs + allow.elapsedMs,
    rung1_internetOn_noLists: open.out,
    rung2_internetOn_denyRegistry: deny.out,
    rung3_internetOff_allowModel: allow.out,
    verdict: !baselineWorks
      ? 'THE CONTAINER HAS NO EGRESS AT ALL, even with enableInternet true. Nothing about ' +
        'allowlists matters until that is understood — check `dns` and `proxy_env`: if dns is ' +
        'no-dns, name resolution is the barrier; if proxy_env is non-zero, traffic is expected ' +
        'to go through a proxy and raw curl never will.'
      : allowWorks
        ? 'an allowlist declared before start works — FR-012 is buildable as specified, but it ' +
          'must be set at creation, NOT with setAllowedHosts at runtime. That means per-step ' +
          'reach (FR-011) needs a sandbox per restriction level, and D7 is wrong about the ' +
          'runtime switch even though FR-012 survives.'
        : denyWorks
          ? 'only the DENY list works. FR-012 describes a permitted SET, which cannot be ' +
            'expressed as a deny list without enumerating the whole internet — so FR-012 needs ' +
            'rewriting around denial, or a proxy (see proxy_env), and D7 is wrong.'
          : 'lists had no effect in either direction while the baseline works — reach is ' +
            'all-or-nothing on this platform, and FR-011 and FR-012 both need rewriting.',
    note:
      'What each rung isolates: rung 1 is "is there any egress"; rung 2 is "does denial work ' +
      'with internet on"; rung 3 is "does permission work when declared before start". The ' +
      'first attempt combined internet-off with a RUNTIME setAllowedHosts and could not tell ' +
      'these apart.',
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
  // What each binding declares in wrangler.spike.jsonc, so the check compares
  // against the declaration instead of leaving it to somebody's arithmetic.
  const declared = {
    small: { vcpu: 1, memoryMib: 4096 },
    large: { vcpu: 4, memoryMib: 12288 },
  };

  const observe = async (
    namespace: DurableObjectNamespace<Sandbox<Env>>,
    label: 'small' | 'large',
  ) => {
    const probe = await script(sandboxFor(namespace, `size-${label}`), [
      'echo nproc=$(nproc)',
      "echo mem_total_kb=$(awk '/MemTotal/ {print $2}' /proc/meminfo)",
      // Kept for the record even though both paths came back empty on this
      // platform — /proc/meminfo and nproc are what actually answer here.
      'echo memory_max=$(cat /sys/fs/cgroup/memory.max 2>/dev/null || cat /sys/fs/cgroup/memory/memory.limit_in_bytes 2>/dev/null || echo unavailable)',
      'echo cpu_max=$(cat /sys/fs/cgroup/cpu.max 2>/dev/null || echo unavailable)',
    ]);
    const want = declared[label];
    const memMib = Number(probe.out.mem_total_kb) / 1024;
    return {
      binding: label,
      elapsedMs: probe.elapsedMs,
      declared: `${want.vcpu} vCPU / ${want.memoryMib} MiB`,
      nproc: Number(probe.out.nproc),
      memoryMib: Math.round(memMib),
      memoryDeltaPercent: Number((((memMib - want.memoryMib) / want.memoryMib) * 100).toFixed(1)),
      cpuMatchesDeclared: Number(probe.out.nproc) === want.vcpu,
      cgroup: { memory_max: probe.out.memory_max, cpu_max: probe.out.cpu_max },
    };
  };

  const small = await observe(env.SPIKE_SMALL, 'small');
  const large = await observe(env.SPIKE_LARGE, 'large');

  const distinct = small.nproc !== large.nproc;
  const accurate = small.cpuMatchesDeclared && large.cpuMatchesDeclared;
  // The property FR-009 actually depends on: a ceiling must stay an UPPER
  // bound, so a sandbox getting materially more than its binding declares
  // would break it outright. Allow a few percent for how the platform accounts
  // for memory — MemTotal is never exactly the figure requested.
  const withinTolerance =
    Math.abs(small.memoryDeltaPercent) < 5 && Math.abs(large.memoryDeltaPercent) < 5;

  return {
    check: 'T007 / D4 / FR-005, FR-009',
    small,
    large,
    verdict:
      distinct && accurate && withinTolerance
        ? 'bindings deliver what they declare — routing to the largest size within a ' +
          "workspace's ceilings is buildable, and D4 holds"
        : !distinct
          ? 'both bindings delivered the same size — size routing needs a different shape, ' +
            'and D4 is wrong'
          : 'bindings differ but do not match their declarations — read memoryDeltaPercent ' +
            'and cpuMatchesDeclared before trusting FR-009',
    note:
      'memoryDeltaPercent is the one to watch: a positive figure means the sandbox got MORE ' +
      'than declared, and FR-009 treats a workspace ceiling as an upper bound. A couple of ' +
      'percent is accounting; a large positive number would mean the ceiling is not one.',
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
