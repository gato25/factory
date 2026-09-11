# Implementation Plan: Hosted Runner Sandboxes

**Branch**: `claude/spectkit-specify-cu28jm` | **Date**: 2026-09-11 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-hosted-runner-sandboxes/spec.md`

## Summary

Stop executing runs on a container daemon the team operates. The execution service becomes a Worker,
each run's sandbox becomes a Durable Object from the provider's sandbox SDK, and the six-method
`ContainerHost` interface the runner already has gains a second implementation beside `dockerHost`,
chosen by configuration so the local path and the whole existing test suite survive.

The port itself is small — `apps/runner/src` touches a runtime API in exactly three places. The work
is in the four things the move forces: sandbox size becomes deploy-time rather than per-run (D4), the
wall-clock ceiling needs a timer the host owns (D5), non-root has to be arranged inside the image and
comes out weaker than Docker's (D6), and every argument becomes shell syntax unless something quotes
it (D8). Two of those cost something real and are carried in Complexity Tracking rather than hidden.

## Technical Context

**Language/Version**: TypeScript 5.9.3. Two runtime targets for one service — Bun 1.4 for the local
execution path and the test suite, the Workers runtime for the hosted one.

**Primary Dependencies**: `@cloudflare/sandbox@0.12.9` (Worker + Durable Object sandbox SDK,
currently in beta and the version the sandbox base image must match), `wrangler` for deployment.
`@factory/shared` for the snapshot and callback types. No change to `apps/web`'s dependencies.

**Storage**: Durable Object storage, holding one run's pinned snapshot, resolved credentials and
sandbox identifier for the life of that run. No database: `@factory/db` and `DATABASE_URL` are
unused by the runner today and are removed (D11).

**Testing**: `bun test` against `apps/runner/tests/fake-host.ts`, unchanged and offline (FR-026).
One end-to-end test against a real sandbox, excluded from `bun test`, which is also User Story 1's
Independent Test. A spike ahead of implementation for the three decisions that have not been run.

**Target Platform**: Workers runtime for the execution service; `linux/amd64` for the sandbox image,
which is a layer over the SDK's published base rather than a `debian:bookworm-slim` of our own (D10).

**Project Type**: Monorepo. This feature changes `apps/runner` and `infra/sandbox`, and adds one
settings field reaching `apps/web` and `packages/db`.

**Performance Goals**: first output within 60 seconds of a run starting at the 95th percentile,
including after an idle period (SC-006). Cold start for a sandbox is reported at 1–3 seconds, so the
budget is dominated by clone and workspace preparation, not by the platform.

**Constraints**: sandbox capacity under $0.05 per completed run at default ceilings (SC-004), read
from the provider's own reporting since the product surfaces no figure. Instance size capped at
4 vCPU / 12 GiB / 20 GB disk, minimum 1 vCPU for a custom size. The orchestrator's HTTP request
timeout must exceed the longest step's ceiling, or a disconnect cancels the step (D9).

**Scale/Scope**: the workspace concurrency ceiling is the binding constraint, not the provider's —
account limits allow on the order of hundreds of concurrent sandboxes at this feature's defaults.
Roughly 20 source files in `apps/runner`, one Dockerfile, one Wrangler configuration, one settings
field.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design — see the bottom of this
file.* Constitution version 2.0.0, amended 2026-09-11 for this feature.

| Principle | How it is honoured, or why it does not apply |
|---|---|
| **I. Spec-Driven Delivery** (NON-NEGOTIABLE) | Every task traces to a numbered requirement in `spec.md` or to a decision in `research.md`; the requirement-to-phase map below exists so that an orphan is visible rather than discovered later. Four divergences are recorded in the spec's *Divergence and Accepted Risk*. One piece of implementation — `container/shell.ts` — was committed before this plan existed; it is picked up here as D8 and now traces to FR-015, and the commit message says it preceded its gate rather than implying it did not. |
| **II. Tested Before Merge** | D14. Every requirement ships with a test; `contracts/execution-host.md` gets a contract test; the end-to-end test runs against a real sandbox, which is what "real dependencies, not fakes" requires for behaviour spanning services. Test-first is not mandated. |
| **III. Pipelines Are Data** | FR-011a decides which steps the network restriction covers from a step's declared type alone — the constitution permits branching on declared type and condition, and forbids hard-coding step meaning. Adding a step type does not require rewriting the rule. No step order or agent behaviour is introduced anywhere in this feature. |
| **IV. Pinned Execution** | The snapshot already pins image, CPU, memory, wall-clock and network reach; FR-012c adds the permitted-host list to it. D4's size routing reads the snapshot's ceilings, never live workspace settings, so editing a workspace changes zero runs in flight. |
| **V. Least Privilege and Secret Hygiene** | **Partially violated — see Complexity Tracking rows 1 and 2.** Honoured: the execution service serves no user interface and holds no session, so it may hold execution rights at a public address under the amended principle; every operation is authenticated (FR-018); a refusal reveals nothing (FR-019); the credential is replaceable without interrupting work (FR-018a); credentials reach a sandbox as environment and never as files (FR-016); redaction happens at ingest (FR-017). Violated: the sandbox's control server runs as root (D6), and credentials now rest in Durable Object storage for a run's life rather than only in process memory (D3). |

**Architectural Invariants**

| Invariant | Status |
|---|---|
| One fresh sandbox per run: non-root, bounded, released when the run ends, never reused | **Partially violated.** Fresh, bounded, released and never reused all hold. Non-root holds for the agent's commands and not for the control server supervising them (D6, Complexity Tracking row 2). |
| A sandbox's lifetime ceiling MUST be enforced by the execution host itself | Honoured by D5 — a Durable Object alarm, not a caller. This is the invariant the constitution gained in the same amendment, and it is the reason `sleepAfter` is not the mechanism. |
| The application stores and renders; the orchestrator sequences and waits | Unchanged. The contract in `specs/001-code-factory-mvp/contracts/runner.md` keeps its shape (D9). |
| Every other invariant | Unaffected: this feature changes where a sandbox runs, not what a pipeline means, who merges, or how limits are counted. |

**Quality gates**

- Requirements checklist passes 16/16 — `checklists/requirements.md`, re-validated after clarification.
- Every requirement is assigned to a delivery phase below. No orphans.
- Every requirement cross-reference resolves: 47 identifiers defined in `spec.md`, and the two
  external references (`specs/001-code-factory-mvp` FR-082 and FR-085) both exist.
- Open questions: none. Five were asked and answered in the Clarifications session of 2026-09-11.

**Outstanding, and not blocking**: `specs/001-code-factory-mvp/contracts/runner.md` still states the
Runner "is never reachable from the public internet", and FR-085 still describes the network setting
as a yes/no scoped to an "implement" step. Both are recorded in the spec and in the constitution's
Sync Impact Report as follow-ups. They are documentation drift against a feature that has not
shipped, not a gate on planning it.

## Project Structure

### Documentation (this feature)

```text
specs/002-hosted-runner-sandboxes/
├── plan.md              # This file
├── research.md          # Phase 0 output — D1..D14
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   └── execution-host.md  # Phase 1 output
├── checklists/
│   └── requirements.md
├── spec.md
└── tasks.md             # Phase 2 — NOT created by /speckit-plan
```

### Source Code (repository root)

```text
apps/runner/
├── src/
│   ├── index.ts                 # Bun.serve → a Worker fetch handler; host chosen by config
│   ├── worker.ts                # NEW — Worker entry, Durable Object export, alarm handler
│   ├── config.ts                # databaseUrl removed; execution host selection added
│   ├── auth.ts                  # node:crypto dependency removed (D12)
│   ├── runs.ts                  # memoryStore() replaced by Durable Object state (D3)
│   └── container/
│       ├── host.ts              # ContainerHost unchanged; dockerHost stays beside the new one
│       ├── hosted.ts            # NEW — the sandbox SDK implementation (D2)
│       ├── sizes.ts             # NEW — workspace ceilings → the smallest sufficient size (D4)
│       ├── egress.ts            # NEW — permitted-host set, widened and narrowed per step (D7)
│       ├── shell.ts             # EXISTS — argument quoting (D8)
│       ├── start.ts             # git script arguments quoted (D8)
│       └── recover.ts           # git script arguments quoted (D8)
└── tests/
    ├── fake-host.ts             # unchanged — the whole suite keeps running offline
    ├── contract/                # + a contract test for the hosted host
    ├── integration/             # + size routing, egress switching, capacity retry, alarm release
    ├── unit/shell.test.ts       # EXISTS — nine tests
    └── e2e/                     # NEW — one real-sandbox run, excluded from `bun test`

infra/sandbox/
└── Dockerfile                   # FROM the SDK base image, + CLIs + unprivileged user (D10, D6)

apps/runner/wrangler.jsonc       # NEW — container bindings, one per offered size; limits.cpu_ms

apps/web/                        # the permitted-host list: settings form + snapshot resolution
packages/db/src/schema/workspace.ts   # the permitted-host list column
```

**Structure Decision**: the existing monorepo layout is kept and no new package is created. The
feature is contained in `apps/runner` plus one settings field that necessarily crosses into
`apps/web` and `packages/db`, because a workspace setting has to be stored and edited where every
other workspace setting is. `ContainerHost` remains the seam, so nothing outside
`apps/runner/src/container/` needs to know which host a deployment uses.

## Requirement → Delivery Phase

Constitution gate: every requirement is assigned before tasks are generated.

| Phase | What it delivers | Requirements |
|---|---|---|
| **A — Seam and safety** | Quoting applied at every shell boundary including the existing host's, dead configuration removed, constant-time comparison, host selection by configuration. Ships without any hosted infrastructure. | FR-015, FR-017, FR-025, FR-026 |
| **B — The hosted execution host** | The six methods against the SDK, size routing, capacity retry, egress switching, the release alarm, streaming. | FR-002, FR-003, FR-004, FR-005, FR-009, FR-010, FR-011, FR-011a, FR-012, FR-012b, FR-013, FR-014, FR-016, FR-022, FR-023, FR-024, FR-024a, FR-027 |
| **C — The Worker shape** | Fetch handler, Durable Object run state, readiness, authentication and credential replacement. | FR-001, FR-006, FR-007, FR-008, FR-018, FR-018a, FR-019, FR-020, FR-021, FR-024b |
| **D — Image and deployment** | Sandbox image over the SDK base, unprivileged user, Wrangler configuration and the offered sizes. | FR-001, FR-003, FR-004, FR-009 |
| **E — The permitted-host list** | Column, settings form, default entries, resolution into the snapshot. | FR-012a, FR-012b, FR-012c |
| **F — Validation** | Spike for D4/D6/D7, end-to-end run, quickstart, measurement of the success criteria. | SC-001 … SC-013 |

FR-001, FR-003, FR-004, FR-009 and FR-012b each appear in two phases because each needs both halves
— an image and a host, or a column and the host that reads it. Nothing is unassigned.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| **Sandbox size is per-deployment, not per-run** (D4) — FR-009 says the workspace's ceilings are applied to each sandbox; a small set of named sizes means they are honoured, not matched. A workspace asking for an unusual figure silently gets the next size up. | Processing power and memory come from `instance_type` in the Wrangler container configuration, which is attached to a container binding at deploy time. There is no runtime API to size a sandbox. | One binding per distinct workspace configuration would match exactly, but the number of bindings would grow with the number of workspaces, which is unbounded and redeploys on every settings change. Failing every workspace that does not match an offered size exactly was rejected as hostile for no safety gain. |
| **The sandbox's control server runs as root** (D6) — the constitution's invariant says non-root, and after this change that holds for the agent's commands but not for the process supervising them. | The SDK reaches a sandbox only through its control server, whose entrypoint the published image fixes and does not de-privilege. `ExecOptions` has no user field. | Replacing the entrypoint with our own non-root process means not using the SDK — which is the whole of D1 and D2. Running the agent as root instead was never considered. |
| **Credentials rest in Durable Object storage** (D3) — today they live only in process memory for a run's life. | The four operations are separate requests and a Worker isolate does not survive between them; FR-006 requires them to address one run's state. | Re-fetching credentials from the application on every step was considered and is a real alternative — it keeps nothing at rest, at the cost of a round trip per step and a second failure mode when the application is briefly unreachable mid-run. Deferred rather than rejected: if the spike shows storage encryption is not what we assume, this is the fallback. |
| **Two runtime targets for one service** — the runner must build and run under both Bun and the Workers runtime. | FR-025 and FR-026 require a deployment to switch hosts by configuration and the suite to run with no account. Both need the local path alive. | Deleting the local path removes the rollback and takes the test suite offline with it, which the requirements forbid. The cost is bounded because only three files touch a runtime API. |

## Constitution Check — re-evaluated after Phase 1 design

Nothing in `data-model.md` or `contracts/execution-host.md` changed the picture above. The contract
keeps `ContainerHost` at six methods with unchanged signatures, which is what holds Principle III's
and IV's answers steady and keeps the fake host valid. The two Principle V violations are unchanged
in scope: they are properties of the provider's image and of request-scoped isolates, not of
anything the design chose, and both are recorded above with what they cost.

One thing the design phase did change: D3's alternative — re-fetching credentials per step rather
than storing them — is written down as a fallback rather than dismissed, because the Phase 1 data
model made it clear how little else the Durable Object needs to hold.
