# Implementation Plan: Code Factory MVP

**Branch**: `claude/spectkit-specify-cu28jm` | **Feature**: `specs/001-code-factory-mvp` | **Date**: 2026-09-10 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/001-code-factory-mvp/spec.md` — 148 functional
requirements, 8 prioritised user stories, 19 success criteria.

## Summary

Code Factory turns a written ticket into a reviewable merge request. A person connects a repository,
describes a change, and a pipeline of AI agents writes a specification, decides whether the work
touches the interface, designs screens if it does, then plans, breaks down and implements the change
— pushing a branch and opening a merge request. Humans can pause the pipeline at any point to
approve what it has produced.

The build is a **SvelteKit application on Bun** whose data layer is remote functions, a **separate
Bun Runner service** that owns the container host and executes one step at a time, **Postgres** as
the single datastore, and **n8n** executing the pipeline and holding runs paused at review gates.
The web app never touches Docker; the Runner never renders a page; n8n holds no state of its own.

The load-bearing design decision is that **a pipeline is data, resolved once**: on run creation the
pipeline, its agents, their skills and every ceiling are flattened into one snapshot that nothing
re-reads. That is what lets a member edit their own agent without disturbing a run in flight
(FR-041, FR-044, SC-010), and it is why the orchestrator can stay generic — n8n iterates a list it
was handed rather than knowing anything about specifications, designs or plans.

## Technical Context

**Language/Version**: TypeScript on Bun (pin an exact Bun version in `.bun-version`; Bun is the
runtime, package manager and test runner)

**Primary Dependencies**: SvelteKit ≥ 2.27 with remote functions (experimental — requires
`kit.experimental.remoteFunctions` and `compilerOptions.experimental.async`), Svelte 5,
Drizzle ORM + `drizzle-kit`, n8n (external), Claude Code CLI and pen.dev CLI (inside the sandbox,
never in our services)

**Storage**: Postgres — the only datastore (15 tables). Documents, screens, log chunks, snapshots and audit
records all live here for the MVP; `LISTEN`/`NOTIFY` also carries live-update signals

**Testing**: `bun test` for unit and integration (integration runs against a real Postgres in a
container), Playwright for end-to-end — one spec per user story's Independent Test

**Target Platform**: Linux server. Browser target is a desktop browser; the approval decision is
expected to work on a phone (Assumptions), other small-screen layouts are out of scope

**Project Type**: Web application plus a privileged worker service, in a Bun-workspace monorepo

**Performance Goals**: run state visible to a viewer within 5s of changing (SC-004); the configured
number of concurrent runs execute without any run taking >20% longer than it would alone (SC-007);
sandbox released within 5 minutes of a run ending (SC-012)

**Constraints**: no credential may appear in retained output, documents, screens or merge request
descriptions (SC-011); no run may exceed its cost ceiling by more than 5% (SC-006); editing a
pipeline, agent or skill must change the behaviour of zero runs in flight (SC-010); the system
never merges a merge request

**Scale/Scope**: single workspace per deployment; 14 screens; 15 tables; 148 requirements delivered
across 8 phases; concurrency capped by workspace setting (the design shows 6)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

**The constitution is not ratified.** `.specify/memory/constitution.md` is the unmodified template —
16 unfilled placeholders, no principles, no governance rules. There are therefore **no gates to
enforce, and this check neither passes nor fails: it does not apply.** Recording that plainly is
better than inventing principles and calling them a gate.

In its absence the plan holds itself to the eight principles the repository's own product
specification states, which are repo-sourced rather than invented:

| Principle (source: root `spec.md` §1) | How this plan honours it | Where |
| --- | --- | --- |
| One ticket, one repo, one run at a time | `tickets.repository_id` required; a partial unique index permits at most one non-terminal run per ticket | `data-model.md` |
| Pipelines are data | Steps are rows in a snapshot, never code; the orchestrator branches on `type` only | D7, `contracts/orchestrator.md` |
| Agents are CLI runs | The Runner shells out; no agent harness of our own | D6 |
| n8n orchestrates, the app stays thin | The app stores and renders; n8n sequences and waits; no business logic in n8n | `contracts/orchestrator.md` |
| Docker isolates | One container per run, non-root, released at the end, never reused | FR-046, FR-047 |
| Files are the hand-off | Steps read and write files in the workspace; artifacts are captured copies | `contracts/runner.md` |
| Steps may be conditional | `condition` on every step, evaluated when reached; false ⇒ `skipped`, never failed | FR-032a–f, FR-110–112 |
| UI work is designed before it is built | Design step gated behind the classification, before Plan | FR-099–FR-109 |

**Recommendation, not a gate**: run `/speckit-constitution` before `/speckit-tasks`. The decisions
most exposed to a later ratification are testing discipline (D9 assumes tests alongside, not
test-first) and the two-service split (Complexity Tracking below). Ratifying afterwards may
invalidate them.

**Post-Phase-1 re-check**: unchanged — still not applicable. No design decision below conflicts
with the eight principles above; the two that add structure are justified in Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/001-code-factory-mvp/
├── spec.md              # Feature specification (148 requirements)
├── plan.md              # This file
├── research.md          # Phase 0 — decisions D1–D9, risks
├── data-model.md        # Phase 1 — 15 tables, state machines, invariants
├── quickstart.md        # Phase 1 — how to run it and prove it works
├── contracts/
│   ├── orchestrator.md  # App ⇄ n8n: trigger, callbacks, resume
│   ├── runner.md        # App/n8n ⇄ Runner: container and step execution
│   ├── step-engines.md  # Runner ⇄ Claude CLI and design CLI
│   └── ui-data.md       # Browser ⇄ app: remote function surface
├── checklists/
│   └── requirements.md  # Spec quality checklist (16/16 passing)
└── tasks.md             # Phase 2 — NOT created by /speckit-plan
```

### Source Code (repository root)

```text
apps/
├── web/                        # SvelteKit on Bun — the Factory App
│   ├── src/
│   │   ├── routes/
│   │   │   ├── (app)/          # The 14 screens, behind the shared frame
│   │   │   └── api/
│   │   │       ├── hooks/n8n/  # +server.ts — callback sink (external caller)
│   │   │       └── events/     # +server.ts — SSE per run, fed by LISTEN
│   │   ├── lib/
│   │   │   ├── remote/         # *.remote.ts — query/command/form, thin
│   │   │   ├── services/       # All business logic; remote functions call in
│   │   │   ├── snapshot/       # Pipeline resolution (D7)
│   │   │   ├── ledger/         # Cost accounting and ceiling enforcement
│   │   │   └── secrets/        # Encrypt at rest, redact at ingest
│   │   └── components/
│   └── tests/
├── runner/                     # Bun HTTP service — owns the container host
│   ├── src/
│   │   ├── container/          # Create, inject, clone, destroy
│   │   ├── engines/            # claude-cli.ts, design-cli.ts, shell.ts
│   │   ├── outputs/            # Required-file checks, artifact capture
│   │   └── stream/             # Log chunking and forwarding
│   └── tests/
packages/
├── db/                         # Drizzle schema + migrations (source of types)
└── shared/                     # Snapshot shape, callback vocabulary, step contract
orchestration/
└── n8n/                        # Exported workflow JSON, version-controlled
infra/
└── sandbox/                    # Runner image: git, both CLIs, toolchains
```

**Structure Decision**: A Bun-workspace monorepo with two deployables — `apps/web` and
`apps/runner` — over shared `packages/db` and `packages/shared`. The split follows privilege, not
layering: only the Runner can reach the container host, and it is the only component that runs work
measured in minutes. `packages/shared` exists so the pipeline snapshot and the callback vocabulary
have exactly one definition, since a mismatch between the app's idea of a step result and the
Runner's would corrupt runs silently. `orchestration/n8n` keeps the workflow in version control
rather than only in n8n's own database, so the generic workflow is reviewable.

## Delivery phases

The specify step scoped this as the whole product with the expectation that planning would slice it.
The eight user stories are already independently testable and priority-ordered, so they are the
slices — each ends at something demonstrable.

| Phase | Story | Delivers | Requirements |
| --- | --- | --- | --- |
| **A** | 1 (P1) | Foundation and the value path: schema, sign-in, repository connection with permission verification, ticket creation and its state vocabulary, snapshot resolution, n8n trigger, Runner and container, Claude CLI agent steps, branch push, merge request | FR-001–FR-022, FR-044–FR-055d, FR-065–FR-070a |
| **B** | 2 (P2) | Observability: `LISTEN`/`NOTIFY` + SSE, run page, live log, artifact viewers, dashboard, activity feed, tickets board with filters and per-ticket status | FR-023–FR-023a, FR-071–FR-078 |
| **C** | 3 (P3) | Review gates: pause, notify, the four decisions, resume, edit-and-continue, approval records, timeouts | FR-056–FR-064e |
| **D** | 4 (P4) | Recovery and safety: failure reasons, retry and edit-and-retry, attempt history, branch reset, budget ceilings, pause, cancel | FR-079–FR-098 |
| **E** | 5 (P5) | The design stage: classification, conditions, `skipped`, design engine, screens, gate 14, screens into later steps and the merge request | FR-032a–f, FR-099–FR-112, FR-019a, FR-067a, FR-075a |
| **F** | 6 (P6) | Pipeline builder: reorder, insert, conditions in words, versioning, save-time validation | FR-024–FR-032 |
| **G** | 7 (P7) | Agents and skills: editors, ownership, per-engine configuration, reset to default, usage counts | FR-033–FR-043a, FR-006–FR-006d |
| **H** | 8 (P8) | Workspace governance: settings, connection tests, members and roles, cost and concurrency ceilings, queue position | FR-004–FR-005a, FR-082, FR-085, FR-086 |

Phase A is the only phase that must be whole before any other starts. B through H are each shippable
on their own, and B before C is worth keeping — approving at a gate is unpleasant without the run
view that shows what you are approving.

## Complexity Tracking

> Two departures from a single project. Both are forced by the specification rather than chosen.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| A second deployable (`apps/runner`) rather than one application | It is the only component needing container-creation rights on the host, and it runs steps for minutes while streaming output | Routes inside the SvelteKit app would give the public-facing application container-host privileges, and a UI deploy would interrupt runs in flight. FR-046, FR-085 and FR-086 all assume something that owns container lifecycle independently of a web request |
| An external orchestrator (n8n) rather than our own job queue | FR-056 requires a run to hold at a gate for an unbounded time — days — and resume on a human decision; the product specification fixes n8n as the executor | A queue of our own would mean reimplementing durable waits, resume addressing and step retry. It is also explicitly not what was specified: "n8n orchestrates, the app stays thin" |
| Documents, screens and log chunks in Postgres rather than object storage | Keeps the MVP to one datastore, and artifact versioning (FR-054) is relational anyway | Object storage adds a second store and a second failure mode for the same guarantee. The contracts treat a log as an opaque addressable reference (research.md), so this is reversible without touching callers |
