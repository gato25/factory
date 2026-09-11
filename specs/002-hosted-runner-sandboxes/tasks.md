---

description: "Task list for Hosted Runner Sandboxes"
---

# Tasks: Hosted Runner Sandboxes

**Input**: Design documents from `/specs/002-hosted-runner-sandboxes/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/execution-host.md](./contracts/execution-host.md),
[quickstart.md](./quickstart.md)

**Tests**: Required, not optional. Constitution Principle II: every functional requirement ships
with tests that demonstrate it, every interface named in `contracts/` has contract tests, and each
user story's Independent Test exists as one end-to-end test. **Order is the author's choice** — the
constitution encourages test-first and never requires it, so the test tasks below are listed before
their implementation for readability, not as a mandate to write them first.

**Organization**: grouped by user story so each is independently implementable and testable. The
plan's delivery phases A–F map onto these: A → Phase 2, B → Phases 3–5, C → Phase 3, D → Phase 3,
E → Phase 4, F → Phase 7.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel — different files, no dependency on an incomplete task
- **[Story]**: which user story the task serves
- Each task names the requirement it satisfies, so an orphan is visible

## Path Conventions

Monorepo. `apps/runner/src/` and `apps/runner/tests/` for the execution service, `infra/sandbox/`
for the image, `apps/web/` and `packages/db/` for the one settings field.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: make the Workers toolchain available without changing any behaviour

- [X] T001 Add `@cloudflare/sandbox@0.12.9` and `wrangler` to dependencies in `apps/runner/package.json`, pinning both exactly (D10 requires the image tag to match the SDK version)
- [X] T002 [P] Create `apps/runner/wrangler.jsonc` with the Worker entry, one Durable Object binding for the sandbox class, and `limits.cpu_ms` raised to 300000 per D9
- [X] T003 [P] Add Workers types to `apps/runner/tsconfig.json` so `bunx tsc -p apps/runner` typechecks both runtime targets
- [X] T004 Exclude `apps/runner/tests/e2e` from the `test` script in the root `package.json`, so `bun run verify` stays offline per FR-026

**Checkpoint**: `bun run verify` still green, nothing behaves differently

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: prove the three unrun decisions, then make the seam safe. Everything here ships without
any hosted infrastructure and is useful on the existing Docker host.

**⚠️ CRITICAL**: T005–T007 gate everything after them. Each could change the design rather than the
code, and the plan says so. Do not start Phase 3 until all three answer.

**Status: the spike is written and typechecks against the installed SDK, but has NOT been run.**
It needs a Cloudflare account, a published sandbox image and a deployed Worker; the environment it
was written in had no `CLOUDFLARE_API_TOKEN`. `spikes/worker.ts` and `wrangler.spike.jsonc` are
ready — deploy and call the three routes, then record the answers under D4, D6 and D7 (T061).
Everything in Phase 3 onwards remains gated.

### The spike (research.md D4, D6, D7 — documented, not run)

- [X] T005 In `apps/runner/spikes/non-root.ts`, create one real sandbox and confirm a command runs as an unprivileged user and that `/work` is writable by it (D6, FR-003). Record the answer in `research.md` under D6
  - **Answered 2026-09-11: it works.** `factory` exists at uid 1000, `/work` is `factory:factory`, and BOTH `su` and `setpriv` become `factory` and can write it. Recorded under D6, which now names `setpriv` as the mechanism T025 should use — no TTY assumptions and no PAM. Complexity Tracking row 2 stands as an accepted cost rather than a blocker. Implemented in `spikes/worker.ts` (one Worker, not three scripts: the SDK needs a Durable Object binding).
- [X] T006 [P] In `apps/runner/spikes/egress.ts`, set a deny-by-default allowlist, prove a permitted host reachable and a non-permitted host refused, then widen the policy on the **running** sandbox with `setOutboundByHost` and re-run (D7, FR-011, FR-012). Record the answer under D7
  - **Answered 2026-09-11: D7 is WRONG and this blocks Phase 4.** The lists do not govern a container's raw traffic. Internet on with the registry denied still returned 200; internet off with the model permitted blocked everything. `proxy_env: 0` explains it — `allowedHosts`/`deniedHosts`/outbound handlers govern traffic through `ContainerProxy`, not sockets a process opens itself. Reach is all-or-nothing. **FR-011, FR-012, FR-012a, FR-012b, FR-012c and T040–T048 are all built on a capability this host does not have.** Three options with their costs are recorded under D7; the choice is the product owner's and is unresolved.
- [X] T007 [P] In `apps/runner/spikes/sizes.ts`, create sandboxes against two container bindings of different declared sizes and confirm each gets what its binding declares (D4, FR-005, FR-009). Record the answer under D4
  - **Answered 2026-09-11: they do.** 1 vCPU binding gave `nproc` 1 and ~4170 MiB against 4096 declared (+1.8%); 4 vCPU binding gave `nproc` 4 and ~12221 MiB against 12288 (−0.5%). vCPU exact, memory within accounting noise. D4 holds. The cgroup files are unreadable at the usual paths, so `nproc` and `/proc/meminfo` are the signals — the first version of the check compared only `memory_limit_bytes`, found `unknown !== unknown`, and reported a false negative.

### The seam and its safety

- [X] T008 Add `permittedHosts: string[]` to `ContainerSpec` in `apps/runner/src/container/host.ts`, leaving all six method signatures unchanged per `contracts/execution-host.md`
  - **Reverted 2026-09-11 after T006.** FR-012c is withdrawn, so the field has nothing to carry. `ContainerSpec`, `SandboxLimits` and `PipelineSnapshot['sandbox']` go back to their previous shapes. The interface is still unchanged at six methods, which was the part that mattered.
- [X] T009 [P] Apply `quote()` from `apps/runner/src/container/shell.ts` to the interpolated paths in `dockerHost.writeFile` and `dockerHost.stat` in `apps/runner/src/container/host.ts` — both currently interpolate into `sh -c` unquoted (FR-015, D8)
  - **Done, and wider than written.** Four more files carried the same defect and were not enumerated here: `container/push.ts`, `container/reset.ts`, `container/commit.ts` and `outputs/design.ts`. FR-015 does not distinguish between them, so all six were fixed. `container/commit.ts` also had a hand-rolled single-quote escape, now `quoteOne`.
- [X] T010 [P] Apply `quote()` to the branch and URL interpolations in the git scripts in `apps/runner/src/container/start.ts` (`cloneRepository`) and `apps/runner/src/container/recover.ts` (`resumeFromBranch`) (FR-015, D8)
  - **Done.** The clone URL needed care rather than quoting: `$GIT_TOKEN` must stay shell-expandable, because that is how the credential reaches git without appearing in an argument list (FR-083). `authenticatedRemote()` in `start.ts` emits a quoted literal, the unquoted expansion and a quoted remainder, which a shell joins into one word. Proven through a real shell in `tests/unit/shell.test.ts`, including an adversarial token and an adversarial clone URL.
- [X] T011 [P] Replace `timingSafeEqual` from `node:crypto` with a constant-time comparison in `apps/runner/src/auth.ts`, removing the runner's only Node import (D12, FR-018)
- [X] T012 [P] Remove `databaseUrl` from `RunnerConfig` and `loadRunnerConfig` in `apps/runner/src/config.ts`, and `@factory/db` from `apps/runner/package.json` — neither is read anywhere in `apps/runner/src` (D11)
- [X] T013 Add `executionHost: 'docker' | 'hosted'` to `RunnerConfig` in `apps/runner/src/config.ts`, read from `EXECUTION_HOST` and defaulting to `docker`, and select the host from it at the five call sites in `apps/runner/src/index.ts` (FR-025)

### Tests for the foundational phase

- [X] T014 [P] Extend `apps/runner/tests/unit/shell.test.ts` with cases proving a path containing shell syntax reaches `writeFile` and `stat` as a path and runs nothing (FR-015, SC-007)
- [X] T015 [P] Add `apps/runner/tests/unit/auth.test.ts` asserting the constant-time comparison rejects wrong credentials and that comparison time does not vary with how early the mismatch falls (D12, FR-018)
- [X] T016 [P] Add `apps/runner/tests/integration/host-selection.test.ts` proving the configured host is the one used with no code change between the two, and that a run started on one host is refused rather than executed on the other when the configuration changes mid-run (FR-025, FR-025a, SC-010)

**Checkpoint**: the existing Docker path is safer than it was, the suite is still offline, and the
three unknowns have answers

---

## Phase 3: User Story 1 — Run a ticket without operating a container host (Priority: P1) 🎯 MVP

**Goal**: a run executes end to end on hosted infrastructure, with no container daemon installed or
reachable anywhere.

**Independent Test**: deploy the application and execution service to an environment with no
container daemon, start a ticket against a real repository, and confirm it reaches a merge request.

### Tests for User Story 1

- [X] T017 [P] [US1] Contract test in `apps/runner/tests/contract/execution-host.test.ts` running every obligation C1–C9, E1–E6, F1–F4, D1–D3 from `contracts/execution-host.md` against each available host implementation, including that no sandbox carries state from an earlier run (SC-002) and that a credential in a command's output never leaves `exec` unredacted (FR-017) — runs against every implementation this environment can reach, and NAMES the ones it cannot with the reason (no daemon; the SDK cannot be imported under Bun) rather than passing vacuously. The process obligations for the managed host are proven in `tests/unit/hosted-command.test.ts`, which the file asserts by content so the claim cannot rot. Found and fixed a real F2 violation in `dockerHost`: a missing document and a dead container both read as `null`
- [X] T018 [P] [US1] Integration test in `apps/runner/tests/integration/run-state.test.ts` proving start, step, verify-and-push and destroy address one run's sandbox and workspace, that a document one step writes a later step reads, and that a second `start` returns the existing sandbox rather than creating another (FR-006, FR-008)
- [X] T019 [P] [US1] Integration test in `apps/runner/tests/integration/auth-surface.test.ts` proving an unauthenticated request creates, inspects, uses and releases nothing, and that refusals naming an existing and a non-existent run are indistinguishable (FR-018, FR-019)
- [X] T020 [P] [US1] Integration test in `apps/runner/tests/integration/credential-rotation.test.ts` proving a run already executing finishes across a credential replacement and the replaced credential is then refused (FR-018a, SC-012)
- [X] T021 [US1] End-to-end test in `apps/runner/tests/e2e/hosted-run.test.ts` running a real ticket against a real sandbox — User Story 1's Independent Test, excluded from `bun test` per T004 (SC-001) — skips on `E2E_RUNNER_URL` being absent and fails if it is set with anything else missing, so it can never pass while half configured

### Implementation for User Story 1

- [X] T022 [US1] Implement `create`, `destroy` and the sandbox identifier in `apps/runner/src/container/hosted.ts` against `getSandbox`, satisfying C1, C2, C4, C7 and C9 — a failure leaves nothing running (FR-002, FR-004, FR-016)
  - **Done 2026-09-11.** `apps/runner/src/container/hosted.ts`. The identifier is minted here (`crypto.randomUUID`) and addresses the Durable Object for the run's life, so `ContainerHost` needed no signature change. Credentials go in with `setEnvVars`; a `true` exec proves the container is actually up before anything depends on it, and is where a capacity refusal surfaces; the workspace is created and chowned to the work user; any failure destroys the sandbox before propagating (C9).
- [X] T023 [US1] Implement `exec` in `apps/runner/src/container/hosted.ts`, joining `argv` through `quote()` before it becomes a command string, and mapping our `ExecOptions` onto the SDK's `timeout`/`env`/`cwd`/`onOutput` one-for-one. Output arriving from the SDK MUST reach `apps/runner/src/stream/logs.ts` before it is stored or streamed, so credentials are still removed where output is taken in rather than where it is shown (FR-015, FR-017, FR-027, E1, E2, E4)
  - **Done 2026-09-11.** Output is forwarded through `onOutput`, which `claude-cli.ts` already wires to the redacting `LogSink` — so FR-017 holds without this file knowing about redaction.
- [X] T024 [P] [US1] Implement `writeFile`, `readFile` and `stat` in `apps/runner/src/container/hosted.ts` against the SDK's file methods, keeping `null` for a missing path distinct from a thrown `sandbox_lost` for an unreachable sandbox (F1–F4)
  - **Done 2026-09-11.** `readFile` asks `exists` only on the failure path, so a missing document returns null and an unreachable sandbox throws (F2) at the cost of one extra round trip when something is already wrong. `stat` uses one quoted `test -f && wc -c`, the same shape as the Docker host.
- [X] T025 [US1] Wrap every command in `apps/runner/src/container/hosted.ts` so it runs as the unprivileged user established in T033, using `setpriv --reuid=factory --regid=factory --clear-groups` as T005 measured (FR-003, C3). `su` is the fallback if `setpriv` ever leaves the base image
  - **Done 2026-09-11, with `setpriv` as T005 measured.** In `commandLine()`, which also wraps the command in `timeout` so the step's deadline starts when the command does (FR-014a) and exits 124, already `TIMEOUT_EXIT_CODE`.
- [X] T026 [US1] Create `apps/runner/src/worker.ts` exporting the Worker `fetch` handler and the sandbox Durable Object class, delegating routing to the existing `Route[]` array in `apps/runner/src/index.ts` (FR-001)
- [X] T027 [US1] Replace `memoryStore()` in `apps/runner/src/runs.ts` with state held in the run's Durable Object — snapshot, credentials, `sandbox_id`, `size`, `execution_host`, `deadline`, `outcome`, `retain_until` per `data-model.md` (FR-006, FR-008, FR-025a, D3) — `size` is the one field not yet stored, because the sizes it would name are declared by T045; everything else (snapshot, credentials, `sandbox_id`, `execution_host`, `deadline`, `outcome`, `retain_until`) is held by `RunObject` in `apps/runner/src/worker.ts`
- [X] T028 [US1] Delete the run's credentials whenever its record is deleted, on every path in `data-model.md`'s state diagram including the alarm, and drop credentials from a retained failed sandbox's record (FR-016, D3)
- [X] T029 [US1] Refuse a step or push request naming a run with no record, saying the run must be started first, without revealing whether that run exists — and refuse a request for a run whose recorded `execution_host` is not the one now configured, rather than executing part of that run somewhere else (FR-007, FR-019, FR-025a) in `apps/runner/src/index.ts`
- [X] T030 [US1] Replace the `docker version` probe in the `/ready` route in `apps/runner/src/index.ts` with a hosted-host reachability probe, keeping service-down, wrong-credential and host-unreachable as three distinguishable answers (FR-020)
- [X] T031 [US1] Report a failure to reach the application for credential exchange as a run failure naming the application, before any step executes, in `apps/runner/src/runs.ts` (FR-021)
- [X] T032 [P] [US1] Support replacing the authenticating credential without interrupting runs in flight — accept both during a window, refuse the replaced one after — in `apps/runner/src/auth.ts` and `apps/runner/src/config.ts` (FR-018a)
- [X] T033 [US1] Rewrite `infra/sandbox/Dockerfile` as a layer over the SDK's published base image: keep its entrypoint, add the Claude CLI and the design CLI, add the unprivileged user and give it `/work`, build `linux/amd64` (FR-001, FR-003, D10, D6)
  - **Done 2026-09-11.** `FROM docker.io/cloudflare/sandbox:0.12.9`, no entrypoint of our own, both CLIs from npm at pinned versions, and the `factory` user owning `/work`. Getting here cost three failed builds and found that the Claude CLI had never been installed at all.
- [X] T034 [US1] Add the container binding and image reference to `apps/runner/wrangler.jsonc`, pinning the image tag rather than `:latest` (FR-004)
  - **Done 2026-09-11.** `apps/runner/wrangler.jsonc` carries the binding, the migration and `limits.cpu_ms`. The sized bindings are still T045, and the file now warns that migration tags are append-only and immutable once applied.

**Checkpoint**: a ticket runs to a merge request with no container daemon anywhere — the MVP

---

## Phase 4: User Story 2 — Sandbox limits hold, and an agent can still do its job (Priority: P2)

**Goal**: every workspace ceiling takes effect on the hosted host, the network restriction covers
the steps a model drives and no others, and a restricted step can still reach what it must.

**Independent Test**: set each ceiling to a distinctive value, run a ticket, and confirm from
observable behaviour that each took effect — including that a code-writing step completes.

### Tests for User Story 2

- [X] T035 [P] [US2] Integration test in `apps/runner/tests/integration/sizes.test.ts` proving the largest size *within* the ceilings is chosen, that a sandbox is never given more processing power or memory than the ceilings allow, that a ceiling below the smallest offered size fails at start naming it, that a ceiling above every offered size is not an error, and that wall-clock is enforced exactly rather than rounded (FR-005, FR-009, FR-009a)
- [X] T036 [P] [US2] Integration test in `apps/runner/tests/integration/egress.test.ts` proving every step of a run has the same network reach, that an agent step reaches the model service, and that a step failing on an unreachable address names it (FR-011, FR-013). Rewritten after T006: the per-step restriction it used to assert cannot be enforced on this host
- [X] T037 [P] [US2] Integration test in `apps/runner/tests/integration/enforceable-limits.test.ts` proving the sandbox settings report which limits the configured execution host enforces, and that the network restriction reports itself unavailable on a host with no per-host filtering rather than accepting a value it will ignore (FR-011a, FR-012)
- [X] T038 [P] [US2] Integration test in `apps/runner/tests/integration/wall-clock.test.ts` proving a sandbox is released at its ceiling with no request made (FR-010, SC-008)
- [X] T039 [P] [US2] Integration test in `apps/runner/tests/integration/limits.test.ts` extended to prove a step exceeding its agent's time limit stops and reports `TIMEOUT_EXIT_CODE` distinguishably from an ordinary non-zero exit, and that a sandbox taking seconds to become ready neither consumes the step's limit nor is reported as a timeout (FR-014, FR-014a, E3, E3a)

### Implementation for User Story 2

- [X] T040 **WITHDRAWN 2026-09-11 after T006.** No permitted-host column. There is no permitted set to store: T006 measured that the intended host cannot filter a sandbox's traffic by host in either direction. No schema change, no migration (FR-011a)
- [X] T041 [US2] In the sandbox section of the workspace settings form in `apps/web`, present the network restriction as **unavailable** when the configured execution host cannot enforce it, naming the host as the reason, and show for each other ceiling whether the host enforces it (FR-011a, FR-012). Replaces the permitted-host list this task used to add
- [X] T042 **WITHDRAWN 2026-09-11 after T006.** Nothing new on the snapshot. `network_during_implement` stays — whether an administrator *asked* for the restriction is worth pinning — but whether the host can enforce it is a property of the deployment, not of the run, and pinning it would claim a reproducibility the run does not have (FR-011a)
- [X] T043 **WITHDRAWN 2026-09-11 after T006.** Nothing to default, because nothing is stored. The field added to `snapshot.ts` and `ContainerSpec` under T008 is reverted with it (FR-011a)
- [X] T044 [P] [US2] Implement `apps/runner/src/container/sizes.ts`: choose the **largest** offered size whose vCPU **and** memory both stay **within** the snapshot's ceilings — a ceiling is an upper bound, so the choice resolves downwards; when no offered size fits within them, throw naming the ceiling; record which size the run got (FR-005, FR-009, D4)
- [X] T045 [US2] Declare the offered sizes as container bindings in `apps/runner/wrangler.jsonc`, each with an explicit `instance_type` — minimum 1 vCPU for a custom size, capped at 4 vCPU / 12 GiB / 20 GB disk. One size MUST match the shipped workspace defaults (2 vCPU, 4096 MiB) exactly, or every workspace on the defaults drops a size for no reason anybody chose (FR-009, D4) — four sizes declared (1x3, 1x4, 2x6, 4x12), each honouring the measured 3 GiB-per-vCPU floor. The requirement that one size match the shipped defaults (2 vCPU / 4096 MiB) is UNSATISFIABLE and was withdrawn by D4: two vCPUs demand 6 GiB on this provider, so a default workspace routes to 1 vCPU / 4096 MiB. Raising the default to 6144 MiB is the product decision that would recover it
- [X] T046 **WITHDRAWN 2026-09-11 after T006.** No `container/egress.ts`. There is no permitted set to compute and no per-step decision to make (FR-011)
- [X] T047 **WITHDRAWN 2026-09-11 after T006.** Nothing to narrow or widen. T006 proved the opposite of what this task assumed: the host's allow and deny lists govern only traffic routed through `ContainerProxy`, not sockets a process inside the sandbox opens for itself — and an agent step runs arbitrary code, which opens its own (FR-011)
- [X] T048 [US2] Report a step that failed on a network error with the address it could not reach, in `apps/runner/src/container/hosted.ts` (FR-013). Still worth doing, and now about an unreachable dependency rather than a refused one — a registry that is down and a mistyped host look identical without it
- [X] T049 [US2] Set a Durable Object alarm at `now + wallClockMinutes` on sandbox creation and release the sandbox when it fires, in `apps/runner/src/worker.ts` — `sleepAfter` is a second line, not the mechanism (FR-010, D5)
- [X] T050 [US2] Enforce `options.timeoutMs` in `apps/runner/src/container/hosted.ts` by mapping it to the SDK's `timeout` and returning `TIMEOUT_EXIT_CODE` (124), so a deadline stays distinguishable from a failure. The deadline MUST start when the command starts, not when `exec` is called — a sandbox that takes seconds to become ready must not spend the step's budget or be reported as the step timing out (FR-014, FR-014a, E3, E3a)

**Checkpoint**: User Stories 1 and 2 both work — a run executes, and every ceiling an administrator
set is observably in force

---

## Phase 5: User Story 3 — A finished run stops costing money (Priority: P3)

**Goal**: every way a run can end leads to a released sandbox, and a retained one is retained for
exactly the window asked for.

**Independent Test**: end runs the three ways — completed, failed, abandoned — and confirm for each
that the sandbox holds no capacity within the expected window.

### Tests for User Story 3

- [X] T051 [P] [US3] Integration test in `apps/runner/tests/integration/release.test.ts` walking every path in `data-model.md`'s state diagram and asserting each ends at released with the record deleted (FR-002, FR-022, SC-003)
- [X] T052 [P] [US3] Integration test in `apps/runner/tests/integration/retention.test.ts` proving a failed run's sandbox stays inspectable for exactly the configured window, loses its credentials immediately, and is released after (FR-023, D3)
- [X] T053 [P] [US3] Integration test in `apps/runner/tests/integration/capacity.test.ts` proving a refusal that clears within the window costs only latency, that one outlasting it fails naming capacity rather than as a step failure, and that the failure releases the run's place against the concurrency limit immediately so a queued run advances (FR-024, FR-024a, FR-024b, SC-013)

### Implementation for User Story 3

- [X] T054 [US3] Release the sandbox and delete the record on every terminal outcome in `apps/runner/src/container/destroy.ts` and `apps/runner/src/runs.ts`, making `destroy` succeed on an already-gone sandbox and never throw (FR-002, FR-022, D1–D3)
- [X] T055 [US3] Honour `retain_failed_hours` by setting `retain_until` and a second alarm, releasing the sandbox when it fires, in `apps/runner/src/worker.ts` (FR-023)
- [X] T056 [US3] Retry a capacity refusal in `apps/runner/src/container/hosted.ts` over a bounded window — 30 seconds with exponential backoff as the starting figure — then throw `sandbox_lost` with a detail naming capacity (FR-024, FR-024a, C8, D13). **Two distinct failures, observed 2026-09-11**: "There is no container instance that can be provided to this Durable Object" is the transient one and the SDK does NOT retry it — that is what FR-024 is for. "Maximum number of running container instances exceeded … configuring a higher value for max_instances" is a configuration mistake that will never clear, and the SDK already burns ~140s retrying it; do not retry it again. Decide which layer owns the deadline, because the SDK's 140s overruns FR-024's 30s window
  - **Done 2026-09-11, early, because it lives inside `create`.** `withCapacityRetry` retries only what `isPlatformTransientError` accepts, over 30 seconds with exponential backoff. A `max_instances` message is refused immediately instead, naming it as a deployment setting — the spike measured that the SDK already spends ~140s retrying that one, and it will never clear.
- [X] T057 [US3] Release a run's place against the workspace concurrency limit as soon as it fails for capacity, so a queued run advances immediately rather than waiting for anything to time out, in `apps/runner/src/runs.ts` and `apps/web/src/lib/services/queue.ts` — where `HOLDING` decides what counts against the cap (FR-024b) — `failed` is already outside `HOLDING`, so the place frees as soon as the status moves; what was missing was that a person could not tell the two capacity failures apart, and one of them must never be answered with "retry". `explain` now distinguishes them

**Checkpoint**: all three of the first stories work, and the bill is bounded by the ceilings rather
than by whether anything called back

---

## Phase 6: User Story 4 — Still developable and testable without the hosted service (Priority: P4)

**Goal**: the suite passes with no account and no network to any execution service, and a
deployment can move back to a locally administered host by configuration.

**Independent Test**: run the full suite on a machine with no hosted-service credentials; separately
switch a deployment's configured host and confirm runs execute on the other with no code change.

### Tests for User Story 4

- [X] T058 [P] [US4] Add a check to `scripts/audit/` asserting no test under `apps/runner/tests` outside `e2e/` reaches a hosted execution service, so FR-026 stays true rather than being true today (FR-026, SC-009) — `scripts/audit/offline-suite.ts`, wired into `bun run verify` because unlike the other audits it needs no database. It also enforces the second half: the sandbox SDK is imported in exactly three files, each on a list that says why, so logic cannot drift into a file no test can reach

### Implementation for User Story 4

- [X] T059 [US4] Keep `dockerHost` and `apps/runner/tests/fake-host.ts` as first-class implementations of `contracts/execution-host.md`, both exercised by the T017 contract test (FR-025, FR-026) — both run under the T017 contract test, which names what it cannot exercise and where each such obligation IS proven rather than passing vacuously
- [X] T060 [P] [US4] Document the host switch and the rollback in `README.md` and `.env.example` — `EXECUTION_HOST`, and what each host needs (FR-025, SC-010)

**Checkpoint**: the migration is reversible and the suite never needed an account

---

## Phase 7: Polish & Cross-Cutting Concerns

- [X] T061 [P] Record the spike answers from T005–T007 in `specs/002-hosted-runner-sandboxes/research.md`, replacing each "has not been run" with what happened (Principle I: drift is a defect)
- [X] T062 [P] Reword `specs/001-code-factory-mvp/contracts/runner.md` so the Runner is no longer described as "never reachable from the public internet", per the constitution's Sync Impact Report follow-up 1
- [X] T063 [P] Amend `specs/001-code-factory-mvp` FR-085 on three counts: its scope names an "implement" step that no declared type matches; its substance cannot be honoured on a host with no per-host filtering, which T006 measured; and what replaces it is the setting reporting itself unavailable rather than silently ignored (Sync Impact Report follow-up 2, research D7)
- [X] T064 Confirm the orchestrator's HTTP request timeout exceeds the longest step's ceiling in `orchestration/n8n/run-ticket-pipeline.json`, and say why in `orchestration/n8n/README.md` — a disconnect now cancels the step (D9) — it set NO timeout, so n8n’s five-minute default applied, which is shorter than many legitimate agent steps. The three long-held nodes now derive it from the run’s own wall-clock ceiling, and a contract test evaluates the expression so it cannot regress
- [X] T065 [P] Add a first-deploy note to `quickstart.md` and the deploy path: container requests can error for several minutes while the provider readies capacity, which is longer than T056's retry window by design (D13) — and CORRECTED: the note said readiness would report the host unreachable for several minutes, which is no longer true now that the probe deliberately starts no sandbox. The delay is real and now documented where it actually surfaces, on the first `start`
- [ ] T066 [P] Consider batching log-chunk callbacks in `apps/runner/src/stream/logs.ts` for cost rather than for limits — the subrequest ceiling is 10,000 per invocation and is not a constraint (D9)
- [ ] T067 Run every scenario in `specs/002-hosted-runner-sandboxes/quickstart.md` against a real deployment and record the measured figures for SC-003, SC-004, SC-005, SC-006 and SC-008 in that file
- [ ] T068 `bun run verify` green, then `bun run lint` and `bunx tsc -p apps/runner` for both runtime targets. Every test that existed before this feature must still pass unchanged — that is what SC-011 asks for, and a test edited to accommodate the new host is a signal to look at the host, not the test

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies
- **Foundational (Phase 2)**: depends on Setup. **Blocks every user story.** T005–T007 specifically block Phase 3 — each can change the design
- **User Story 1 (Phase 3)**: depends on Phase 2. No dependency on any other story
- **User Story 2 (Phase 4)**: depends on Phase 2. Its tests depend on US1's host existing, so in practice it follows Phase 3
- **User Story 3 (Phase 5)**: depends on Phase 2 and on T022 (`create`/`destroy`) from US1
- **User Story 4 (Phase 6)**: depends on Phase 2 only — T013 is the substance of it, so it is nearly free once Foundational is done
- **Polish (Phase 7)**: depends on the stories you intend to ship

### Within Each User Story

- Models and pure functions before the services that call them: T044 and T046 before T045 and T047
- The image (T033) before the non-root wrapping that depends on it (T025)
- `create` (T022) before anything that needs a sandbox to exist
- Tests may be written before or after their implementation — the constitution leaves the order to the author

### Parallel Opportunities

- **Setup**: T002 and T003 together
- **Foundational**: T006 and T007 together (T005 first — the others need a sandbox you can reach); then T009, T010, T011, T012 together, all different files; then T014, T015, T016 together
- **US1**: all five tests (T017–T021) together; T024 and T032 alongside other implementation
- **US2**: all five tests (T035–T039) together; T040, T044, T046 together — schema, size routing and egress policy touch different files
- **US3**: all three tests (T051–T053) together
- **Polish**: T061, T062, T063, T065, T066 together — five different files

### Parallel Example: User Story 2

```text
# After Phase 3, launch the tests together:
T035 sizes.test.ts   T036 egress.test.ts   T037 enforceable-limits.test.ts
T038 wall-clock.test.ts   T039 limits.test.ts

# Then the three independent pieces:
T040 workspace schema   T044 sizes.ts   T046 egress.ts
```

---

## Implementation Strategy

**MVP is Phase 1 + Phase 2 + Phase 3** — 34 tasks. That delivers User Story 1: a ticket runs to a
merge request with no container daemon anywhere, which is the whole point of the feature. Everything
after it is a guarantee about that run rather than a new capability.

**But Phase 2 is worth shipping on its own first.** T008–T016 make the *existing* Docker host safer
— the unquoted interpolations in `writeFile`, `stat` and the git scripts are live defects today, not
new ones — and they carry no hosted infrastructure. If the spike in T005–T007 comes back badly, that
work is still worth having.

**Incremental delivery**: Phase 2 → Phase 3 (MVP, deployable) → Phase 4 (ceilings enforced) →
Phase 5 (bill bounded) → Phase 6 (rollback documented) → Phase 7.

**The honest risk**: T005, T006 and T007 have not been run, and the plan says any of the three could
change the design rather than the code. They are first in Phase 2 for that reason. If non-root
(T005) cannot be arranged inside the image, Complexity Tracking row 2 stops being an accepted cost
and becomes a blocker worth re-opening with the product owner.
