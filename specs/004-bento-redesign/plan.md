# Implementation Plan: Bento redesign of every screen

**Branch**: `004-bento-redesign` | **Date**: 2026-09-28 | **Spec**: [spec.md](./spec.md)

**Research**: [research.md](./research.md) · **Data model**: [data-model.md](./data-model.md) · **Quickstart**: [quickstart.md](./quickstart.md) · **Contract**: [contracts/ui-data.md](./contracts/ui-data.md) · **Tasks**: [tasks.md](./tasks.md)

## Summary

Rebuild the web application's fourteen screens to the approved `design.pen` artboards: a floating top
navigation instead of the sidebar, the bento surfaces of the UI kit, the tangerine palette already
mirrored into the token layer, and text sizes and contrast that survive a projector (FR-007, FR-008,
measured by a new browser test). Behaviour does not change (FR-025). The dashboard gains three figures
— first-attempt rate, merge requests per day, today's tokens — computed from existing records, the first
one by a function shared with the existing audit so the two can never disagree (SC-004). Step bars
everywhere are drawn against each ticket's pinned pipeline. The fidelity check is rewritten to the
Mongolian design, and `spec.md` §4 and 001 FR-071 / FR-073 are amended.

## Technical Context

**Language/Version**: TypeScript 5.9; SvelteKit 2.70 with Svelte 5.57 (runes, remote functions) on the
Node adapter; Bun 1.3 for scripts and tests
**Primary Dependencies**: Drizzle 0.45, valibot 1.5, `@lucide/svelte` icons — no new dependency
**Storage**: Postgres — no schema change; three derived read queries (data-model)
**Testing**: `bun:test` unit and integration tests against a real Postgres; Playwright 1.63 browser
tests; `svelte-check`; Biome; the design token and fidelity checks in `scripts/design/tests`
**Target Platform**: a desktop browser at 1440px, presented through a projector in a lit room
**Project Type**: web application (monorepo: `apps/web`, `apps/runner`, `packages/*`, `scripts/`)
**Performance Goals**: the dashboard's added queries keep the page within its current load time on the
demo data (each query a single round trip; no per-row queries)
**Constraints**: text ≥ 12px, primary content ≥ 14px, contrast ≥ 4.5:1 (3:1 at ≥ 20px); tiles ≥ 1.1:1
lighter than the ground; copy in both catalogues; `design.pen` is the source of layout, copy and colour
**Scale/Scope**: 14 screens, ~25 components, 6 remote queries added or changed, 3 removed

## Constitution Check

*GATE: passed before Phase 0; re-checked after Phase 1 — still passing.*

- **I. Spec-Driven** — every change cites a 004 FR. The divergence from `spec.md` §4 and the
  supersession of 001 FR-071 and FR-073 are recorded in the spec and applied to both documents as
  tasks, before the screens that depend on them. The demo seed script is a plan decision (below), not
  product behaviour.
- **II. Tested Before Merge** — the new queries have integration tests against Postgres; the shared
  first-attempt function, which had no test until now, gains one that the audit and the dashboard
  both rely on; legibility is a browser test over every
  screen (FR-004, FR-007, FR-008); every user story's Independent Test is one browser test (frame,
  legibility, dashboard, board — extended to the creation form and run page —, design stage,
  management); the contract has a contract test (`bento-ui-data.test.ts`); the fidelity check covers every screen's copy (FR-027). Tests asserting removed
  elements are replaced, not deleted (SC-005).
- **III. Pipelines Are Data** — untouched. Step bars read the pinned steps; nothing hard-codes a step
  order or count (FR-010, FR-018 are the fix for the old four-segment bar).
- **IV. Pinned Execution** — step bars use the run's snapshot or the ticket's pinned pipeline version,
  never the pipeline's current definition (research D3).
- **V. Least Privilege and Secret Hygiene** — no credential is added to any query; the settings
  section shows the execution-service token masked, as today (FR-024).
- **Architectural invariants** — no behaviour of runs, sandboxes, checkpoints, conditions or merge
  requests changes (FR-025). The application still only stores and renders.

## Project Structure

### Documentation (this feature)

```text
specs/004-bento-redesign/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/ui-data.md
├── checklists/requirements.md
└── tasks.md            # /speckit-tasks
```

### Source code touched

Reconciled with what was built (T097). Planned entries that changed shape are marked.

```text
design.pen                                   # text sizes raised to FR-007 (design and screens agree)
spec.md                                      # §4 amended to the new design
specs/001-code-factory-mvp/spec.md           # FR-071, FR-073 marked superseded by 004
apps/web/static/fonts/inter-cyrillic-ext.woff2, inter-tight-*.woff2   # new (D8)
apps/web/static/fonts/manrope-*.woff2        # removed: no design variable names Manrope (T089)
apps/web/src/app.css                         # bento surfaces, ground, tints from design.pen, font faces;
                                             # the old .card, .badge, h2.section removed (T089)
apps/web/src/lib/i18n/{mn,en}.ts             # new and changed copy; every screen's English moved in
apps/web/src/components/
├── TopNav.svelte                            # new (frame)
├── StepBar.svelte                           # new (D3)
├── StatusPill.svelte, Orb.svelte            # created (T013, T014), then removed: every screen uses
│                                            #   the kit's .pill and .orb classes directly
├── DashboardTickets.svelte                  # new (01)
├── FirstAttemptRing.svelte                  # new (01)
├── WeekChart.svelte                         # new (01)
├── ApprovalPanel.svelte                     # restyled (01)
├── ConnectRepository.svelte                 # restyled (03)
├── TicketCard.svelte                        # restyled + StepBar (04)
├── TicketHead.svelte, StepTracker.svelte, LiveLog.svelte, RunDetails.svelte,
│   ArtifactViewer.svelte, LaunchPanel.svelte, RequestConsole.svelte,
│   QueuePosition.svelte                     # restyled (06)
├── RunResults.svelte                        # new (06): the results column
├── ScreenGallery.svelte                     # restyled (14)
├── PipelineBuilder.svelte, StepNode.svelte, StepEditor.svelte        # restyled (08)
├── AgentCard.svelte, OwnerBadge.svelte      # restyled (09)
├── Markdown.svelte, FilePicker.svelte, RequirementFiles.svelte       # restyled where shown
├── Icon.svelte                              # regenerated and pruned to the design's icons (T089)
├── StatTile.svelte, ActivityFeed.svelte, ActiveRuns.svelte           # removed (D6)
apps/web/src/routes/
├── login/+page.svelte                                   # 00
├── (app)/+layout.svelte, +layout.server.ts              # frame
├── (app)/+page.svelte                                   # 01
├── (app)/repositories/+page.svelte                      # 02, 03
├── (app)/tickets/+page.svelte                           # 04
├── (app)/tickets/new/+page.svelte                       # 05
├── (app)/tickets/[id]/+page.svelte                      # 06
├── (app)/tickets/[id]/approve/+page.svelte              # 07
├── (app)/tickets/[id]/design/+page.svelte               # 14
├── (app)/pipelines/+page.svelte, pipelines/[id]/+page.svelte   # 08 (the list has no artboard)
├── (app)/agents/+page.svelte, agents/[id]/+page.svelte  # 09, 10
├── (app)/skills/+page.svelte                            # 11
└── (app)/settings/+page.svelte                          # 12, with the runner section (D13)
apps/web/src/lib/step-shape.ts                           # new: StepShape, shared by server and browser (D3)
apps/web/src/lib/state-words.ts                          # new: a ticket's state in words, row or card
apps/web/src/lib/default-names.ts                        # new: shipped agents, steps and pipelines in
                                                         #   the catalogue's words; stepTitle
apps/web/src/lib/format.ts                               # ago in the catalogue; modelName
apps/web/src/lib/step-kind.ts                            # durations in the catalogue
apps/web/src/lib/services/
├── dashboard.ts                                         # new: dashboardTickets, dashboardFigures (D4, D5)
├── first-attempt.ts                                     # new: shared with the audit (D4)
├── ticket-state.ts                                      # new: one reading of a ticket's state, for the
│                                                        #   dashboard rows and the board cards alike
├── run-view.ts                                          # board() gains steps, gate, state; removed services (D6)
├── repository.ts                                        # listRepositories gains latest
├── pipeline.ts                                          # listPipelines gains stepCount
├── pipeline-validate.ts                                 # the refusals in the catalogue's words
├── estimate.ts                                          # a preview step carries its condition and engine
├── gate.ts                                              # the checkpoint timeline in the catalogue
├── agent.ts, auth.ts                                    # tool descriptions and messages catalogued
└── connections.ts                                       # runnerSummary (D13); the check's findings catalogued
apps/web/src/lib/remote/{runs,settings,agents,pipelines,skills,run-actions}.remote.ts
                                                         # the dashboard queries; runner in settings();
                                                         #   notices in the catalogue
packages/shared/src/step-loop.ts                         # an order problem names the rule it breaks
packages/shared/src/design.ts                            # the UI kit's pages are not artboards (isKitPage)
apps/web/tests/
├── integration/dashboard.test.ts                        # new
├── integration/first-attempt.test.ts                    # new
├── integration/board-steps.test.ts                      # new (D3)
├── integration/pipeline-list.test.ts                    # new (FR-019)
├── integration/repositories.test.ts                     # new (FR-015)
├── integration/{pipeline-validation,connections,first-account}.test.ts   # read the catalogue
├── unit/runner-summary.test.ts                          # new (D13)
├── unit/step-shape.test.ts                              # new (D3)
├── contract/bento-ui-data.test.ts                       # new (contract)
├── e2e/management.spec.ts                               # new (US6)
├── e2e/legibility.spec.ts                               # new: every screen
├── e2e/frame.spec.ts                                    # new (US2)
├── e2e/dashboard.spec.ts                                # new (US1)
├── e2e/board.spec.ts                                    # new (US4)
├── e2e/watch-run.spec.ts                                # dashboard assertions replaced (D12)
├── e2e/governance.spec.ts                               # queue-position assertion re-scoped (D12);
│                                                        #   settings assertions in the catalogue
└── e2e/{agents,approve,design-stage,pipeline-builder,recover,ticket-to-mr}.spec.ts
                                                         # moved to the catalogue's words
scripts/audit/first-attempt-rate.ts                      # calls the shared function
scripts/design/screens.ts                                # rewritten to the Mongolian design (D9)
scripts/design/icons.ts                                  # --prune
scripts/demo/seed.ts                                     # new: validation and presentation data
```

**Structure Decision**: the existing monorepo; the feature lives in `apps/web` plus the design, the two
specifications and three scripts. The execution service is not touched.

## Decisions

- **Order of work** follows dependency, and every step ends verified (research D11):
  specification amendments → design text sizes → fonts and foundation styles → frame → 00 → the
  legibility instrument → 01 (with its queries) → 04 → 05 → 06 → 07 → 14 → 02 + 03 → 08 → 09 + 10 →
  11 → 12 → fidelity check and legibility sweep → full verification. This is the user stories' order
  (tasks.md): P1 first, the frame and the instrument before the dashboard because it needs both.
- **Demo seed** (`scripts/demo/seed.ts`): a development and presentation tool that fills a workspace
  with the design's sample data in every state. It is not reachable from the application. Everything
  it writes hangs off repositories whose clone address is on the reserved `.invalid` domain (RFC 2606,
  so nothing can ever push there), which is how `--reset` finds exactly its own rows and nothing else.
- **Removed code** (D6) goes only after its last reader is gone, in the step that removes the reader.

## Complexity Tracking

No violations to justify.
