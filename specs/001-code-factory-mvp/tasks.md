---

description: "Task list for Code Factory MVP"
---

# Tasks: Code Factory MVP

**Input**: Design documents from `specs/001-code-factory-mvp/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: **Required, not optional.** Constitution v1.0.0 Principle II — *Tested Before Merge* —
mandates that every functional requirement ship with tests, that the four interfaces in
`contracts/` have contract tests, that cross-service behaviour is tested against a real Postgres
rather than a fake, and that each user story's Independent Test exists as one end-to-end test.
The same principle leaves **the order of writing to the author**: test-first is encouraged and never
required, so no task below is gated on a test failing first.

**Organization**: Grouped by user story, in the priority order set by spec.md, matching the delivery
phases in plan.md. Each story phase is a complete, independently testable increment.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel — different files, no dependency on an incomplete task
- **[Story]**: `[US1]`–`[US8]`, mapping to the eight user stories in spec.md
- Requirement identifiers in parentheses trace each task to what authorises it (Principle I)

## Path Conventions

Per plan.md's Structure Decision — a Bun-workspace monorepo with two deployables:

- `apps/web/` — SvelteKit on Bun. `src/routes/` (screens and external routes), `src/lib/remote/`
  (`*.remote.ts`), `src/lib/services/` (all business logic), `src/components/`
- `apps/runner/` — Bun HTTP service owning the container host
- `packages/db/` — Drizzle schema and migrations · `packages/shared/` — cross-service types
- `orchestration/n8n/` — the workflow, in version control · `infra/sandbox/` — the run image

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Bring the monorepo into existence with the toolchain the plan specifies.

- [X] T001 Create the monorepo directory structure per plan.md's Structure Decision: `apps/web`, `apps/runner`, `packages/db`, `packages/shared`, `orchestration/n8n`, `infra/sandbox`
- [X] T002 Initialize the Bun workspace root in `package.json` with `workspaces: ["apps/*", "packages/*"]`, and pin the exact Bun version in `.bun-version`
- [X] T003 Initialize `apps/web` as a SvelteKit project on Svelte 5, pinning an **exact** SvelteKit version ≥ 2.27 (remote functions are experimental — research.md risk 1)
- [X] T004 Enable remote functions in `apps/web/svelte.config.js`: `kit.experimental.remoteFunctions: true` and `compilerOptions.experimental.async: true` — both are required, neither works alone
- [X] T005 [P] Initialize `apps/runner` as a Bun HTTP service with `apps/runner/src/index.ts` and a health route
- [X] T006 [P] Initialize `packages/db` with Drizzle ORM and `drizzle-kit`, and a `db:migrate` script at the workspace root
- [X] T007 [P] Initialize `packages/shared` as a types-only package consumed by both `apps/web` and `apps/runner`
- [X] T008 [P] Configure linting and formatting at the workspace root, applying to all workspaces in `biome.json`
- [X] T009 [P] Add `docker-compose.yml` at the repository root running Postgres 16 for local development and integration tests
- [X] T010 [P] Create `infra/sandbox/Dockerfile`: non-root user, git, the Claude CLI, the design CLI, and a `/work` workspace directory (FR-046)
- [X] T011 [P] Configure `bun test` for unit and integration suites in `bunfig.toml`
- [X] T012 [P] Configure Playwright in `apps/web/playwright.config.ts` for the eight end-to-end journeys

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The schema, the shared contracts, sign-in and the app frame. Every user story needs
these.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

### Schema — the 15 tables from data-model.md

Constraints below are quoted from data-model.md and are not left to implementation-time discretion.
All money columns are `numeric(10,4)` — never a float, because ceilings are enforced against them.

- [X] T013 [P] Define `workspaces` and `users` in `packages/db/src/schema/workspace.ts` — `users.role` is an enum of exactly `admin` | `member`, recording which role each user holds (FR-003); `users.password_hash` is nullable (null for provider-only accounts); workspace ceiling columns are `numeric(10,4)`
- [X] T014 [P] Define `credentials` and `repositories` in `packages/db/src/schema/repository.ts` — `credentials.kind` enum `git` | `model` | `design`; `repositories.provider` is an enum of **exactly** `gitlab` | `github` with no third value (FR-014a, FR-014b); `repositories.status` enum `connected` | `credential_expired` | `error`
- [X] T015 [P] Define `pipelines` and `pipeline_versions` in `packages/db/src/schema/pipeline.ts` — `pipeline_versions` is unique on `(pipeline_id, version)` and **insert-only, with no update path** (FR-027); `steps` is `jsonb`
- [X] T016 [P] Define `agents`, `skills` and `agent_skills` in `packages/db/src/schema/agent.ts` — `agents.engine` enum `claude_cli` | `design_cli`; `agents.owner_id` nullable (null for shipped defaults, FR-006b); `agent_skills` primary key is `(agent_id, skill_id)` (FR-042); `skills.name` unique
- [X] T017 [P] Define `tickets` in `packages/db/src/schema/ticket.ts` — `has_ui` boolean **nullable**, null until the specification step decides (FR-099); `ui_rationale` text; `classification_missing` boolean default false (FR-102); `reference` unique
- [X] T018 [P] Define `runs` and `step_results` in `packages/db/src/schema/run.ts` — `runs` unique on `(ticket_id, attempt)` (FR-045); `step_results` unique on `(run_id, step_index)` as the idempotency key (FR-095); step status enum carries `pending` | `running` | `done` | `failed` | `skipped` as **five distinguishable values** — `skipped` is neither a kind of `done` nor a flag on it (FR-112); `condition_not_met` text, null unless skipped
- [X] T019 [P] Define `artifacts`, `approvals` and `log_chunks` in `packages/db/src/schema/artifact.ts` — `artifacts.kind` enum `document` | `design_file` | `screen` | `commits` | `merge_request`, unique on `(run_id, path, version)`, `screen_name` null unless `kind = 'screen'`; `approvals` unique on `(run_id, step_index)` so a second decider's insert fails (FR-064a); `log_chunks` unique on `(run_id, step_index, seq)` (FR-076)
- [X] T020 Add the partial unique index on `runs(ticket_id)` where status is non-terminal, permitting at most one active run per ticket in `packages/db/src/schema/run.ts` (FR-020)
- [X] T021 Generate and apply the initial migration with `drizzle-kit`, and verify every invariant in data-model.md's "Invariants the database enforces" table is present

### Shared contracts

- [X] T022 [P] Define the pipeline snapshot type in `packages/shared/src/snapshot.ts` — the step shape from data-model.md: `type`, `condition` (defaulting to `always`), `agent_id`, `output_files`, `design`, `approvers`, `timeout_hours`, `on_timeout`, `command`, `channel`, `template`
- [X] T023 [P] Define the callback vocabulary in `packages/shared/src/callbacks.ts` — all eleven events from `contracts/orchestrator.md` §3, each carrying `run_id`, `attempt`, `step_index`, `event`
- [X] T024 [P] Define the step-engine interface in `packages/shared/src/step.ts` — `StepEngine`, `StepContext`, `StepOutcome` per `contracts/step-engines.md`
- [X] T025 [P] Contract test asserting the snapshot and callback types in `packages/shared` are the only definitions, in `packages/shared/tests/contracts.test.ts` — a divergence between the app's and the Runner's idea of a step result corrupts runs silently (plan.md)

### Cross-cutting services

- [X] T026 Implement credential encryption at rest in `apps/web/src/lib/secrets/store.ts` — encrypted with a key held only by the application, and **never readable back in full through any interface** (FR-011, Principle V)
- [X] T027 [P] Implement credential redaction in `packages/shared/src/redact.ts`, applied **where output is ingested, not where it is displayed**, so a later viewer change cannot un-redact stored history (FR-084, Principle V)
- [X] T028 [P] Integration test for redaction at ingest in `packages/shared/tests/redact.test.ts` — assert a credential written by a step never reaches `log_chunks`, `artifacts`, or a merge request body (SC-011)
- [X] T029 Implement sign-in with GitLab, GitHub and email-with-password, plus session handling, in `apps/web/src/lib/services/auth.ts` (FR-001)
- [X] T030 Create the user record on first successful sign-in, requiring no connected repository (FR-002), in `apps/web/src/lib/services/auth.ts`
- [X] T031 Implement the authorization helper in `apps/web/src/lib/services/authz.ts` with exactly three rules from `contracts/ui-data.md`: administrator-only, owner-or-administrator, and gate-approvers — checked **inside** each remote function, never in a component (FR-004, FR-006c, FR-064)
- [X] T032 [P] Integration test for the three authorization rules in `apps/web/tests/integration/authz.test.ts` — a caller who may read but not change sees the object and no action
- [X] T033 [P] Build the shared application frame — left sidebar and top bar — in `apps/web/src/routes/(app)/+layout.svelte` (spec.md §4 frame)
- [X] T034 [P] Implement error handling and structured logging in `apps/web/src/lib/errors.ts` and `apps/runner/src/errors.ts`
- [X] T035 [P] Implement environment configuration loading with validation in `apps/web/src/lib/config.ts` and `apps/runner/src/config.ts`
- [X] T036 [P] Implement the login screen (00) in `apps/web/src/routes/login/+page.svelte` with the three sign-in paths
- [X] T037 Implement authenticated Runner calls in `apps/runner/src/auth.ts` — the Runner is never reachable from the public internet and authenticates per run (`contracts/runner.md`)

**Checkpoint**: schema migrated, contracts shared, sign-in working, frame rendering. User story work
can begin.

---

## Phase 3: User Story 1 — From ticket to merge request (Priority: P1) 🎯 MVP

**Goal**: A developer connects a repository, writes a ticket, and gets an open merge request without
further involvement.

**Independent Test**: Connect a real repository with a test suite, add a shell step running that
suite after the implementing step, create a ticket for a small self-contained change with two
acceptance criteria, and verify a merge request appears whose commits satisfy the criteria and leave
the suite passing (quickstart.md scenario A).

### Tests for User Story 1

- [X] T038 [P] [US1] Contract test for the trigger payload in `apps/web/tests/contract/trigger.test.ts` — asserts the body is the fully resolved snapshot and that no field requires a later lookup (`contracts/orchestrator.md` §1)
- [X] T039 [P] [US1] Contract test for all eleven callback events in `apps/web/tests/contract/callbacks.test.ts` (`contracts/orchestrator.md` §3)
- [X] T040 [P] [US1] Contract test for the four Runner operations in `apps/runner/tests/contract/api.test.ts` (`contracts/runner.md`)
- [X] T041 [P] [US1] Contract test for the step-engine interface in `apps/runner/tests/contract/step-engines.test.ts` — every engine satisfies one `StepEngine` contract: streams output while running, reports cost from the engine's own usage, is killed at a ceiling, and retains partial output on failure (`contracts/step-engines.md`, Constitution Principle II)
- [X] T042 [P] [US1] Contract test for the remote-function surface in `apps/web/tests/contract/ui-data.test.ts` — queries, commands and forms carry the shapes in `contracts/ui-data.md`, and every one checks authorisation **inside** the function rather than in a component (`contracts/ui-data.md`, Constitution Principle II)
- [X] T043 [P] [US1] Integration test for snapshot resolution in `apps/web/tests/integration/snapshot.test.ts` — a snapshot must be complete, and editing an agent afterwards must not change it (FR-044, SC-010)
- [X] T044 [P] [US1] Integration test for callback idempotency in `apps/web/tests/integration/idempotency.test.ts` — a repeated event creates no second `step_results` row and does not advance the run twice (FR-095)
- [X] T045 [P] [US1] Integration test for required-output checking in `apps/runner/tests/integration/outputs.test.ts` — a missing **or empty** declared file fails the step (FR-051)
- [X] T046 [P] [US1] End-to-end test of the whole journey in `apps/web/tests/e2e/ticket-to-mr.spec.ts`, including the three refusals from quickstart.md scenario A: a token missing a permission names which one (FR-009), a non-GitLab/GitHub repository is refused with a reason (FR-014b), and a step with a missing document opens no merge request (FR-055)

### Shipped defaults

- [X] T047 [US1] Ship working default agents covering specification, interface design, planning, task breakdown and implementation, so a workspace produces a merge request with nothing configured in `apps/web/src/lib/services/agent-defaults.ts` (FR-033)
- [X] T048 [US1] Ship at least three default pipelines differing in how much human oversight they impose — none of them carrying a verification command, because that command is repository-specific (FR-034a) — in `apps/web/src/lib/services/pipeline-defaults.ts` (FR-034)

### Repositories

- [X] T049 [US1] Implement repository connection in `apps/web/src/lib/services/repository.ts` — verify the credential can read the repository, create branches **and** open merge requests before saving (FR-008)
- [X] T050 [US1] Name the specific missing permission when verification fails, rather than reporting a generic failure, in `apps/web/src/lib/services/repository.ts` (FR-009)
- [X] T051 [US1] Refuse a repository not hosted on GitLab.com or GitHub.com, with a stated reason in `apps/web/src/lib/services/repository.ts` (FR-014a, FR-014b)
- [X] T052 [P] [US1] Remote functions for repositories in `apps/web/src/lib/remote/repositories.remote.ts` — a `query` for the list, a `form` for connecting, `command`s for replacing a credential and disconnecting (FR-014); thin, delegating to the service (research.md risk 1)
- [X] T053 [P] [US1] Repositories screen (02) in `apps/web/src/routes/(app)/repositories/+page.svelte` — provider, default branch, default pipeline, running and done counts, connection usability (FR-012)
- [X] T054 [P] [US1] Connect Repository modal (03) in `apps/web/src/components/ConnectRepository.svelte` — provider choice limited to GitLab and GitHub, address, credential, default pipeline, stating the required permissions at the point the credential is entered (FR-007, FR-010)
- [X] T055 [US1] Block new runs on a repository whose credential is no longer valid, and show that state on the repository in `apps/web/src/lib/services/repository.ts` (FR-013)

### Tickets

- [X] T056 [US1] Implement ticket creation in `apps/web/src/lib/services/ticket.ts` — repository and title required, description and acceptance criteria may be empty (FR-015, FR-016)
- [X] T057 [US1] Derive the ticket reference and the branch name from the reference and title in `apps/web/src/lib/services/ticket.ts` (FR-021)
- [X] T058 [US1] Implement the ticket state vocabulary — not started, waiting to start, running, waiting for approval, done, failed, cancelled — in `apps/web/src/lib/services/ticket.ts` (FR-022)
- [X] T059 [US1] Default the pipeline choice to the repository's default while allowing the author to change it in `apps/web/src/lib/services/ticket.ts` (FR-018)
- [X] T060 [US1] Compute the pre-flight preview — every step with its agent and model, plus a cost and duration estimate derived from comparable past runs — in `apps/web/src/lib/services/estimate.ts` (FR-019); estimates are explicitly not commitments
- [X] T061 [P] [US1] Remote functions for tickets in `apps/web/src/lib/remote/tickets.remote.ts` — a `form` for create-and-start and for save-as-draft (FR-017), and a `query` for one ticket
- [X] T062 [P] [US1] Create Ticket screen (05) in `apps/web/src/routes/(app)/tickets/new/+page.svelte` with the "What will happen" panel and the footer estimate

### Run orchestration (app side)

- [X] T063 [US1] Implement snapshot resolution in `apps/web/src/lib/snapshot/resolve.ts` — flatten the pipeline version, every agent, every skill and every ceiling into one document, consulted **once** (FR-044, Principle IV)
- [X] T064 [US1] Resolve ceilings as `least(agent, pipeline, workspace)` at snapshot time and store them on the run, so a member-set limit cannot raise consumption in `apps/web/src/lib/snapshot/ceilings.ts` (FR-079a)
- [X] T065 [US1] Create the run with `attempt = previous + 1` and at most one active run per ticket in `apps/web/src/lib/services/run.ts` (FR-020, FR-045)
- [X] T066 [US1] Post the trigger to the orchestrator, retrying with increasing delays and keeping the ticket queued while showing the author it has not begun (FR-094), in `apps/web/src/lib/services/orchestrator.ts`
- [X] T067 [US1] Implement the callback sink at `apps/web/src/routes/api/hooks/n8n/+server.ts` — authenticated with the run secret, rejecting unauthenticated calls without revealing whether the run exists, and applying every event idempotently on `(run_id, step_index)` (FR-095)
- [X] T068 [US1] Record step results — outcome, timings, cost, summary — and add cost to the run ledger in `apps/web/src/lib/ledger/record.ts` (FR-052, FR-108)
- [X] T069 [US1] Capture produced files as versioned artifacts with the correct `kind`, additively so no version is overwritten in `apps/web/src/lib/services/artifact.ts` (FR-053, FR-054)

### Runner and engines

- [X] T070 [US1] Implement container start in `apps/runner/src/container/start.ts` — one fresh non-root container per run with the configured ceilings, workspace at `/work`, never reused (FR-046, FR-047). The workspace persists across every step of the run, which is how work is handed between them — each step reads what earlier steps wrote (FR-050)
- [X] T071 [US1] Inject credentials as environment at container start, never writing them into the workspace, in `apps/runner/src/container/secrets.ts` (FR-083, Principle V)
- [X] T072 [US1] Clone the repository at its **current** default branch and check out the run branch in `apps/runner/src/container/clone.ts` (FR-048, FR-065)
- [X] T073 [US1] Write each agent's system prompt and each attached skill into the workspace, substituting the run's values for prompt variables, in `apps/runner/src/container/config.ts` (FR-037)
- [X] T074 [US1] Implement the `claude_cli` engine in `apps/runner/src/engines/claude-cli.ts` — headless invocation with structured output, using the exact model identifiers `claude-sonnet-5` and `claude-opus-5` with **no date suffixes** (`contracts/step-engines.md`); a tool the agent has not been permitted must not be reachable (FR-039)
- [X] T075 [US1] Implement the `shell` engine in `apps/runner/src/engines/shell.ts` — a non-zero exit fails the step and the run, with the full output retained, and **no preceding agent step re-run automatically** (FR-055c, FR-055d)
- [X] T076 [US1] Implement required-output checking in `apps/runner/src/outputs/check.ts` — every `output_files` entry must exist and be non-empty (FR-051)
- [X] T077 [US1] Stream stdout and stderr as `log_chunk` callbacks with credentials redacted at ingest, in `apps/runner/src/stream/logs.ts` (FR-076)
- [X] T078 [US1] Report cost from the engine's own reported usage, never from an estimate of our own, in `apps/runner/src/engines/usage.ts` (FR-108, D6)
- [X] T079 [US1] Implement branch push in `apps/runner/src/container/push.ts`, running **no tests of its own** — verification exists only as a shell step an author added (FR-055a, FR-055b)
- [X] T080 [US1] Report the branch-pushed-but-merge-request-failed case distinguishably from total failure in `apps/runner/src/container/push.ts` (FR-098)
- [X] T081 [US1] Implement container destruction in `apps/runner/src/container/destroy.ts`, within five minutes of the run ending (FR-086, SC-012)

### Orchestration workflow

- [X] T082 [US1] Build the generic workflow in `orchestration/n8n/run-ticket-pipeline.json` — webhook, Runner start, the ordered step loop branching **only** on `type`, the failure path, and container destruction (FR-049, Principle III)
- [X] T083 [US1] Open the merge request from the run branch into the repository's current default branch, in the workflow's merge-request node in `orchestration/n8n/run-ticket-pipeline.json` (FR-065)
- [X] T084 [US1] Compose the merge request body in `apps/web/src/lib/services/merge-request.ts` — ticket description, acceptance criteria as a checklist, the specification and plan, cost and duration, and a link back to the ticket (FR-066, FR-067)
- [X] T085 [US1] Label the merge request so system-produced work and the pipeline that produced it are identifiable in `apps/web/src/lib/services/merge-request.ts` (FR-068)
- [X] T086 [US1] Store the merge request address on the ticket, mark it done, record final cost, and add the outcome to the activity feed (FR-069, FR-070a); the system never merges in `apps/web/src/lib/services/run.ts` (FR-070)

**Checkpoint**: User Story 1 is fully functional. A ticket becomes an open merge request. **This is
the MVP** — deployable and demonstrable on its own.

---

## Phase 4: User Story 2 — Watching a run and knowing where it is (Priority: P2)

**Goal**: Anyone can see which step is executing, what has been spent, and what the last agent
produced, without asking anyone or reloading.

**Independent Test**: Start a run and, from the ticket page alone, correctly state at any moment
which step is executing, what the run has cost, and what the last agent wrote — then confirm each
claim against the produced documents when the run ends.

### Tests for User Story 2

- [X] T087 [P] [US2] Integration test for `LISTEN`/`NOTIFY` fan-out in `apps/web/tests/integration/events.test.ts` — a callback write reaches a subscribed stream
- [X] T088 [P] [US2] Integration test asserting displayed state is never more than 5 seconds behind actual state in `apps/web/tests/integration/staleness.test.ts` (SC-004)
- [X] T089 [P] [US2] End-to-end test in `apps/web/tests/e2e/watch-run.spec.ts` — step states, progressive log output, artifact reading, and a dashboard that updates as runs progress (quickstart.md scenario B)

### Implementation for User Story 2

- [X] T090 [US2] Emit a Postgres `NOTIFY` on a run-scoped channel from every write that changes a run, in `apps/web/src/lib/services/notify.ts` (D4)
- [X] T091 [US2] Implement the server-sent-events route at `apps/web/src/routes/api/events/[run_id]/+server.ts` — subscribe with `LISTEN`, emit change signals, and carry log chunks as payloads rather than signals (FR-074, FR-076)
- [X] T092 [P] [US2] Client subscription that refreshes the affected `query` on a change signal, in `apps/web/src/lib/events/subscribe.ts`
- [X] T093 [P] [US2] Ticket Run screen (06) in `apps/web/src/routes/(app)/tickets/[id]/+page.svelte` — header with branch, creator, start time and cost so far, plus Pause and Cancel
- [X] T094 [P] [US2] Step tracker component in `apps/web/src/components/StepTracker.svelte` — each step's state, duration and cost, and total spent against the run's ceiling (FR-075)
- [X] T095 [P] [US2] Live log component in `apps/web/src/components/LiveLog.svelte` — streamed output with the exact command shown in the header (FR-076)
- [X] T096 [P] [US2] Artifact viewers in `apps/web/src/components/ArtifactViewer.svelte` — documents, the commit list and the merge request opened and read in the application (FR-077)
- [X] T097 [P] [US2] Run details panel in `apps/web/src/components/RunDetails.svelte` — pipeline and version, attempt, and a reference identifying the execution in the orchestrator (FR-078)
- [X] T098 [P] [US2] Dashboard screen (01) in `apps/web/src/routes/(app)/+page.svelte` — four stat tiles: connected repositories, tickets running, awaiting approval, merge requests this week (FR-071)
- [X] T099 [P] [US2] Active runs list on the dashboard with ticket, repository, pipeline progress and status, updating as runs progress in `apps/web/src/components/ActiveRuns.svelte` (FR-072, FR-074)
- [X] T100 [P] [US2] Activity feed in `apps/web/src/components/ActivityFeed.svelte` — merge requests merged, runs completed, runs failed, gates reached, tickets created (FR-073)
- [X] T101 [P] [US2] Tickets Board screen (04) in `apps/web/src/routes/(app)/tickets/+page.svelte` — filters by repository, pipeline and author, board and list views, grouped by state (FR-023)
- [X] T102 [US2] Per-ticket status strip in `apps/web/src/components/TicketCard.svelte` — whichever applies: the running step and its position, the gate awaiting approval, the merge request opened, or the failure reason (FR-023a)

**Checkpoint**: Stories 1 and 2 both work. A run is now observable while it happens.

---

## Phase 5: User Story 3 — Approving before the work continues (Priority: P3)

**Goal**: A human decides at a gate before the pipeline continues, and can approve, edit, send back
with feedback, or cancel.

**Independent Test**: Add a gate after the planning step and exercise each of the three decisions in
separate runs — approve continues, edit carries the edited document forward, requested changes
re-runs the previous step with the feedback and returns to the same gate.

### Tests for User Story 3

- [ ] T103 [P] [US3] Contract test for the resume hand-off in `apps/web/tests/contract/resume.test.ts` — all four decisions (`contracts/orchestrator.md` §4)
- [ ] T104 [P] [US3] Integration test asserting one decision per gate in `apps/web/tests/integration/approval.test.ts` — the second decider's insert fails and they are told the gate is already decided (FR-064a)
- [ ] T105 [P] [US3] Integration test for each timeout behaviour — wait indefinitely, continue, fail — in `apps/web/tests/integration/gate-timeout.test.ts` (FR-064b)
- [ ] T106 [P] [US3] End-to-end test in `apps/web/tests/e2e/approve.spec.ts` covering all three decisions plus a non-approver who can read everything and decide nothing (quickstart.md scenario C)

### Implementation for User Story 3

- [ ] T107 [US3] Add the checkpoint branch to the workflow in `orchestration/n8n/run-ticket-pipeline.json` — post `waiting_approval` carrying the resume address, then enter a wait that can hold indefinitely (FR-056)
- [ ] T108 [US3] Store `resume_url` on the run when `waiting_approval` arrives, so a gate stays drivable even if the orchestrator execution is lost (research.md risk 2)
- [ ] T109 [US3] Set both run and ticket to waiting-for-approval while paused, in `apps/web/src/lib/services/gate.ts` (FR-057)
- [ ] T110 [US3] Notify the gate's configured approvers when a run reaches it, in `apps/web/src/lib/services/notify.ts` (FR-058)
- [ ] T111 [P] [US3] Surface every run awaiting approval on the dashboard as its most prominent call to action, and in the tickets view grouped by that state in `apps/web/src/components/ApprovalPanel.svelte` (FR-059)
- [ ] T112 [US3] Implement the four decisions in `apps/web/src/lib/services/gate.ts` — approve and continue, edit a document and continue, request changes with feedback, cancel (FR-060)
- [ ] T113 [US3] Continue at the next step on approval, and re-run the **preceding** step with the feedback before returning to the same gate on a change request in `apps/web/src/lib/services/gate.ts` (FR-061)
- [ ] T114 [US3] Make change-request feedback available to the agent that runs again because of it in `apps/runner/src/container/config.ts` (FR-038)
- [ ] T115 [US3] Write a human's edit as a new artifact version and carry it into every subsequent step as the version they read, retaining the previous one in `apps/web/src/lib/services/artifact.ts` (FR-062, FR-054)
- [ ] T116 [US3] Record every decision with who decided, what they decided, any feedback, and when — including a gate that continued or failed without a human in `apps/web/src/lib/services/gate.ts` (FR-063, FR-064b)
- [ ] T117 [US3] Restrict deciding to the gate's configured approvers — anyone in the workspace, the ticket's author, or a named list — while letting anyone read the ticket and its artifacts in `apps/web/src/lib/services/authz.ts` (FR-064)
- [ ] T118 [P] [US3] Remote functions for gate decisions in `apps/web/src/lib/remote/approvals.remote.ts` — a `form` per decision so the buttons work without JavaScript, invalidating the run query on success
- [ ] T119 [P] [US3] Approval Checkpoint screen (07) in `apps/web/src/routes/(app)/tickets/[id]/approve/+page.svelte` — the banner, every document produced so far, and a chronological record of the run (FR-064c)
- [ ] T120 [US3] Release the sandbox and leave the branch intact when a run is cancelled at a gate in `apps/web/src/lib/services/gate.ts` (FR-064c, FR-097)

**Checkpoint**: Stories 1–3 work. Oversight can now be inserted anywhere in a pipeline.

---

## Phase 6: User Story 4 — Recovering from a failed run (Priority: P4)

**Goal**: A failure is legible and recoverable without re-creating the ticket.

**Independent Test**: Force a failure two ways — a ticket whose criteria cannot be met, and a
deliberately low cost ceiling — confirm the reason is legible without reading raw output, then retry
and confirm a second attempt exists while the first remains readable.

### Tests for User Story 4

- [ ] T121 [P] [US4] Integration test for ceiling enforcement in `apps/web/tests/integration/ceilings.test.ts` — no run exceeds its cost ceiling by more than 5% (SC-006)
- [ ] T122 [P] [US4] Integration test for attempt history in `apps/web/tests/integration/retry.test.ts` — a new attempt keeps the previous attempt's records, output and documents (FR-090)
- [ ] T123 [P] [US4] Integration test for sandbox loss mid-step in `apps/runner/tests/integration/recovery.test.ts` — attempted once more from the last commit, then failed (FR-093)
- [ ] T124 [P] [US4] End-to-end test in `apps/web/tests/e2e/recover.spec.ts` — both forced failures, retry, and edit-and-retry in at most two interactions (quickstart.md scenario D, SC-009)

### Implementation for User Story 4

- [ ] T125 [US4] Enforce the run's cost and time ceilings in `apps/web/src/lib/ledger/enforce.ts` (FR-079)
- [ ] T126 [US4] Enforce each agent's own cost, time and turn limits within a step, in `apps/runner/src/engines/limits.ts` (FR-080)
- [ ] T127 [US4] Kill the work and fail the run when a ceiling is reached, naming the ceiling as the reason and showing what was consumed in `apps/web/src/lib/ledger/enforce.ts` (FR-081)
- [ ] T128 [US4] Present a failed run's failing step and a reason in language that does not require reading raw output, in `apps/web/src/lib/services/failure.ts` (FR-087, SC-008)
- [ ] T129 [P] [US4] Remote functions for retry, edit-and-retry, pause and cancel in `apps/web/src/lib/remote/run-actions.remote.ts` — `command`s, since these are controls rather than forms
- [ ] T130 [US4] Implement retry in `apps/web/src/lib/services/run.ts` — a further attempt on the same ticket with the same pipeline version and a fresh sandbox (FR-088)
- [ ] T131 [US4] Implement edit-and-retry as one action in `apps/web/src/lib/services/run.ts` (FR-089)
- [ ] T132 [US4] Retain every previous attempt's records, output and documents when a new attempt is created in `apps/web/src/lib/services/run.ts` (FR-090)
- [ ] T133 [US4] Reset the run branch to a known state when an attempt begins on a branch a previous attempt already wrote to, in `apps/runner/src/container/reset.ts` (FR-091)
- [ ] T134 [US4] Hold the implementing agent responsible for leaving the repository's tests passing within its own step, using the tools it has been permitted — there is no verification stage of the system's own in `apps/web/src/lib/services/agent-defaults.ts` (FR-092)
- [ ] T135 [US4] Attempt a step once more in a new container from the last commit when the sandbox or host becomes unavailable, then fail in `apps/runner/src/container/recover.ts` (FR-093)
- [ ] T136 [US4] Implement pause — the current step concludes, no further step begins in `apps/web/src/lib/services/run.ts` (FR-096)
- [ ] T137 [US4] Implement cancel at any point — sandbox released, branch left intact in `apps/web/src/lib/services/run.ts` (FR-097)
- [ ] T138 [P] [US4] Show the failed step highlighted with its error and a Retry action on screen 06 in `apps/web/src/components/StepTracker.svelte` (FR-087)

**Checkpoint**: Stories 1–4 work. Failures are now survivable day to day.

---

## Phase 7: User Story 5 — Designing the interface before building it (Priority: P5)

**Goal**: Interface work is classified, designed, and reviewed before any code is planned; non-interface
work skips all of it visibly.

**Independent Test**: Run one ticket that changes the interface and one that does not through the
same pipeline. The first produces a design source and images, pauses for review, and passes those
images onward; the second records the design step as skipped with a stated reason and still reaches
an open merge request.

### Tests for User Story 5

- [ ] T139 [P] [US5] Integration test for condition evaluation in `apps/web/tests/integration/conditions.test.ts` — evaluated when the step is reached, against facts established by then (FR-032c)
- [ ] T140 [P] [US5] Integration test asserting `skipped` is terminal for its step, never fails the run, and is distinguishable from `done`, `failed`, `pending` and `running` in `apps/web/tests/integration/skipped.test.ts` (FR-110, FR-111, FR-112)
- [ ] T141 [P] [US5] Integration test for the missing-classification path in `apps/web/tests/integration/classification.test.ts` — treated as no interface change, run continues, warning recorded **on the run** rather than only in step output (FR-102)
- [ ] T142 [P] [US5] Integration test for design output validation in `apps/runner/tests/integration/design-outputs.test.ts` — absent design source or zero images fails the step, and partial output is retained (FR-104)
- [ ] T143 [P] [US5] End-to-end test in `apps/web/tests/e2e/design-stage.spec.ts` — both tickets, plus the honest-failure case with the classification block removed (quickstart.md scenario E, SC-018)

### Conditional execution

- [ ] T144 [US5] Add `condition` to every step with `always` as the default, in `packages/shared/src/snapshot.ts` and the step editor (FR-032a)
- [ ] T145 [US5] Offer exactly three conditions — always, only when the ticket changes the interface, only when it does not in `packages/shared/src/snapshot.ts` (FR-032b)
- [ ] T146 [US5] Evaluate the condition in the workflow loop and post `step_skipped` with the condition that failed, **without calling the Runner**, in `orchestration/n8n/run-ticket-pipeline.json` (FR-032c, FR-110)
- [ ] T147 [US5] Record a skipped step and continue the run at the next step, never failing it in `apps/web/src/lib/services/run.ts` (FR-111)
- [ ] T148 [US5] Distinguish `skipped` from `done`, `failed`, `pending` and `running` everywhere step outcomes appear in `apps/web/src/components/StepTracker.svelte` (FR-112)

### Classification

- [ ] T149 [US5] Have the specification step decide whether the ticket changes the interface and record a one-sentence reason, via its instructions in `apps/web/src/lib/services/agent-defaults.ts` (FR-099)
- [ ] T150 [US5] Parse the decision block from the specification step's output in `apps/runner/src/outputs/classification.ts` and return it in the step outcome (`contracts/step-engines.md`)
- [ ] T151 [US5] Apply `ticket_classified` to store the decision and reason on the ticket, and show the reason wherever the decision changes what runs in `apps/web/src/lib/services/ticket.ts` (FR-100)
- [ ] T152 [US5] Treat an absent or unparseable decision as no interface change, continue the run, and set `classification_missing` so the warning is a field on the run in `apps/web/src/lib/services/ticket.ts` (FR-102)
- [ ] T153 [US5] Ensure the create-ticket flow never asks the author whether the ticket changes the interface in `apps/web/src/routes/(app)/tickets/new/+page.svelte` (FR-101)

### The design step

- [ ] T154 [US5] Implement the `design_cli` engine in `apps/runner/src/engines/design-cli.ts` — writes the design source at the configured path and exports one image per screen at the configured scale (FR-103)
- [ ] T155 [US5] Pass the existing design source back in on a repeat — a change request or a run retry — so the tool **revises** rather than starting from an empty canvas in `apps/runner/src/engines/design-cli.ts` (FR-106)
- [ ] T156 [US5] Fail the design step when the design source is absent or no image was exported, retaining what was produced in `apps/runner/src/outputs/design.ts` (FR-104)
- [ ] T157 [US5] Commit the design source and the exported screens to the run branch so the design travels with the code in `apps/runner/src/container/commit.ts` (FR-105)
- [ ] T158 [US5] Stream the design step's output as log chunks, naming the command, on the same terms as an agent step in `apps/runner/src/stream/logs.ts` (FR-107)
- [ ] T159 [US5] Count the design step's cost against the same run budget and ceilings as every other step in `apps/runner/src/engines/usage.ts` (FR-108)
- [ ] T160 [US5] Make the produced screens available to the planning and implementing steps that follow in `apps/runner/src/container/config.ts` (FR-109)

### Design review and visibility

- [ ] T161 [P] [US5] Show every document **and every screen** produced so far at a gate in `apps/web/src/routes/(app)/tickets/[id]/approve/+page.svelte` (FR-064c)
- [ ] T162 [P] [US5] Design Review screen (14) in `apps/web/src/routes/(app)/tickets/[id]/design/+page.svelte` — each screen as an image openable at full size, the acceptance criteria beside them, the classification reason, and a statement that no code has been written yet (FR-064d)
- [ ] T163 [P] [US5] Offer a link opening the committed design source in the design service, at that gate in `apps/web/src/routes/(app)/tickets/[id]/design/+page.svelte` (FR-064e)
- [ ] T164 [US5] Re-run the design step with the feedback and return to the same gate with the revised screens, on a change request there in `apps/web/src/lib/services/gate.ts` (FR-061a)
- [ ] T165 [P] [US5] Screen gallery component in `apps/web/src/components/ScreenGallery.svelte` — thumbnails opening a full-size viewer with next and previous (FR-077)
- [ ] T166 [P] [US5] Distinguish conditional from always-running steps in the pre-flight preview, stating each condition in words in `apps/web/src/lib/services/estimate.ts` (FR-019a)
- [ ] T167 [P] [US5] Show a skipped step in the run's step list, marked, carrying its reason, rather than omitting it in `apps/web/src/components/StepTracker.svelte` (FR-075a)
- [ ] T168 [US5] Embed the screens in the merge request description above the change summary and link the committed design source below them in `apps/web/src/lib/services/merge-request.ts` (FR-067a)
- [ ] T169 [US5] Additionally label a merge request whose ticket was classified as interface work in `apps/web/src/lib/services/merge-request.ts` (FR-068a)
- [ ] T170 [US5] Supply the design credential only to runs whose pipeline contains a design step in `apps/runner/src/container/secrets.ts` (FR-083a)
- [ ] T171 [US5] Detect a missing or rejected design credential when such a run starts, failing the design step immediately with a message naming where it is configured in `apps/runner/src/container/secrets.ts` (FR-083b)

**Checkpoint**: Stories 1–5 work. Interface work is designed and reviewed before it is built.

---

## Phase 8: User Story 6 — Composing the pipeline (Priority: P6)

**Goal**: A lead shapes how much oversight a repository gets, without anyone touching the system's
own configuration.

**Independent Test**: Build a pipeline with a non-default step order including a gate and a shell
step, save it, and confirm a run executes exactly those steps in that order — while a run started
before the edit continues on the old arrangement.

### Tests for User Story 6

- [ ] T172 [P] [US6] Integration test for version pinning in `apps/web/tests/integration/pipeline-version.test.ts` — saving advances the version and changes the behaviour of zero runs in flight (FR-027, SC-010)
- [ ] T173 [P] [US6] Integration test for all three save-time refusals in `apps/web/tests/integration/pipeline-validation.test.ts` — no code-producing step (FR-028), a design step before the classifying step (FR-032e), and a condition depending on a fact not yet established (FR-032d), each with a stated reason
- [ ] T174 [P] [US6] End-to-end test in `apps/web/tests/e2e/pipeline-builder.spec.ts` (quickstart.md scenario F)

### Implementation for User Story 6

- [ ] T175 [US6] Represent a pipeline as an ordered list of steps held as data, with no step order or meaning hard-coded, in `apps/web/src/lib/services/pipeline.ts` (FR-024, Principle III)
- [ ] T176 [US6] Support all five step kinds in the builder — agent, design, review gate, shell command, notification in `apps/web/src/components/PipelineBuilder.svelte` (FR-025)
- [ ] T177 [US6] Implement reorder, insert between any two steps, and remove, in `apps/web/src/lib/services/pipeline.ts` (FR-026)
- [ ] T178 [US6] Advance the version on every save by writing a new insert-only `pipeline_versions` row, leaving runs in flight on the version they started with in `apps/web/src/lib/services/pipeline.ts` (FR-027, Principle IV)
- [ ] T179 [US6] Refuse to save a pipeline containing no code-producing step, while allowing verification, gates and notifications to follow it in `apps/web/src/lib/services/pipeline-validate.ts` (FR-028)
- [ ] T180 [US6] Refuse to save a pipeline whose design step precedes the classifying step, naming the offending step in `apps/web/src/lib/services/pipeline-validate.ts` (FR-032e)
- [ ] T181 [US6] Refuse to save a condition at a point where the fact it depends on is not yet established, naming the step and the fact in `apps/web/src/lib/services/pipeline-validate.ts` (FR-032d)
- [ ] T182 [US6] Treat opening the merge request as implicit and always last, not a step a user can move or remove in `apps/web/src/lib/services/pipeline.ts` (FR-029)
- [ ] T183 [US6] Let each agent step declare its required documents, and each gate declare approvers, waiting time and expiry behaviour in `apps/web/src/components/StepEditor.svelte` (FR-032)
- [ ] T184 [P] [US6] Remote functions for the builder in `apps/web/src/lib/remote/pipelines.remote.ts` — a `query` for one pipeline, a `form` for save, `command`s for reorder, insert, remove and duplicate
- [ ] T185 [P] [US6] Pipeline Builder screen (08) in `apps/web/src/routes/(app)/pipelines/[id]/+page.svelte` — the vertical flow, the step palette, drag to reorder, and a + on each connector
- [ ] T186 [P] [US6] Mark conditional steps as conditional wherever a pipeline is shown, stating the condition **in words rather than as a code** in `apps/web/src/components/StepNode.svelte` (FR-032f)
- [ ] T187 [P] [US6] Show how many repositories use a pipeline, before anyone changes it in `apps/web/src/routes/(app)/pipelines/[id]/+page.svelte` (FR-030)
- [ ] T188 [P] [US6] Implement duplicate in `apps/web/src/lib/services/pipeline.ts` (FR-031)

**Checkpoint**: Stories 1–6 work. Teams can shape their own oversight.

---

## Phase 9: User Story 7 — Configuring the agents and their skills (Priority: P7)

**Goal**: Any member changes how agents behave, owning their own, without an administrator.

**Independent Test**: Change an agent's instructions and permitted tools, attach a skill, start a
run, and confirm from the output that the agent behaved accordingly and did not use a withheld tool.

### Tests for User Story 7

- [ ] T189 [P] [US7] Integration test for ownership in `apps/web/tests/integration/ownership.test.ts` — any member creates and changes their own; another member's is readable and usable but not changeable; an administrator may change any (FR-006, FR-006c)
- [ ] T190 [P] [US7] Integration test for tool withholding in `apps/runner/tests/integration/tools.test.ts` — an action requiring an unpermitted tool is unreachable (FR-039)
- [ ] T191 [P] [US7] Integration test asserting agent changes apply only to runs started afterwards in `apps/web/tests/integration/agent-pinning.test.ts` (FR-041, SC-010)
- [ ] T192 [P] [US7] End-to-end test in `apps/web/tests/e2e/agents.spec.ts` (quickstart.md scenario G, SC-015)

### Implementation for User Story 7

- [ ] T193 [US7] Let any member create, edit and delete pipelines, agents and skills without administrator involvement, in `apps/web/src/lib/services/authz.ts` (FR-006)
- [ ] T194 [US7] Record an owner on every pipeline, agent and skill a user creates, and let that owner change or delete it at will in `apps/web/src/lib/services/ownership.ts` (FR-006a)
- [ ] T195 [US7] Make the shipped default agents and pipelines available to every user in `apps/web/src/lib/services/agent-defaults.ts` (FR-006b)
- [ ] T196 [US7] Let any user read and use another user's pipeline, agent or skill while restricting change and deletion to its owner and administrators in `apps/web/src/lib/services/authz.ts` (FR-006c)
- [ ] T197 [P] [US7] Show who owns a pipeline, agent or skill wherever it can be selected or edited in `apps/web/src/components/OwnerBadge.svelte` (FR-006d)
- [ ] T198 [US7] Make plain — in the pipeline editor and before a ticket is started — when a pipeline contains no verification step and nothing beyond the implementing agent checks the result, in `apps/web/src/components/PipelineBuilder.svelte` and `apps/web/src/lib/services/estimate.ts` (FR-034a, SC-016)
- [ ] T199 [US7] Let instructions, model, permitted tools, attached skills, and per-step cost, time and turn limits be configured independently in `apps/web/src/lib/services/agent.ts` (FR-035, FR-036)
- [ ] T200 [US7] Offer the design service's own model choices and **omit the tool permissions** for an agent running on that engine in `apps/web/src/routes/(app)/agents/[id]/+page.svelte` (FR-036a)
- [ ] T201 [P] [US7] Identify which engine each agent runs on, wherever agents are listed in `apps/web/src/components/AgentCard.svelte` (FR-036b)
- [ ] T202 [US7] Restore a modified default agent to its shipped configuration from `default_config` in `apps/web/src/lib/services/agent.ts` (FR-040)
- [ ] T203 [US7] Apply agent changes only to runs started afterwards in `apps/web/src/lib/snapshot/resolve.ts` (FR-041)
- [ ] T204 [US7] Implement skill create, edit and delete, attachable to any number of agents, in `apps/web/src/lib/services/skill.ts` (FR-042)
- [ ] T205 [US7] Record a description on each skill saying when to apply it, and make that description available to agents holding it in `apps/web/src/lib/services/skill.ts` (FR-043)
- [ ] T206 [P] [US7] Show how many pipelines and runs depend on each agent and each skill in `apps/web/src/lib/services/usage.ts` (FR-043a)
- [ ] T207 [P] [US7] Remote functions for agents and skills in `apps/web/src/lib/remote/agents.remote.ts` and `skills.remote.ts`
- [ ] T208 [P] [US7] Agents screen (09) in `apps/web/src/routes/(app)/agents/+page.svelte` — card per agent with badge, model, tools, skills and usage
- [ ] T209 [P] [US7] Agent Editor screen (10) in `apps/web/src/routes/(app)/agents/[id]/+page.svelte` — prompt editor with template variables, model and limits, tool toggles, attached skills, Reset to default
- [ ] T210 [P] [US7] Skills screen (11) in `apps/web/src/routes/(app)/skills/+page.svelte` — searchable list with usage counts, and the editor with name, description, content and history

**Checkpoint**: Stories 1–7 work. Agent behaviour is self-service.

---

## Phase 10: User Story 8 — Setting up and governing the workspace (Priority: P8)

**Goal**: An administrator prepares the workspace and sets the ceilings that make unattended agent
execution financially safe.

**Independent Test**: From an unconfigured workspace, complete setup, verify each connection test
reports its true state, then confirm a run stops at the cost ceiling and a run beyond the
concurrency cap waits and reports its position.

### Tests for User Story 8

- [ ] T211 [P] [US8] Integration test for the concurrency cap and queue position in `apps/web/tests/integration/concurrency.test.ts` (FR-082)
- [ ] T212 [P] [US8] Integration test asserting a member-set agent limit cannot raise consumption beyond the workspace ceiling, and the member is told which limit applies in `apps/web/tests/integration/limit-cap.test.ts` (FR-079a)
- [ ] T213 [P] [US8] Integration test asserting no stored credential is readable back in full through any interface in `apps/web/tests/integration/credentials.test.ts` (FR-011)
- [ ] T214 [P] [US8] End-to-end test in `apps/web/tests/e2e/governance.spec.ts` (quickstart.md scenario H)

### Implementation for User Story 8

- [ ] T215 [US8] Restrict workspace credentials, dependency connections, cost ceilings and membership to administrators in `apps/web/src/lib/services/authz.ts` (FR-004)
- [ ] T216 [US8] Let administrators invite users and change a user's role in `apps/web/src/lib/services/members.ts` (FR-005)
- [ ] T217 [US8] Let administrators record the design service connection, its default model and export settings, and test it — required only where a pipeline contains a design step in `apps/web/src/lib/services/connections.ts` (FR-005a)
- [ ] T218 [US8] Implement connection tests distinguishing reachable-and-authorised from unreachable or unauthorised, for the orchestrator, the container host and the design service, in `apps/web/src/lib/services/connections.ts` (FR-005a)
- [ ] T219 [US8] Enforce the workspace concurrency limit, holding further runs in a queue that shows each author their position in `apps/web/src/lib/services/queue.ts` (FR-082)
- [ ] T220 [US8] Let administrators constrain a sandbox's processing power, memory, wall-clock lifetime, and network reach while code is being written in `apps/web/src/lib/services/workspace.ts` (FR-085)
- [ ] T221 [US8] Let administrators have failed runs' sandboxes retained for a bounded period for diagnosis, destroyed after in `apps/web/src/lib/services/workspace.ts` (FR-086)
- [ ] T222 [P] [US8] Settings screen (12) in `apps/web/src/routes/(app)/settings/+page.svelte` — Workspace, Orchestration, Sandbox, model credentials, Design, Cost limits, Members, Notifications
- [ ] T223 [P] [US8] Remote functions for settings in `apps/web/src/lib/remote/settings.remote.ts`, every one checking the administrator rule inside
- [ ] T224 [P] [US8] Show queue position on the ticket and dashboard for a run waiting on the concurrency cap in `apps/web/src/components/QueuePosition.svelte` (FR-082)

**Checkpoint**: All eight stories work. The product is complete against the specification.

---

## Phase 11: Polish & Cross-Cutting Concerns

**Purpose**: The success criteria no single story proves, from quickstart.md's cross-cutting checks.

- [ ] T225 [P] Credential scan across every artifact, log chunk and merge request description of every run in a period — expect none, scripted in `scripts/audit/credential-scan.ts` (SC-011)
- [ ] T226 [P] Concurrency check — the configured number of runs execute without any run taking more than 20% longer than it would alone, scripted in `scripts/audit/concurrency-check.ts` (SC-007)
- [ ] T227 [P] Sandbox release check — every sandbox released within five minutes of its run ending, except deliberately retained failures, scripted in `scripts/audit/sandbox-release-check.ts` (SC-012)
- [ ] T228 [P] Merge request legibility review — a reviewer who never saw the ticket can judge each merge request from the merge request alone, recorded in `docs/reviews/merge-request-legibility.md` (SC-014)
- [ ] T229 First-run walkthrough — sign-in to open merge request in under 15 minutes of attention, without documentation, recorded in `docs/reviews/first-run-walkthrough.md` (SC-001)
- [ ] T230 [P] Quality check — at least 70% of tickets with complete, unambiguous acceptance criteria reach an open merge request on the first attempt with no human editing of the code, scripted in `scripts/audit/first-attempt-rate.ts` (SC-002)
- [ ] T231 [P] Write the deployment and operations guide in `docs/operations.md` — the two deployables, the container host, the orchestrator workflow import
- [ ] T232 [P] Write `README.md` at the repository root — what the product is, how to run it locally, where the specification lives
- [ ] T233 Run every scenario in [quickstart.md](./quickstart.md) end to end against a real repository
- [ ] T234 Security review of the credential path — encryption at rest, environment injection, redaction at ingest, and the Runner's privilege boundary (Principle V), recorded in `docs/reviews/credential-path.md`
- [ ] T235 Code cleanup and refactoring pass across both deployables across `apps/web/src/` and `apps/runner/src/`

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (Phase 1)**: no dependencies — start immediately
- **Foundational (Phase 2)**: depends on Setup — **blocks every user story**
- **User stories (Phases 3–10)**: all depend on Foundational
  - Phase 3 (US1) must be **whole** before any other story starts — it contains the value path every
    other story observes, gates, recovers or extends (plan.md)
  - After US1, stories may proceed in parallel or in priority order
- **Polish (Phase 11)**: depends on the stories whose criteria it checks

### User story dependencies

| Story | Depends on | Why |
| --- | --- | --- |
| US1 (P1) | Foundational | — |
| US2 (P2) | US1 | There must be a run to watch |
| US3 (P3) | US1; **US2 recommended** | Approving at a gate is unpleasant without the run view that shows what you are approving (plan.md) |
| US4 (P4) | US1 | There must be a run to fail and retry |
| US5 (P5) | US1, US3 | The design gate is a review gate; it needs US3's gate machinery |
| US6 (P6) | US1 | Composes the steps the earlier stories established |
| US7 (P7) | US1 | Configures the agents the earlier stories run |
| US8 (P8) | US1 | Governs the ceilings the earlier stories consume |

US5 is the only story with a hard dependency beyond US1. US6, US7 and US8 are independent of each
other and of US2–US5.

### Within each user story

- Tests and implementation may be written in either order (Constitution Principle II)
- Schema before services; services before remote functions; remote functions before screens
- The Runner's engines before the workflow branches that call them
- A story is complete when its Independent Test passes

### Parallel opportunities

- **Phase 1**: T005–T012 all in parallel after T002
- **Phase 2**: the seven schema tasks T013–T019 in parallel; then T020, T021 in sequence; the three
  shared-contract tasks T022–T024 in parallel; T027, T032–T036 in parallel
- **Within a story**: all test tasks in parallel; all screens in parallel once their services exist
- **Across stories**: once US1 is whole, US6, US7 and US8 can be staffed independently of US2–US5

---

## Parallel Example: Phase 2 schema

```bash
# Seven table-definition tasks, one file each, no shared dependency:
Task: "T013 Define workspaces and users in packages/db/src/schema/workspace.ts"
Task: "T014 Define credentials and repositories in packages/db/src/schema/repository.ts"
Task: "T015 Define pipelines and pipeline_versions in packages/db/src/schema/pipeline.ts"
Task: "T016 Define agents, skills and agent_skills in packages/db/src/schema/agent.ts"
Task: "T017 Define tickets in packages/db/src/schema/ticket.ts"
Task: "T018 Define runs and step_results in packages/db/src/schema/run.ts"
Task: "T019 Define artifacts, approvals and log_chunks in packages/db/src/schema/artifact.ts"
```

## Parallel Example: User Story 1 tests

```bash
Task: "T038 Contract test for the trigger payload"
Task: "T039 Contract test for all eleven callback events"
Task: "T040 Contract test for the four Runner operations"
Task: "T041 Contract test for the step-engine interface"
Task: "T042 Contract test for the remote-function surface"
Task: "T043 Integration test for snapshot resolution"
Task: "T044 Integration test for callback idempotency"
Task: "T045 Integration test for required-output checking"
```

---

## Implementation Strategy

### MVP first (User Story 1 only)

1. Phase 1: Setup
2. Phase 2: Foundational — blocks everything
3. Phase 3: User Story 1
4. **Stop and validate**: quickstart.md scenario A, including its three refusals
5. Deploy or demo — a ticket becomes an open merge request

### Incremental delivery

Each story after US1 adds one layer and stays shippable:

1. US1 → the value path works unattended **(MVP)**
2. US2 → you can watch it happen
3. US3 → you can gate it
4. US4 → you can recover from it
5. US5 → interface work gets designed first
6. US6 → teams shape their own oversight
7. US7 → agent behaviour becomes self-service
8. US8 → the ceilings that make it financially safe

### Parallel team strategy

Complete Setup, Foundational and US1 together — US1 is the spine. Then:

- Developer A: US2 → US3 → US5 (the observe-gate-design chain)
- Developer B: US6 → US7 (configuration surfaces)
- Developer C: US4 → US8 (safety and governance)

---

## Notes

- `[P]` means a different file with no dependency on an incomplete task
- Requirement identifiers in parentheses trace each task to what authorises it; a task with no
  identifier is Setup, Foundational or Polish
- Constraints quoted from data-model.md are verbatim and are not implementation-time choices
- Every one of the 148 requirements is discharged by at least one task above
- Commit after each task or logical group; a story is done when its Independent Test passes
