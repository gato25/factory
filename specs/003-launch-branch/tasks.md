# Tasks: Run a ticket's branch on a real port

**Input**: spec.md, plan.md, contracts/launches.md

## Phase 1: Foundation

- [x] T001 `ContainerSpec.publish` and `ContainerHost.address`; FakeHost follows (FR-006)
- [x] T002 `launches` table, `repositories.run_command/run_port`, migration 0006 (FR-005, FR-015)
- [x] T003 Pure detection `apps/runner/src/launch/detect.ts` (FR-004, FR-016)

## Phase 2: US1 — see the implementation running (P1) 🎯 MVP

- [x] T004 Lifecycle `apps/runner/src/launch/launches.ts`: clone, install, detached start with exit
      sentinel, readiness, idle sweep, stop (FR-002, FR-007..FR-012, D1, D4)
- [x] T005 Routes `POST/GET/DELETE /launches` (contracts/launches.md)
- [x] T006 Web `runner-client.ts`; `launch.ts` records, refresh, stop, server-side console (FR-001,
      FR-003, FR-013..FR-015, D2)
- [x] T007 `launches.remote.ts`; `LaunchPanel.svelte`, `RequestConsole.svelte`; ticket page card
- [x] T008 Tests: detection (unit), lifecycle through the router (FakeHost + fake fetch), console
      shaping (unit); record layer (integration, Postgres)
- [x] T009 `design.pen` 06 Ticket Run gains the Run it card; screens.ts binding

## Phase 3: US2 — tell a repository how it starts (P2)

- [x] T010 `setRunSettings` + `changeRunSettings`; the repositories menu form (FR-005)
- [x] T011 Failure vocabulary: `runner_unreachable` with guidance

## Phase 4: Polish

- [x] T012 README section
- [ ] T013 Run a launch against a real Docker daemon (needs a machine with one)
