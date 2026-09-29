# Contract: UI data for the redesigned screens

**Feature**: [../spec.md](../spec.md) · **Data model**: [../data-model.md](../data-model.md)

This amends `specs/001-code-factory-mvp/contracts/ui-data.md` for the queries the redesigned screens
read. Every query is a SvelteKit remote `query` in `apps/web/src/lib/remote/`, authenticated by the
session as today, and read-only. No command or form changes shape.

## Added

### `dashboardTickets()` — `runs.remote.ts`

Returns `DashboardTickets` (data-model): `{ inProgress, needsAttention, queued, done }`, each
`{ count: number, more: number, rows: DashboardTicket[] }`. Each row's `status` is structured
(data-model); a queued row with a place in the queue carries `status.queuePosition`, which the screen
states in words (001 FR-082). Refreshed by the dashboard's existing live
subscription (FR-014).

### `dashboardFigures()` — `runs.remote.ts`

```ts
{
  firstAttempt: { counted: number; successes: number; rate: number | null };
  mergeRequestsByDay: { date: string; count: number; today: boolean }[]; // exactly 7, oldest first
  mergeRequestsTotal: number;
  tokensToday: number; // tokens processed by the steps finished today, all four counts added
}
```

`rate` is `null` when `counted` is 0; the screen must then show the "nothing to measure" wording, not
0%. Refreshed on the same subscription.

## Changed

### `ticketBoard()` — `tickets.remote.ts`

Each `BoardTicket` gains `steps: StepShape` (data-model). Existing fields keep their names and meaning;
`strip` keeps its wording.

### `repositories()` — `repositories.remote.ts`

Each repository gains `latest: { reference: string; title: string; at: string } | null`.

### `pipelines()` — `pipelines.remote.ts`

Each pipeline gains `stepCount: number` — the number of steps of its current version, which is the
version a ticket created now pins (FR-019). One query for the whole list.

### `settings()` — `settings.remote.ts`

Gains `runner: { tokenSet: boolean }` (research D13); the callback address comes from the existing
`callbackBaseUrl()` query. `tokenSet` is whether
`RUNNER_AUTH_TOKEN` is configured; the token itself is never returned. Administrator-only, as the rest
of the query.

## Removed

`tiles()`, `active()` and `activity()` in `runs.remote.ts`, with the services behind them
(`dashboardTiles`, `activeRuns`, `recentActivity`), once no screen reads them — superseding 001 FR-071
and FR-073 (spec: Divergence).

## Tests of this contract (Constitution II)

- Where each query lives, that it is a `query`, and that the removed ones are gone:
  `apps/web/tests/contract/bento-ui-data.test.ts`.
- The shape and meaning of each added or changed query, against Postgres:
  `dashboard.test.ts`, `first-attempt.test.ts`, `board-steps.test.ts`, `pipeline-list.test.ts`,
  `repositories.test.ts` in `apps/web/tests/integration/`; `runner-summary.test.ts` in
  `apps/web/tests/unit/` (the token never leaves as more than a boolean).

## Unchanged, relied on

`run`, `runForTicket`, `log`, `artifact`, `position`, `setup`, `ticket`, `preview`, `gate`, `design`,
`document`, `pipeline`, `agents`, `agent`, `skills`, `skill`, `connections`,
`members`, `queue` — same shapes; only their presentation changes. The approvals tile keeps reading
`ticketBoard()` (waiting tickets), as `ApprovalPanel` does today.
