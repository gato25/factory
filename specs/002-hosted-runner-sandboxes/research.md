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

**Confidence**: the instance-type mechanism is documented; the routing design has not been run.

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

---

## D7 — Per-step network reach uses the allowlist, switched between steps

**Decision**: the sandbox is created with outbound traffic denied by default and an allowlist
carrying the model service, the design service, the run's git provider and the workspace's
permitted hosts. Before a step that FR-011 does not restrict, the policy is widened; after it, it is
narrowed again.

**Rationale**: this is what makes FR-011 buildable rather than aspirational. `allowedHosts` is a
deny-by-default allowlist supporting glob patterns, where a host that does not match is blocked;
`enableInternet` controls whether the container reaches the public internet at all; and
`setOutboundHandler()` / `setOutboundByHost()` change the policy on a **running** container without
restarting it. Per-step switching therefore does not cost a sandbox per step.

**Confidence**: the API surface is documented in the SDK's own egress guide; the switching sequence
has not been run and is the first thing a spike should prove.

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
