---

description: "Task list for the bento redesign of every screen"
---

# Tasks: Bento redesign of every screen

**Input**: Design documents from `specs/004-bento-redesign/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/ui-data.md](./contracts/ui-data.md),
[quickstart.md](./quickstart.md)

**Tests**: required. Constitution II and the spec's success criteria call for integration tests of
the new queries, browser tests of the frame, dashboard, board and legibility, and the fidelity check.

**Organization**: grouped by user story. Within a story the order is tests → data → queries → copy →
components → screen → verification.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: the user story the task serves (US1–US7)

## Definition of done for every screen task (research D11)

A screen task is checked off only when all four hold, in this order:

1. `bun run check` passes, and the existing tests of that screen's behaviour pass. The browser specs
   asserted English words on a Mongolian interface and failed at baseline for that reason alone
   (`baseline.md`); each is moved to the catalogue's words in the task that verifies its screen, and
   only then run.
2. Its entry in `apps/web/tests/e2e/legibility.spec.ts` is switched on and passes.
3. Its entry in `scripts/design/screens.ts` describes the Mongolian artboard and passes.
4. A 1440px screenshot of the running page, taken with the capture helper (T003) on the demo data
   (T002), matches the artboard exported from `design.pen`: same tiles in the same order, same
   copy, same colour meanings (SC-007). Any difference is fixed or written down as a divergence.

## Path conventions

Monorepo: `apps/web/src/...` (SvelteKit), `apps/web/tests/...`, `packages/shared/src/...`,
`scripts/...`, the design file `design.pen` at the root (edited through the pencil tools only).

---

## Phase 1: Setup

**Purpose**: a known baseline and the data and tools every later check uses.

- [X] T001 Record the baseline before any change: run `bun run lint`, `bun run check`, `bun run test` and `bun run e2e`, and write each command's result and every test already failing (the two `screens.test.ts` failures and the lint findings are expected) to `specs/004-bento-redesign/baseline.md`, so a later failure can be told apart from an old one (SC-005)
- [X] T002 Create the demo seed `scripts/demo/seed.ts`: idempotent; `--reset` deletes only the rows hanging off repositories whose `clone_url` host ends in `.invalid`. It writes repositories on GitLab and GitHub (one with an expired credential); pipelines of 3, 6 and 8 steps (with a checkpoint, a design step and a notify step among them) and their versions; tickets in every state (running with a started step, waiting for approval, failed, queued with a queue position, done within the week, draft); finished runs over the last 30 days, including one on attempt 2 and one whose attempt-1 artifact has `created_by` set; `step_results` with costs finished today and yesterday. It must not be importable from `apps/web`
- [X] T003 [P] Create the capture helper in the scratchpad (`capture.ts`, not committed): it signs in with a session cookie the way `apps/web/tests/e2e/watch-run.spec.ts` does, opens a given path at 1440×1024, waits for the network to be idle and saves a full-page PNG, so every screen can be compared with its artboard

---

## Phase 2: Foundational (blocking)

**Purpose**: the specification amendments, the design sizes, the fonts, the bento surfaces and the
shared pieces every screen is built from. No screen work starts before this phase is done.

- [X] T004 Amend `spec.md` §4 (Screens) to the new design, as the divergence section of `specs/004-bento-redesign/spec.md` lists: the frame (one floating top navigation, no sidebar); 01 (the grouped ticket list, the approvals, the first-attempt figure, the 7-day chart and today's cost; a step bar per ticket sized to its pipeline; callbacks from the execution service); 02 (tiles; latest ticket); 06 (no n8n link; details in a tab); 12 (the execution-service section); 13 (the execution service in the diagram description)
- [X] T005 [P] Mark FR-071 and FR-073 superseded in `specs/001-code-factory-mvp/spec.md`, each pointing to 004 and naming its successor (FR-009, FR-011, FR-013, FR-015 for FR-071; FR-009 "done" and the run pages for FR-073); FR-072, FR-074 and FR-082 stay as they are
- [X] T006 Raise the text sizes in `design.pen` (pencil tools only) wherever they fall below FR-007: every text node on artboards 00–15 and the `Kit ·` pages under 12px goes to 12px, and every primary-content text (names of things, list rows, body copy, form values) under 14px goes to 14px, including the `type-*` variables that set them; and correct every text colour under FR-008's contrast on its surface (clarification: deeper gradients under white text, darker text variants of the state colours). Check with a search of the whole file for font sizes under 12 (none), primary content under 14 (none) and contrast under the minimum (none), then screenshot every changed artboard to confirm nothing is clipped or overlaps
- [X] T007 Mirror the changed design variables into `apps/web/src/app.css` (the scratchpad `sync-tokens.ts --write`; the type scale is now caption 12, small 13, body 14, body-lg 15), then run `bun test scripts/design/tests/tokens.test.ts` — it must pass
- [X] T008 [P] Add the Inter Cyrillic-extended subset to `apps/web/static/fonts/inter-cyrillic-ext.woff2` — one variable file for weights 400–700, as the shipped Inter subsets already are (their per-weight files are byte-identical copies) and as Inter Tight is — with one `@font-face` (`font-weight: 400 700`) in `apps/web/src/app.css` whose `unicode-range` covers U+0460-052F (Ө U+04E8, ө U+04E9, Ү U+04AE, ү U+04AF) (research D8)
- [X] T009 Write the bento surfaces as global classes in `apps/web/src/app.css` from `Kit · 12 Bento хэсгүүд` and `Kit · 05`–`Kit · 11` (research D1): the page ground; `.tile` (24px corners, gradient fill, highlight edge, two-layer shadow, no hairline border) and its tints `.tile--approval`, `.tile--danger`, `.tile--done`, `.tile--design`; `.orb` with tones; `.pill` with tones; `.btn` primary, secondary, danger and ghost; `.field`; `.section-title`; body text at 14px in Inter and headings in Inter Tight; a visible focus ring. The old `.card`, `.badge` and `h2.section` stay until the last screen stops using them (T089)
- [X] T010 Define the step shape in `apps/web/src/lib/step-shape.ts`, importable by server and browser (data-model StepShape): `StepShape = { count; current: number | null; kinds: (StepType | 'merge_request')[]; skipped: number[]; state: 'queued' | 'running' | 'waiting' | 'failed' | 'cancelled' | 'done' }`; the pure `shapeOf({ steps, runStatus, currentStepIndex, failureStepIndex, skipped })` that maps a run to it (count includes the merge-request segment; `opening_mr` reads as running on the last segment); `segmentState(shape, index)` → done · current · upcoming · skipped; `segmentTone` → the FR-005 colour of each segment (a running design step is pen.dev blue); and `position(shape)` for "current of total"
- [X] T011 [P] Write `apps/web/tests/unit/step-shape.test.ts` for T010: 3-, 6- and 8-segment shapes (2, 5 and 7 steps plus the merge request), a skipped segment, waiting at a checkpoint, a running design step, failed, cancelled, opening the merge request, done, and not started (`current: null`, position 0)
- [X] T012 Add the step-shape loader to `apps/web/src/lib/services/run-view.ts`: for a set of tickets it reads, in one query each, their current runs' snapshots and skipped step results, and — for tickets with no run — the steps of their pinned `pipeline_versions` row (`pipeline_id` + `pipeline_version`), never the pipeline's current version (research D3, Constitution IV); each ticket's shape comes from `shapeOf`
- [X] T013 [P] Create `apps/web/src/components/Orb.svelte` (`icon`, `tone`, `size`) from the Orb component in the kit
- [X] T014 [P] Create `apps/web/src/components/StatusPill.svelte` (`tone`, `label`, optional live dot): a dot plus words, never colour alone (FR-006)
- [X] T015 [P] Create `apps/web/src/components/StepBar.svelte` taking a `StepShape`: one segment per step, coloured by `segmentState` and the FR-005 meanings (accent running, golden yellow waiting, red failed, green done, blue design), with an accessible label "step N of M" from the catalogue
- [X] T016 Create `apps/web/src/lib/default-names.ts` (FR-028): `displayName(name)` returns the catalogue name of a shipped default agent or pipeline — matched on the exact shipped name from `agent-defaults.ts` / `pipeline-defaults.ts` — and any other name unchanged; `runningPhrase(name, type)` returns the default step's own phrase while it runs ("Хөгжүүлж байна", a design step "pen.dev дээр зурж байна"), else the name; with `apps/web/tests/unit/default-names.test.ts` (shipped names map, a custom name and a renamed default pass through, English catalogue keeps English)
- [X] T017 Add the shared copy to `apps/web/src/lib/i18n/mn.ts`, then to `apps/web/src/lib/i18n/en.ts`: navigation entries, the pill state words, the step bar's "step N of M" (research D10, FR-026). `bun run check` must pass with both catalogues
- [X] T018 Say times in the catalogue's words (FR-026): `ago()` in `apps/web/src/lib/format.ts` relied on `Intl.RelativeTimeFormat('mn')`, which the server and the browser both lack, so the Mongolian screens read "12 minutes ago"; it and `duration()` in `apps/web/src/lib/step-kind.ts` take their phrases from `m.time` instead — "4 мин өмнө", "5 өдрийн өмнө", "2м 10с", as the artboards write them — with `apps/web/tests/unit/format.test.ts` covering every unit, both catalogues and a future date

**Checkpoint**: the design and the stylesheet agree on sizes and tokens; the surfaces, the step shape
and the three shared components exist; `bun run check` and the token test pass.

---

## Phase 3: User Story 2 — the new frame (Priority: P1)

**Goal**: every signed-in screen opens with the floating top navigation, and the sidebar is gone
(FR-001 to FR-003).

**Independent Test**: visit one page of every section and one nested page (a ticket, an agent, a
pipeline); the right entry is marked each time and every entry leads where it says.

- [X] T019 [US2] Write `apps/web/tests/e2e/frame.spec.ts` first: no `aside`; the bar holds the mark, the six sections, search, the create action, settings and the avatar; `/tickets/<id>` marks Tickets; `/agents/<id>` marks Agents; `/pipelines/<id>` marks Pipelines; `/settings` marks settings and no section; a search submits to `/tickets?q=` and the board is filtered; tabbing reaches every entry in order with a visible focus. It fails against the old frame
- [X] T020 [US2] Create `apps/web/src/components/TopNav.svelte` from the Top Nav component (`Kit · 08`): the mark, the six section links with the active rule of today (`/` exact, the others by prefix), the search form submitting to `/tickets?q=`, the primary action "Шинэ даалгавар" to `/tickets/new`, the settings entry (active on `/settings`, which marks no section) and the initials avatar; the bell is dropped (research D2)
- [X] T021 [US2] Replace the sidebar and header in `apps/web/src/routes/(app)/+layout.svelte` with `TopNav` on the page ground; keep every existing behaviour of the layout besides the frame. Then T019 passes, together with every other e2e test that navigated through the old sidebar (update only the selectors that named the sidebar)
- [X] T022 [US2] Rebuild 00 Login in `apps/web/src/routes/login/+page.svelte` to the artboard: the hero tile with the flow including "Дизайн · pen.dev", and the sign-in tile; the sign-in behaviour is unchanged (FR-025). Copy in `mn.ts` and `en.ts`
- [X] T023 [US2] Verify the frame and 00 against the definition of done: legibility entries for `/login` and the frame (the frame is on every screen's entry), the fidelity entries for 00 and the frame in `scripts/design/screens.ts`, and the captures compared with artboard 00 and the top bar of 01

**Checkpoint**: the frame is in place on every signed-in page; login matches its artboard.

---

## Phase 4: User Story 3 — legible on a projector (Priority: P1)

**Goal**: every screen can be read from the back of a lit room (FR-004, FR-006 to FR-008). This
phase builds the measuring instrument; every later screen task switches its screen on in it.

**Independent Test**: run the legibility test on the screens done so far; nothing is under the size
minimum, every text meets the contrast minimum, and every tile is lighter than the ground.

- [X] T024 [US3] Write `apps/web/tests/e2e/legibility.spec.ts` (research D7): a table of screens (path, how to reach it on seeded data, which selectors are primary content), each entry on or off; for each screen that is on, every visible text node's computed font size (≥ 12px, primary content ≥ 14px) and contrast against its nearest opaque background (≥ 4.5:1, or ≥ 3:1 at ≥ 20px), and every `.tile` against the ground (≥ 1.1:1, shadows ignored). A failure names the screen, the element's text, its size and its contrast
- [X] T025 [US3] Seed the legibility test's own data inside the spec (as `watch-run.spec.ts` does: a ticket in each state, an agent, a pipeline, a skill), not from the demo seed, so it runs in CI
- [X] T026 [US3] Switch on `/login` and one frame page, run the test, and fix every failure in `apps/web/src/app.css` or the component that causes it (not by lowering a threshold)
- [X] T027 [US3] Check that every colour-coded state on the screens done so far is also written in words (FR-006): pills, step bars (their label), approval tints

**Checkpoint**: the instrument exists and passes on login and the frame.

---

## Phase 5: User Story 1 — the dashboard (Priority: P1) 🎯 MVP

**Goal**: at a glance, what the factory is doing and what needs me (FR-009 to FR-014).

**Independent Test**: with tickets in each state and a history of finished runs, open the dashboard;
every ticket appears under the right heading with a bar of the right length, and the three figures
match the run records.

### Tests first

- [X] T028 [P] [US1] Write `apps/web/tests/integration/first-attempt.test.ts` against Postgres: population = tickets created in the last 30 days, not `draft`, with at least one acceptance criterion; decided = minus `queued`, `running`, `waiting_approval`; success = `merge_request_url` set, highest attempt = 1, attempt 1's run `done`, no artifact of attempt 1 with `created_by` set; cases for a second attempt, a human-edited plan, a ticket without criteria, one older than 30 days, and none decided (`rate` is `null`, not 0)
- [X] T029 [P] [US1] Write `apps/web/tests/integration/dashboard.test.ts` against Postgres: the four groups (`inProgress` = run `running`, `waiting_approval` or `opening_mr`; `needsAttention` = `failed`; `queued` = ticket or run `queued`; `done` = ticket `done` with its run finished in the last 7 days), each with `count`, at most 6 `rows` and `more`; rows ordered most recently changed first; bars of 3 and 6 segments from the pinned snapshot; a queued run with `queuePosition` and its wording; `elapsedSeconds` from the current step's `started_at` while running, else `null`; merge requests per day = exactly 7 entries oldest first, zero days present, `today` marked, `total` the sum; `costToday` = the fixed-point sum of `step_results.cost_usd` finished since the start of today (server time), a step without a reported cost adding nothing

### Data and queries

- [X] T030 [US1] Create `apps/web/src/lib/services/first-attempt.ts`: move the counting of `scripts/audit/first-attempt-rate.ts` into `firstAttempt(database, { since })` returning `{ counted, successes, rate: number | null }`, one query for the population plus one for artifacts, no per-row queries (research D4)
- [X] T031 [US1] Make `scripts/audit/first-attempt-rate.ts` call `firstAttempt` and print the same "N of M" line as before, and "nothing to measure yet" instead of 0% when `rate` is `null`; keep `--exclude` (applied by the script, outside the shared function); run it on the demo data without `--exclude` and compare with the pre-change output — same numbers
- [X] T032 [US1] Create `apps/web/src/lib/services/dashboard.ts`: `dashboardTickets(database)` (data-model DashboardTickets; one pass over tickets with their current run, one `queueState` pass, the D3 step shape, a structured `status` (data-model) whose queued row carries its queue position, which the screen states in words — never the bare word "queued", 001 FR-082) and `dashboardFigures(database)` (`firstAttempt` over 30 days, `mergeRequestsByDay` = runs `done` by server-local `finished_at` date, `mergeRequestsTotal`, `costToday`). T028 and T029 pass
- [X] T033 [US1] Add `dashboardTickets()` and `dashboardFigures()` to `apps/web/src/lib/remote/runs.remote.ts`, authenticated by the session as the others, thin calls into `dashboard.ts` (contract)
- [X] T034 [US1] Create the contract test `apps/web/tests/contract/bento-ui-data.test.ts` (Constitution II; contract "Tests of this contract"): `dashboardTickets` and `dashboardFigures` are exported as `query` from `runs.remote.ts` and take no input; the shapes are held by T028 and T029

### Copy and components

- [X] T035 [US1] Add the dashboard copy to `mn.ts` then `en.ts`: the four headings, "N more — open the board", the first-attempt caption and "nothing to measure yet", the chart's title, "today", the week's total, "recorded cost today"
- [X] T036 [P] [US1] Create `apps/web/src/components/DashboardTickets.svelte` from artboard 01: four groups with counts; each row with title, reference, repository, pipeline name, `StepBar`, "current of total" and the state in words with elapsed time while running; long names truncate with the full text on hover and never overlap the bar or the status; "more" links to `/tickets`
- [X] T037 [P] [US1] Create `apps/web/src/components/FirstAttemptRing.svelte`: the ring, the percentage and "N of M tickets"; when `rate` is `null` it says there is nothing to measure yet (FR-012)
- [X] T038 [P] [US1] Create `apps/web/src/components/WeekChart.svelte`: seven bars oldest first, a zero day drawn at zero height, today marked, the total, and today's recorded cost beside it (FR-013)
- [X] T039 [US1] Restyle `apps/web/src/components/ApprovalPanel.svelte` as the approvals tile (`.tile--approval`), still reading the waiting tickets from `ticketBoard()`, one entry per approval even when the creator is also an approver, each with its review action (FR-011)

### Screen

- [X] T040 [US1] Rebuild `apps/web/src/routes/(app)/+page.svelte` in the artboard's order: the not-ready notice first when the workspace is not set up (FR-014), then the ticket list, the approvals, the first-attempt ring and the week chart; the existing `subscribeToRun({ target: 'dashboard' })` refreshes `dashboardTickets`, `dashboardFigures` and `ticketBoard` (FR-014)
- [X] T041 [US1] Replace the dashboard assertions of `apps/web/tests/e2e/watch-run.spec.ts` ("tickets running", "Active runs") with the "in progress" heading and the ticket's row, updated live by the callback (research D12)
- [X] T042 [US1] Re-scope the queue-position assertions of `apps/web/tests/e2e/governance.spec.ts` ("the dashboard says the same thing") from the "Active runs" card to the "queued" group: positions 3 and 1 shown, the bare word "queued" absent (research D12)
- [X] T043 [US1] Write `apps/web/tests/e2e/dashboard.spec.ts` for the independent test and all seven acceptance scenarios: seeded tickets in each state and finished runs; each under its heading with its count (1); bars of 3 and 6 segments with the step in words and elapsed time (2); the first-attempt figure and its count equal the seeded outcomes (3); with nothing decided, "nothing to measure yet" and no 0% (4); seven bars with today marked, the total and today's cost (5); a callback that moves a run moves its row without a reload (6); an unconfigured workspace shows the notice above everything (7)
- [X] T044 [US1] Remove what nothing reads any more (research D6): `StatTile.svelte`, `ActivityFeed.svelte`, `ActiveRuns.svelte`; the `tiles`, `active` and `activity` queries in `runs.remote.ts`; the `dashboardTiles`, `activeRuns` and `recentActivity` services in `run-view.ts`; and their copy in both catalogues — each only after a search shows no reader left. Add to `apps/web/tests/contract/bento-ui-data.test.ts` that no remote file exports `tiles`, `active` or `activity`
- [X] T045 [US1] Verify 01 against the definition of done (legibility entry on, fidelity entry for 01, capture against artboard 01), and run `bun scripts/audit/first-attempt-rate.ts --since 30d` on the demo data: the dashboard's figure and count equal the audit's line (SC-004)

**Checkpoint**: the MVP — the frame, a legible login and the new dashboard with its three figures.

---

## Phase 6: User Story 4 — a ticket's own pipeline, everywhere (Priority: P2)

**Goal**: the board, the creation form and the run page draw each ticket against its own pinned
pipeline (FR-018 to FR-020).

**Independent Test**: tickets on pipelines of three, six and eight steps draw three, six and eight
segments on every surface, and a checkpoint reads as waiting for a person.

- [X] T046 [US4] Write `apps/web/tests/integration/board-steps.test.ts` first: `board()` returns `steps` of 3, 6 and 8 segments; a queued ticket without a run draws from its pinned version with `current: null`; a pipeline edited after the run started still draws the pinned version
- [X] T047 [US4] Add `steps: StepShape` to `BoardTicket` in `board()` in `apps/web/src/lib/services/run-view.ts` via `stepShapeOf`, reading the pinned versions and skipped results in one query each, not per ticket; `strip` keeps its wording (contract). T046 passes
- [X] T048 [US4] Restyle `apps/web/src/components/TicketCard.svelte` to the board card: reference, creator, title, repository and pipeline, `StepBar`, the state in words (FR-018); a long title, repository or pipeline name truncates with the full text on hover and never overlaps the bar or the state
- [X] T049 [US4] Rebuild 04 in `apps/web/src/routes/(app)/tickets/+page.svelte`: five tinted columns — queued, running, waiting approval, done, failed — each with its count; the search filter from `?q=` unchanged
- [X] T050 [US4] Write `apps/web/tests/e2e/board.spec.ts`: tickets on 3-, 6- and 8-step pipelines show 3, 6 and 8 segments on the board and the dashboard; an 8-step ticket waiting at its second checkpoint has its current segment in the approval colour and "waiting for your approval" in words
- [X] T051 [US4] Verify 04 against the definition of done
- [X] T052 [US4] Write `apps/web/tests/integration/pipeline-list.test.ts` first: `listPipelines` returns `stepCount` = the number of steps of each pipeline's current version (a pipeline saved twice reports its latest version's count), in one query for the list
- [X] T053 [US4] Add `stepCount` to `listPipelines` in `apps/web/src/lib/services/pipeline.ts` by joining each pipeline's current `pipeline_versions` row; `pipelines()` returns it (contract); add to `bento-ui-data.test.ts` that `pipelines` is still a `query` in `pipelines.remote.ts`. T052 passes
- [X] T054 [US4] Rebuild 05 in `apps/web/src/routes/(app)/tickets/new/+page.svelte`: the form tile; pipeline choices as cards showing `stepCount`; "Юу болох вэ" listing the chosen pipeline's steps from `preview()` with each step's agent and engine, conditional steps marked with their condition, the design step marked pen.dev (FR-019); `FilePicker.svelte` restyled; creation behaviour unchanged
- [X] T055 [US4] Extend `apps/web/tests/e2e/board.spec.ts` to the creation form (US4 scenario 3): each pipeline card shows its own step count, and choosing one lists exactly its steps in "what will happen", its conditional step marked with its condition
- [X] T056 [US4] Verify 05 against the definition of done, and run `apps/web/tests/e2e/ticket-to-mr.spec.ts`
- [X] T057 [US4] Rebuild 06 in `apps/web/src/routes/(app)/tickets/[id]/+page.svelte` with `TicketHead.svelte` (header tile with the step track as orbs), `StepTracker.svelte` (done, running, upcoming, skipped with its reason, durations), `LiveLog.svelte` (the log tile with its tabs), `ArtifactViewer.svelte` (results tile), and `RunDetails.svelte` moved into the "Мэдээлэл" tab (pipeline, attempt, environment, budget used of cap; no orchestration link) (FR-020); `LaunchPanel.svelte`, `RequestConsole.svelte`, `RequirementFiles.svelte` and `QueuePosition.svelte` restyled where shown; the queue wording kept
- [X] T058 [US4] Extend `apps/web/tests/e2e/board.spec.ts` to the run page (US4 scenario 2 and the independent test): the step track of 3-, 6- and 8-step tickets has 3, 6 and 8 steps; a skipped design step reads as skipped with its reason; the run details are in the details tab with no orchestration link
- [X] T059 [US4] Verify 06 against the definition of done, and run `watch-run.spec.ts`, `recover.spec.ts`, `governance.spec.ts` and `board.spec.ts`

**Checkpoint**: every progress drawing follows the ticket's own pipeline.

---

## Phase 7: User Story 5 — design review before code (Priority: P2)

**Goal**: the checkpoint screens keep their actions, and the design review shows that it is design
work (FR-021).

**Independent Test**: at the design checkpoint of a UI ticket, the page shows the banner, every
exported screen, why it was designed, the acceptance criteria and the action that opens the design
source.

- [ ] T060 [US5] Rebuild 07 in `apps/web/src/routes/(app)/tickets/[id]/approve/+page.svelte`: the golden approval banner, the plan document tile (`Markdown.svelte` restyled), the feedback tile, the history tile; approve, request changes and cancel unchanged
- [ ] T061 [US5] Verify 07 against the definition of done, and run `apps/web/tests/e2e/approve.spec.ts`
- [ ] T062 [US5] Rebuild 14 in `apps/web/src/routes/(app)/tickets/[id]/design/+page.svelte` with `ScreenGallery.svelte` restyled: the pen.dev checkpoint banner stating no code has been written yet, every exported screen large, "pen.dev дээр нээх" opening the committed design file on the provider, ".pen татах", the reason the ticket was designed and its acceptance criteria; the actions unchanged
- [ ] T063 [US5] Extend `apps/web/tests/e2e/design-stage.spec.ts` with the independent test: at the design checkpoint the page shows the design banner stating no code has been written yet, every exported screen, why the ticket was designed, its acceptance criteria, and an "open in pen.dev" action whose address is the committed design file on the provider; approve, request changes and cancel present (US5 scenarios 1 and 2)
- [ ] T064 [US5] Verify 14 against the definition of done, and run `apps/web/tests/e2e/design-stage.spec.ts`

**Checkpoint**: both checkpoint screens match their artboards and behave as before.

---

## Phase 8: User Story 6 — management screens (Priority: P3)

**Goal**: repositories, pipelines, agents, skills and settings in the new layout, doing what they did
(FR-015 to FR-017, FR-022 to FR-024).

**Independent Test**: walk every action on 02, 03 and 08–12 (connect, set how it starts, reorder a
step, edit an agent, edit a skill, test connections); each still works and each screen matches its
artboard.

### 02 and 03 — repositories

- [ ] T065 [US6] Write `apps/web/tests/integration/repositories.test.ts` first: `listRepositories` returns `latest: { reference, title, at } | null` — the repository's most recently updated ticket, `null` when it has none — in one query, not one per repository
- [ ] T066 [US6] Add `latest` to `listRepositories` in `apps/web/src/lib/services/repository.ts`; `repositories()` returns it (contract); add to `bento-ui-data.test.ts` that `repositories` is still a `query` in `repositories.remote.ts`. T065 passes
- [ ] T067 [US6] Rebuild 02 in `apps/web/src/routes/(app)/repositories/+page.svelte`: a tile per repository with name, path, provider, connection state in words, default branch, default pipeline, the latest ticket and when, active and done counts; every existing action reachable from the tile; an expired token tints the tile red and offers replacing it there (FR-015, FR-016); a long name or path truncates with the full text on hover
- [ ] T068 [US6] Rebuild 03 in `apps/web/src/components/ConnectRepository.svelte`: a bento dialog over the blurred repositories page, its four numbered steps and behaviour unchanged (FR-017)
- [ ] T069 [US6] Verify 02 and 03 against the definition of done

### 08 — pipelines

- [ ] T070 [US6] Rebuild 08 in `apps/web/src/routes/(app)/pipelines/[id]/+page.svelte`, `PipelineBuilder.svelte`, `StepNode.svelte` and `StepEditor.svelte`: colour-coded step cards on a soft canvas with + connectors and the palette tiles; agent, checkpoint, design, custom agent, shell and notify steps told apart by colour and label; reorder and insert unchanged (FR-022)
- [ ] T071 [US6] Restyle the pipelines list `apps/web/src/routes/(app)/pipelines/+page.svelte`, which has no artboard of its own, with the kit's tiles and pills; note in the fidelity check that it is not an artboard
- [ ] T072 [US6] Verify 08 against the definition of done, and run `apps/web/tests/e2e/pipeline-builder.spec.ts`

### 09 and 10 — agents

- [ ] T073 [US6] Rebuild 09 in `apps/web/src/routes/(app)/agents/+page.svelte` with `AgentCard.svelte` and `OwnerBadge.svelte`: agent tiles, each with the orb of the engine it runs on (Claude or pen.dev) (FR-023)
- [ ] T074 [US6] Rebuild 10 in `apps/web/src/routes/(app)/agents/[id]/+page.svelte`: the instructions in a code surface, model and limits, tool toggles, skills; every field and action unchanged (FR-023)
- [ ] T075 [US6] Verify 09 and 10 against the definition of done, and run `apps/web/tests/e2e/agents.spec.ts`

### 11 — skills

- [ ] T076 [US6] Rebuild 11 in `apps/web/src/routes/(app)/skills/+page.svelte`: the list tile and the markdown editor tile; fields and actions unchanged (FR-023)
- [ ] T077 [US6] Verify 11 against the definition of done

### 12 — settings

- [ ] T078 [US6] Write `apps/web/tests/unit/runner-summary.test.ts` first, then add the pure `runnerSummary(config): { tokenSet: boolean }` to `apps/web/src/lib/services/connections.ts` and return it as `runner` from `settings()` in `apps/web/src/lib/remote/settings.remote.ts` — whether `RUNNER_AUTH_TOKEN` is configured, never its value (research D13, Constitution V). The test gives a token and asserts the serialised result contains no part of it; add to `bento-ui-data.test.ts` that `settings.remote.ts` reads the token only through `runnerSummary`
- [ ] T079 [US6] Rebuild 12 in `apps/web/src/routes/(app)/settings/+page.svelte`: the settings menu tile and a tile per section; the execution-service section holds the address (the existing `runnerBaseUrl` field, moved from the sandbox section, same field name), the masked credential, the callback address (`callbackBaseUrl()` + `/api/hooks/orchestrator`) and the connection check (the existing `connections` runner result); the sandbox and design-service sections kept; members, keys, limits, notifications and the queue unchanged (FR-024)
- [ ] T080 [US6] Write `apps/web/tests/e2e/management.spec.ts` for the independent test and the three scenarios: a repository with an expired token has its tile marked as needing attention and a replace-token action there (1); the connect dialog opens over the repositories page with its four numbered steps; the settings page has the execution-service section with the address, a masked credential whose value never appears in the page, the callback address and a connection check, and no orchestration section (2); the builder labels agent, checkpoint, design, custom agent, shell and notify steps differently (3); an agent and a skill are edited and saved; the agent tiles name their engine. Existing specs already walk connecting, reordering and inserting steps — this one does not repeat them
- [ ] T081 [US6] Verify 12 against the definition of done, and run `apps/web/tests/e2e/management.spec.ts` and the settings part of `apps/web/tests/e2e/governance.spec.ts`

**Checkpoint**: every management screen matches its artboard and every action still works.

---

## Phase 9: User Story 7 — the design stays the source of truth (Priority: P3)

**Goal**: the fidelity check describes the Mongolian design and guards it (FR-027).

**Independent Test**: the fidelity check passes; removing one fixed phrase from a screen alone makes
it fail and name the screen and phrase.

- [ ] T082 [US7] Finish `scripts/design/screens.ts` (each screen's entry was written in its own task): every screen artboard 00–14 covered (13 and 15 are references, not screens, and are marked so), each entry's `files` including `apps/web/src/lib/i18n/mn.ts`, the "omits" entries re-checked against the new artboards (14 now draws "pen.dev дээр нээх" and ".pen татах"), each omission with its reason (research D9)
- [ ] T083 [US7] Run `bun test scripts/design/tests/screens.test.ts` — all tests pass, including the two that failed at baseline
- [ ] T084 [US7] Prove the check bites: remove one fixed phrase from one screen's source only, run the test, confirm it fails naming the screen and phrase, then restore the phrase (SC-006)

**Checkpoint**: design and code are bound again.

---

## Phase 10: Polish and cross-cutting

- [ ] T085 Switch on every screen in `apps/web/tests/e2e/legibility.spec.ts` (none left off) and run it: 100% of text meets FR-007 and FR-008, every tile FR-004 (SC-002)
- [ ] T086 Check every colour-coded state on every screen is also in words (FR-006), and that each colour keeps its one meaning across screens (FR-005)
- [ ] T087 At a 1024px-wide window, open every screen: tiles stack rather than overflow, and no text falls below 12px (spec edge case)
- [ ] T088 Switch the deployment's catalogue to English and open every screen: no missing key, every new string has its English form (FR-026)
- [ ] T089 Remove the old code nothing uses any more (plan: "removed code"): run `bun scripts/design/icons.ts --prune` so `Icon.svelte` holds exactly the icons the design draws, then check no screen names one it dropped; the old `.card`, `.badge` and `h2.section` rules from `apps/web/src/app.css` once a search finds no user, updating any e2e selector that still names them; remove the Manrope `@font-face` rules and files from `apps/web/static/fonts/` if no design variable names Manrope any more
- [ ] T090 Search `apps/web/src` for "n8n" in copy shown to a person (e.g. the notify-step note on the settings page in `mn.ts` and `en.ts`) and replace it with the execution service, as artboard 12 says (FR-024, SC-007)
- [ ] T091 Run `bun run lint` and fix what this feature introduced; compare with the baseline (T001) for what was already there
- [ ] T092 Run `bun run verify` — lint, typecheck, offline and browser audits, all unit and integration tests — and compare with the baseline: nothing that passed before fails (SC-005)
- [ ] T093 Run `bun run e2e` — every browser test passes, including frame, legibility, dashboard and board (SC-005)
- [ ] T094 Walk `specs/004-bento-redesign/quickstart.md` end to end on the demo data (seed, every screen, the audit comparison, the checks) and correct the quickstart wherever it no longer matches
- [ ] T095 Final visual review: capture all 14 screens and compare each with its artboard side by side for tiles, order, copy and colour meaning; record the result per screen in `specs/004-bento-redesign/baseline.md` under "after" (SC-007)
- [ ] T096 Hand the two human checks to the user, who runs them — they need the room, the projector and people, which no test can stand in for: SC-001 (5 people shown the dashboard for the first time; 4 say within 5 seconds which tickets need them) and SC-003 (3 viewers at 6 metres in the lit room read every ticket title and state on the dashboard, the board and the run page). Record the results in `specs/004-bento-redesign/baseline.md` when they are given
- [ ] T097 Reconcile the plan's file map in `specs/004-bento-redesign/plan.md` with what was actually built, and mark every task here done

---

## Dependencies and execution order

### Phases

- **Setup (1)** first. **Foundational (2)** blocks every story.
- **US2 (3) → US3 (4) → US1 (5)**: all three are P1. They run in that order because the dashboard
  cannot match its artboard without the frame, and every screen's definition of done needs the
  legibility instrument.
- **US4 (6)**, **US5 (7)** and **US6 (8)** depend only on Phase 2 and the frame; they follow in
  priority order. US4's step bars on the dashboard (T050) need US1 done.
- **US7 (9)** needs every screen's entry written, so it follows the last screen.
- **Polish (10)** last.

### Within a story

- Tests are written before the code they test and fail first (T019, T028, T029, T046, T065, T078).
- Services before queries, queries before components, components before the screen.
- Removed code (T044) goes only after its last reader has gone.

### Parallel opportunities

- Phase 2: T005 with T004; T008 alongside T006–T007; T011, T013, T014, T015 together once T010 is
  written.
- US1: T028 and T029 together; T036, T037 and T038 together once T033 and T035 are done.
- US4, US5 and US6 touch different routes and could run side by side after US1; they are done one
  after another here, to keep each step verified before the next (the user's instruction).

## Parallel example: User Story 1

```text
T028 first-attempt.test.ts   ‖   T029 dashboard.test.ts
T036 DashboardTickets.svelte ‖   T037 FirstAttemptRing.svelte   ‖   T038 WeekChart.svelte
```

## Implementation strategy

### MVP first

1. Phases 1 and 2.
2. Phase 3 (the frame and login) and Phase 4 (the instrument).
3. Phase 5 (the dashboard). **Stop and validate**: the dashboard is the first thing the audience sees
   and the only screen with new information; it can be presented on its own.

### Incremental delivery

Each later phase adds screens without touching the ones before: US4 (board, create, run), US5 (the two
checkpoints), US6 (management), then US7 binds them to the design. Every screen is verified — build,
legibility, fidelity, capture against its artboard — before the next begins.
