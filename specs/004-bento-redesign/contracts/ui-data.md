# Contract: UI data for the redesigned screens

**Feature**: [../spec.md](../spec.md) · **Data model**: [../data-model.md](../data-model.md)

This amends `specs/001-code-factory-mvp/contracts/ui-data.md` for the queries the redesigned screens
read. Every query is a SvelteKit remote `query` in `apps/web/src/lib/remote/`, authenticated by the
session as today, and read-only. No form changes shape; the one command whose reply changed is
`start`, below.

## Added

### `ticketFile({ ticketId, fileId })` — `tickets.remote.ts`

One attached document with its text — `{ id, name, contentType, bytes, createdAt, content }` — read
when somebody opens it in the Requirements tab, and `null` when the id is not one of that ticket's
files (removed while it was being looked at, or another ticket's). It is separate from
`ticketFiles(ticketId)`, which lists names and sizes only and is refreshed every time a file is
attached or removed. Any signed-in person may read it, as they may list the files.

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

### `start(ticketId)` — `tickets.remote.ts`

The command that starts a ticket saved as a draft (001 FR-017) now replies
`{ ok: true, runId, started, message }` or `{ ok: false, message }`. A refusal the service words for a
person — no pipeline pinned, a run already going — is the `message`; thrown, a command reaches the
browser as "Internal Error" and nothing else, so the ticket page's Start button would have looked as if
it did nothing. `started` is whether the execution service took the run; when it did not, the run is
queued and `message` says so. It gained its first caller with the draft page (spec: Divergence).

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
