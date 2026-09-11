# Phase 0: Research — Hosted Runner Sandboxes

**Feature**: `specs/002-hosted-runner-sandboxes` | **Date**: 2026-09-11

Every figure below was checked against the provider's own documentation, changelog or shipped
package on 2026-09-11, not recalled. Where a claim rests on a secondary source or has not been run,
it says so. Three decisions (D4, D6, D9) constrain the feature in ways the specification did not
anticipate; each names what it costs.

---

## D1 — The execution service is deployed as a Worker, and each run's sandbox is a Durable Object

**Decision**: `apps/runner` stops being a long-lived process started with `bun src/index.ts` and
becomes a Worker whose `fetch` handler serves the four operations in
`specs/001-code-factory-mvp/contracts/runner.md`. Each run's sandbox is a `Sandbox` Durable Object
from `@cloudflare/sandbox`, addressed by run id.

**Rationale**: the runner's whole surface is `Bun.serve({ fetch })` over a `Route[]` array, and its
handler is already `(Request) => Response`. Only three places in `apps/runner/src` touch a runtime
API: `Bun.serve` in `index.ts`, `Bun.spawn` in `container/host.ts` (the file being replaced), and
`timingSafeEqual` from `node:crypto` in `auth.ts`. Everything else is plain TypeScript over
`fetch`. The port is therefore small, and addressing a sandbox by run id is what makes FR-006 work
without inventing a state store.

**Alternatives considered**: keeping the runner as a container on a VM and using the provider only
for sandboxes — rejected because it leaves a machine to administer, which is FR-001. Rewriting the
runner as a Workflow — rejected as a much larger change than the spec authorises, and Workflows
have their own step-duration limits that would reshape the contract.

---

## D2 — The execution host stays behind the existing interface, chosen by configuration

**Decision**: `ContainerHost` in `apps/runner/src/container/host.ts` stays exactly as it is — six
methods, same signatures. A second implementation, the hosted one, sits beside `dockerHost`. Which
one a deployment uses is read from configuration at startup.

**Rationale**: this is the only thing that makes FR-025 and FR-026 cheap. The interface is already
injected as a parameter at five call sites in `index.ts` and every test already drives the logic
through `apps/runner/tests/fake-host.ts`, so the existing suite keeps passing with no network and
no account. It is also the rollback: a deployment that goes wrong changes one variable.

**Alternatives considered**: replacing `dockerHost` outright — rejected; it deletes the local
development path and makes the migration a one-way door, which FR-025 forbids.

---

## D3 — A run's state lives in its sandbox's Durable Object

**Decision**: the in-process `memoryStore()` `Map` in `apps/runner/src/runs.ts` is replaced by state
held in the Durable Object addressed by the run id — the pinned snapshot, the resolved credentials,
and the sandbox identifier.

**Rationale**: FR-006 requires start, step, verify-and-push and destroy to address the same sandbox
and workspace. A `Map` in a Worker isolate cannot do that: isolates are created and discarded per
request. A Durable Object is single-instance per id by construction, which is precisely the
guarantee FR-008 needs against concurrent requests for one run.

**Cost**: credentials now rest in Durable Object storage for the life of a run rather than only in
process memory. `specs/001-code-factory-mvp` FR-083 forbids persisting credentials in the
*orchestrator*; this is the execution service, which is the component allowed to hold them. They
must be deleted when the run ends, and that deletion is a task, not an assumption.

---

## D4 — Sandbox size is fixed per deployment, so a ceiling is honoured by staying under it

**Decision**: declare a small fixed set of container bindings — one per offered size — and route a
run to the **largest offered size that still fits within** the workspace's processing-power and
memory ceilings. A workspace whose ceiling sits below the smallest offered size fails at start,
naming that ceiling (FR-005).

**Why this is forced**: processing power and memory are not settable per sandbox at runtime. They
come from the Wrangler container configuration, for example
`instance_type = { vcpu = 2, memory_mib = 6144, disk_mb = 12000 }`, which is deploy-time
configuration attached to a container binding. Custom instance types are available to all users,
must allocate at least 1 vCPU, and are capped at the largest predefined size: 4 vCPU, 12 GiB memory
and 20 GB disk.

**Which direction to resolve, and why it matters**: an earlier draft of this decision rounded
*upwards* — the smallest size meeting or exceeding the workspace's figures. That inverts the
setting. `specs/001-code-factory-mvp` FR-085 says an administrator *constrains* a sandbox's
processing power and memory, so the figures are an upper bound on what a run may consume, and an
administrator who caps memory at 4096 MiB should never be handed 8 GiB. FR-009 now says so
explicitly. Rounding down can give a workspace less than it asked for, which is visible in what the
run records and is the safe direction to be wrong in.

**A consequence worth stating**: the deployment should offer a size matching the shipped defaults
(2 vCPU, 4096 MiB) exactly, because a custom instance type can express it. Without one, every
workspace on the defaults drops to the next size down and runs slower than intended for no reason
anybody chose.

**What it still costs**: a workspace setting an unusual figure gets less than it asked for and is
not told. The alternative — one binding per distinct workspace configuration — was rejected as
unbounded, and is recorded in the plan's Complexity Tracking.

**Measured, 2026-09-11 — and it is narrower than documented.** The first spike deploy was refused
at validation:

> `VALIDATE_INPUT` — memory Must have at least 3 GiB memory for each of the first 4 vCPUs. With 2
> vCPU(s), you need at least 6 GiB of memory.

So vCPU and memory are not independent: the floor is **3 GiB per vCPU for the first four vCPUs**.
1 vCPU needs ≥ 3 GiB, 2 vCPU ≥ 6 GiB, 4 vCPU ≥ 12 GiB. That matches the predefined sizes
(standard-2 at 1 vCPU / 6 GiB, standard-3 at 2 vCPU / 8 GiB, standard-4 at 4 vCPU / 12 GiB) rather
than contradicting them — the constraint was simply never stated alongside the maxima.

**The consequence, which is a defect in this feature's own defaults**: the shipped workspace default
of **2 vCPU / 4096 MiB cannot exist on this provider at all**. Two vCPUs demand 6 GiB, which exceeds
the memory ceiling. Under FR-009 the largest allocation fitting *within* those ceilings is
**1 vCPU / 4 GiB** — so a default workspace gets half the processing power it asked for, silently.
FR-009 is behaving as designed, and erring downwards is the direction chosen deliberately, but the
default itself is now wrong.

Two further things follow. **T045 is unsatisfiable as written**: it requires an offered size
matching 2 vCPU / 4096 MiB exactly, and no such size can be declared. And the workspace defaults in
`packages/db/src/schema/workspace.ts` need a decision — accept 1 vCPU, or raise the memory default
to 6144 MiB so that 2 vCPU stays available. That decision belongs to the product owner and is
recorded here rather than resolved.

**Measured, 2026-09-11 (T007) — bindings deliver what they declare.** Two bindings, read from
inside:

| Binding | Declared | `nproc` | `MemTotal` | Delta |
|---|---|---|---|---|
| small | 1 vCPU / 4096 MiB | **1** | 4,269,784 KB ≈ 4170 MiB | **+1.8%** |
| large | 4 vCPU / 12288 MiB | **4** | 12,514,268 KB ≈ 12221 MiB | **−0.5%** |

vCPU is exact. Memory lands within a couple of percent either side, which is how the platform
accounts for it rather than a ceiling being ignored — `MemTotal` is never precisely the figure
requested. **So D4 holds**: routing a run to the largest offered size within its workspace's
ceilings is buildable.

**One honest wrinkle for FR-009.** The small binding came back 1.8% *above* its declared memory, and
FR-009 treats a workspace's figure as an upper bound. At 74 MiB on 4 GiB this is accounting noise,
not the platform overshooting — but it means "never more than the ceiling" is true to within the
provider's granularity and not absolutely. Worth a sentence in the plan rather than a change to
FR-009.

**The cgroup files are not readable at the usual paths** — both `memory.max` and
`memory/memory.limit_in_bytes` came back empty, as did `cpu.max`. `nproc` and `/proc/meminfo` are
what answer here. The first version of this check compared only `memory_limit_bytes`, so it compared
`unknown` with `unknown`, found them unequal, and reported "D4 is wrong" — a false negative from
comparing a field that never resolved. Fixed to compare against the declarations.

**Confidence**: the per-vCPU memory floor and the size delivery are both measured. The routing code
that chooses between sizes is still unwritten (T044).

---

## D5 — The wall-clock ceiling is enforced by a Durable Object alarm

**Decision**: at sandbox creation, set an alarm at `now + wallClockMinutes`. The alarm destroys the
sandbox and clears the run's state. `sleepAfter` is set as well, but as a second line rather than
the mechanism.

**Rationale**: FR-010 and the constitution's amended invariant both require the ceiling to be
enforced by the execution host, with no request needed to trigger it. The SDK's `sleepAfter`
(default 10 minutes) is an *idle* timeout — it measures time since the last request, so a run that
keeps working never trips it, and it is explicitly ignored when `keepAlive` is true. An absolute
ceiling therefore needs a timer the host owns, which is what an alarm is.

**Also relevant**: alarm handler invocations have a maximum wall time of 15 minutes, which is ample
for destroy-and-clear.

---

## D6 — Non-root is arranged inside the image, and it is weaker than what Docker gives us today

**Decision**: the sandbox image adds an unprivileged user, and every command the execution host runs
is executed as that user. The workspace at `/work` is owned by it.

**Why this is forced**: the SDK's `ExecOptions` has `timeout`, `env`, `cwd`, `encoding`, `stream`,
`onOutput`, `onComplete`, `onError`, `signal` and `origin` — and no user field. The image's
entrypoint is `/container-server/sandbox`, a control server the SDK talks to, and nothing in the
published Dockerfile drops it from root.

**What it costs, stated plainly**: today `docker run --user 1000:1000` means *nothing* in the
container is root. After this change the agent's commands are unprivileged but the control server
supervising them is not, so a container-escape path that starts by compromising the control server
is no longer blocked by the same wall. The constitution's invariant — "one fresh sandbox per run:
non-root" — is met for the work, not for the whole sandbox. This is a genuine weakening, recorded
in Complexity Tracking rather than glossed.

**Alternatives considered**: running our own entrypoint as a non-root user — rejected, because the
SDK's control server is how `exec`, `writeFile` and `readFile` reach the sandbox at all; replacing
it means not using the SDK.

**Measured, 2026-09-11 (T005) — it works, and `setpriv` is the mechanism.** Against a real sandbox
built from `infra/sandbox/Dockerfile`:

| Observed | Value |
|---|---|
| Default user for `exec` | `root`, uid `0` — expected, and not the finding |
| `factory` user | exists, uid `1000` — the same uid `docker run --user 1000:1000` used |
| `/work` owner | `factory:factory` |
| `su factory -s /bin/sh -c …` | becomes `factory`, **can write** `/work` |
| `setpriv --reuid=factory --regid=factory --clear-groups …` | becomes `factory`, **can write** `/work` |

Both mechanisms work, so T025 has a choice. **Prefer `setpriv`**: it makes no TTY assumptions and
goes nowhere near PAM, where `su` does both and is the likelier of the two to behave differently
once a command carries a pipe, a heredoc or a long prompt. `su` is the fallback if `setpriv` ever
leaves the base image.

So Complexity Tracking row 2 stands exactly as written — the work is unprivileged, the control
server supervising it is not — and it stays an accepted cost rather than becoming a blocker.

**What the first version of this check got wrong**, recorded because the mistake is instructive: it
only asked what the *default* user was, and would have declared D6 broken on finding `root`. But
root is the default by construction — the SDK has no user field — and T025's whole job is the
wrapping. A check that cannot tell "this host cannot do X" from "we have not built X yet" is worse
than no check, because it produces a confident wrong answer.

---

## D7 — Per-step network reach uses the allowlist, switched between steps

**Decision**: the sandbox is created with outbound traffic denied by default and an allowlist
carrying the model service, the design service, the run's git provider and the workspace's
permitted hosts. Before a step that FR-011 does not restrict, the policy is widened; after it, it is
narrowed again.

**Rationale**: this is what makes FR-011 buildable rather than aspirational, and the API was read
out of the installed package rather than from documentation. It is **not** on `Sandbox`'s own type
surface — it is inherited from `Container` in `@cloudflare/containers@0.3.7`, which `Sandbox`
extends, and which itself extends `DurableObject` (so D5's alarm is available on the same object):

- Construction: `enableInternet?: boolean`, `allowedHosts?: string[]`, `deniedHosts?: string[]`.
- At runtime, on a container that is already running: `setAllowedHosts(hosts)`,
  `setDeniedHosts(hosts)`, `allowHost(h)`, `denyHost(h)`, `removeAllowedHost(h)`,
  `removeDeniedHost(h)`, plus `setOutboundHandler` / `setOutboundByHost` / `setOutboundByHosts` for
  intercepting rather than merely permitting.

Two semantics from the type definitions matter more than the method names. *"Allowed hosts get
internet access even when `enableInternet` is false"* — so `enableInternet: false` plus an allowlist
is precisely the deny-by-default shape FR-012 asks for, with no extra mechanism. And *"denied hosts
are blocked unconditionally, even when `enableInternet` is true"* — so a deny list cannot be
widened by anything else, which is what makes an administrator's emptied list (FR-012b) mean what
it says.

Per-step switching is therefore `setAllowedHosts` before and after each step, and costs no extra
sandbox.

**MEASURED, 2026-09-11 (T006) — D7 IS WRONG. The lists do not govern a container's traffic.**

Three rungs, each its own container class:

| Rung | Configuration | `api.anthropic.com` | `registry.npmjs.org` | DNS | proxy vars |
|---|---|---|---|---|---|
| 1 | internet on, no lists | `404` (reached) | `200` | resolves | 0 |
| 2 | internet on, `deniedHosts: [registry]` | `404` | **`200` — NOT denied** | resolves | 0 |
| 3 | internet off, `allowedHosts: [model]` | **blocked** | blocked | resolves | 0 |

Rung 1 proves egress works at all. Rung 2 shows a deny list having **no effect** — the denied host
answered `200`. Rung 3 shows an allow list having **no effect** — the permitted host was blocked
along with everything else. Reach is **all-or-nothing**.

**Why, and it follows from `proxy_env: 0`.** No proxy variables are set in the container, so `curl`
opens its own socket and nothing intercepts it. `allowedHosts`, `deniedHosts`, `setOutboundHandler`
and `setOutboundByHost` govern traffic that passes through `ContainerProxy` — the container's
`fetch` routed via the Worker — not raw TCP from a process inside the sandbox. `enableInternet:
false` does block sockets (DNS still resolves, connections do not), but it is a switch, not a
filter.

**So FR-011 and FR-012 are not buildable as specified on this host**, and the earlier reading of
the type definitions was wrong about what "allowed hosts get internet access even when
enableInternet is false" applies to. Reading an interface is not the same as running it — the same
lesson as the `setAllowedHosts` correction above, one level deeper.

### What is left, and what each option costs

**A — route the container's traffic through a proxy.** Set `HTTPS_PROXY`/`HTTP_PROXY` in the
sandbox to `ContainerProxy` so `curl`, `git` and the CLIs honour it and the allowlist applies.
**This provides no security guarantee against the threat FR-011 describes.** An agent step executes
arbitrary code by design; arbitrary code can ignore a proxy environment variable and open a socket.
It would catch an accidental reach and stop nothing deliberate. Enforcement by convention.

**B — all-or-nothing, honestly.** Rewrite the setting as "may a model-driven step reach the network
at all", and accept that the answer must be yes, because an agent step *is* a network call. The
setting then constrains nothing on this host, and FR-085's intent is not served.

**C — reconsider the host for this requirement.** The providers rejected earlier (E2B, Daytona)
have finer-grained egress control, including changing it on a running sandbox. If per-host
restriction is a real requirement rather than a nice-to-have, that is an argument about the platform
choice, not about the specification.

**This is a product decision and it is recorded unresolved.** It also changes the basis on which
Cloudflare was chosen: the earlier analysis told the product owner that per-step egress control was
buildable here, and that was wrong.

**A correction worth keeping**: an earlier draft of this decision cited the SDK's outbound-traffic
guide and named `setOutboundByHost` as the mechanism. The guide is right about the capability, but
the method to use for a permitted SET is `setAllowedHosts`; `setOutboundByHost` is for routing a
host through a handler. Citing a doc is not the same as reading the interface.

---

## D8 — Arguments are quoted at the execution-host boundary

**Decision**: `apps/runner/src/container/shell.ts` (already written, nine tests passing) quotes every
argument before it is joined into a command line, and the hosted host is the only caller.

**Rationale**: the SDK's `exec` takes a command *string*; `docker exec` takes an argument list. That
difference is the whole of FR-015 and SC-007. The arguments are ticket titles, reviewer feedback and
document paths, all typed by people.

**Found while checking, and in scope**: `dockerHost.writeFile` and `dockerHost.stat` already
interpolate a path into `sh -c` unquoted, and `container/start.ts` and `container/recover.ts` build
git scripts with branch names interpolated the same way. These are the same defect class on the
existing host. The quoting helper makes fixing them nearly free and FR-015 does not distinguish
between hosts, so they are in scope.

---

## D9 — The long-held request stays, and its failure mode is the client, not the platform

**Decision**: `POST /runs/{id}/steps/{index}` keeps returning when the step finishes, as
`contracts/runner.md` specifies. No polling, no change to the contract.

**Why this works**: for incoming HTTP requests there is no hard wall-clock limit while the client
remains connected, and time spent waiting on I/O does not count toward CPU time. A step that takes
thirty minutes is thirty minutes of waiting on the sandbox, not of compute. CPU time per Durable
Object invocation defaults to 30 seconds and can be raised to 5 minutes on the paid plan via
`limits.cpu_ms`; our per-invocation compute is request parsing and log forwarding, far below either.

**The real risk**: when the client disconnects, work is cancelled unless `waitUntil()` extends it,
and that only buys 30 seconds. So an orchestrator HTTP timeout shorter than a step now kills the
step rather than merely losing the response. The orchestrator's request timeout must be at least the
longest step's ceiling, and that is a deployment check, not something the code can enforce.

**Not a constraint after all**: subrequest limits. Workers on paid plans now allow 10,000
subrequests per invocation by default, raisable to 10 million, so forwarding log chunks as callbacks
does not need batching to stay inside a limit. Batching may still be worth it for cost.

---

## D10 — The sandbox image extends the provider's base image

**Decision**: `infra/sandbox/Dockerfile` changes from `FROM debian:bookworm-slim` with its own
entrypoint to a layer over the SDK's published sandbox image, adding the Claude CLI, the design CLI,
the unprivileged user from D6, and nothing else. The entrypoint stays the SDK's.

**Rationale**: the SDK reaches a sandbox through a control server at
`ENTRYPOINT ["/container-server/sandbox"]`. An image that replaces the entrypoint cannot be driven
by the SDK at all. The base already carries git, curl, Node and Bun, so our layer is small.

**Two things to pin**: the image must be `linux/amd64`, and the base image tag must match the SDK
version in `package.json` — a mismatch between control server and client is a class of failure that
will not be obvious from the error.

---

## D11 — Dead database configuration is removed

**Decision**: delete `databaseUrl` from `apps/runner/src/config.ts` and `@factory/db` from
`apps/runner/package.json`.

**Rationale**: neither is used. `grep` across `apps/runner/src` finds no import of `@factory/db` and
no read of `config.databaseUrl`. Left in place, the dependency would drag a Postgres driver into a
Worker bundle for nothing, and `loadRunnerConfig` would keep demanding a variable that changes no
behaviour. The runner gets everything it needs from the request: the snapshot arrives in the body,
and credentials are fetched over HTTP from the application with the run's own secret.

---

## D12 — Constant-time credential comparison without `node:crypto`

**Decision**: replace `timingSafeEqual` from `node:crypto` in `apps/runner/src/auth.ts` with a
constant-time comparison written in the same file, or keep it behind the Node compatibility flag —
whichever the bundle check favours.

**Rationale**: it is the runner's one Node import, and FR-018's obligation is that every operation
is authenticated, not that a particular library does it. A fixed-time comparison over two byte
arrays is a few lines and removes a compatibility question from the critical path. Whichever is
chosen, the property to test is that comparison time does not vary with how early the mismatch is.

---

## D13 — A capacity refusal is retried with backoff, and only then fails

**Decision**: `create` retries a refusal for a bounded period — starting figure 30 seconds, with
exponential backoff — before failing with a reason naming capacity (FR-024, FR-024a).

**Rationale**: the provider selects the nearest free instance from pre-initialised locations and
errors when none is free, with retry-and-backoff the documented remedy; reports describe refusals
that clear in seconds, and capacity that is not immediately reusable right after a destroy. The
account ceiling is not the constraint: Workers Paid allows 1,500 vCPU and 6 TiB of memory across
concurrent instances, which at this feature's defaults is on the order of hundreds of concurrent
sandboxes — far above the workspace concurrency ceiling that gates runs first.

**Separately**: for several minutes after a first deployment, container requests can error while the
provider readies capacity. That is longer than the retry window by design; it belongs in the deploy
checklist, and the readiness endpoint (FR-020) is where it should be visible.

**Observed, 2026-09-11 — and there are TWO distinct failures here, not one.** Both appeared while
running the spike, and the retry in T056 has to cover both:

| Message | Source | Behaviour |
|---|---|---|
| `Maximum number of running container instances exceeded. Try again later, or try configuring a higher value for max_instances` | the per-class `max_instances` ceiling | The SDK retried it itself, with backoff, for ~140 s (`attempt: 1, delayMs: 3000, remainingSec: 139`) before surfacing |
| `There is no container instance that can be provided to this Durable Object, try again later` | the platform having no capacity — the error in `cloudflare/containers#45` | Surfaced **immediately**, with no SDK retry |

Two consequences. First, **T056 cannot key off one message**: the second is the genuinely transient
one and the SDK does not retry it, so it is precisely the case FR-024's bounded retry exists for.
The first is a configuration mistake dressed as a capacity problem, and retrying it for 140 s is
wasted — it will never clear on its own.

Second, the ~140 s the SDK spends on the first is longer than FR-024's 30-second window, so our
retry and the SDK's overlap. The plan should say which one owns the deadline, or a run can sit for
two and a half minutes inside what was specified as a thirty-second retry.

The second error was seen immediately after a deploy that added three new container classes, which
is also the post-deploy provisioning case above rather than steady-state scarcity.

---

## D15 — Measured latency: ~700 ms warm, ~4 s cold, per sandbox

**Measured, 2026-09-11**, incidentally to T005 and not planned as a check:

| Call | Elapsed |
|---|---|
| One command, warm container | **710 ms** |
| Eight commands in one script, cold container | **4,013 ms** |

**Why it is worth recording.** SC-006 budgets 60 seconds to a run's first output at the 95th
percentile, and that figure was a guess. A warm round trip at ~0.7 s and a cold start at ~4 s leave
the budget dominated by the git clone and workspace preparation, not by the platform — which is the
opposite of what the number implied.

**And a caution about how to measure it.** An earlier version of the spike appeared to take two
minutes, and none of that was the platform: `max_instances` was 2, every route asked for a
brand-new sandbox, and a cancelled request leaked the containers it had created, so the SDK spent
~140 s retrying a start that could never succeed. The lesson for T067 is that a round trip must be
measured against a WARM sandbox reached by a stable id — measuring cold creates, one per call, is
measuring a thing no run does.

---

## D14 — The existing suite stays on the fake host; the real host gets a spike and an end-to-end test

**Decision**: every test under `apps/runner/tests` keeps running against
`apps/runner/tests/fake-host.ts`. The hosted host gets its own contract test against the fake, plus
one end-to-end test that runs a real ticket and is excluded from `bun test`.

**Rationale**: FR-026 requires the suite to run with no credentials and no network. Constitution
Principle II requires behaviour spanning services to have integration tests against real
dependencies — satisfied by the end-to-end test, which is also User Story 1's Independent Test.

**Order**: D7 (egress switching), D4 (size routing) and D6 (non-root execution) are the three that
have not been run. A spike proving those three against a real sandbox should precede the rest of the
implementation, because each could change the design rather than just the code.

---

## Sources

- Containers limits and instance types — https://developers.cloudflare.com/containers/platform-details/limits/
- Custom instance types changelog — https://developers.cloudflare.com/changelog/post/2026-01-05-custom-instance-types/
- Higher container resource limits — https://developers.cloudflare.com/changelog/post/2026-02-25-higher-container-resource-limits
- Subrequest limit raised — https://developers.cloudflare.com/changelog/post/2026-02-11-subrequests-limit/
- Durable Objects limits — https://developers.cloudflare.com/durable-objects/platform/limits
- Workers limits — https://developers.cloudflare.com/workers/platform/limits
- Sandbox SDK outbound traffic — https://developers.cloudflare.com/sandbox/guides/outbound-traffic/
- Containers egress documentation — https://github.com/cloudflare/containers/blob/main/docs/egress.md
- No container instance available — https://github.com/cloudflare/containers/issues/45
- Concurrent container starts fail — https://github.com/cloudflare/workerd/issues/5996
- `@cloudflare/sandbox@0.12.9` — `dist/sandbox-BtaWcmmG.d.ts` and `Dockerfile`, read from the
  installed package rather than from documentation
