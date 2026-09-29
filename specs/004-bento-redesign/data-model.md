# Data model: Bento redesign of every screen

**Feature**: [spec.md](./spec.md) · **Research**: [research.md](./research.md)

No table or column is added, changed or removed. Everything below is **derived** from existing
records (`tickets`, `runs`, `step_results`, `artifacts`, `pipeline_versions`, `repositories`) at read
time, and nothing is written back.

## StepShape — one ticket's progress through its own pipeline

Used by the dashboard (FR-010), the board (FR-018) and the run page (FR-020). Type and rules live in
`apps/web/src/lib/step-shape.ts`, shared by server and browser.

| Field | Meaning | Source |
|---|---|---|
| `count` | the pipeline's steps **plus the merge request that ends every pipeline** (spec.md §4 08: "the MR step is implicit and always last") — the design draws "5/6 алхам" for the fifth of five steps, as the run page's track does | `runs.snapshot.pipeline.steps.length + 1`; with no run yet, the steps of `pipeline_versions` for the ticket's pinned `pipeline_id` + `pipeline_version`, plus one |
| `current` | index of the segment the run is on, or `null` when not started | `runs.current_step_index`; the failure step for a failed run; the last (merge request) segment while opening it or once done |
| `kinds` | each segment's kind: `agent`, `design`, `checkpoint`, `shell`, `notify`, and `merge_request` last | the same steps array |
| `skipped` | indices recorded as skipped | `step_results.status = 'skipped'` for the run |
| `state` | `queued` · `running` · `waiting` · `failed` · `cancelled` · `done` | run status (`opening_mr` reads as `running`) |

Rules: a skipped segment is skipped whatever else holds; segments before `current` are done; after
`done`, every segment is done. The `current` segment's colour follows FR-005: accent while running,
**pen.dev blue while a design step runs**, golden yellow while waiting, red when failed, grey when
cancelled. Position in words is "current of total" with current = `current + 1` (0 when not started,
`count` when done). A pipeline version is never recomputed from the pipeline's current definition.

## DashboardTickets — FR-009, FR-010

Four groups, each `{ count, rows: DashboardTicket[] (at most 6), more: number }`:

| Group | Which tickets |
|---|---|
| `inProgress` | current run status `running`, `waiting_approval` or `opening_mr` |
| `needsAttention` | current run status `failed` |
| `queued` | ticket or run status `queued` |
| `done` | ticket `done` and its run finished within the last 7 days |

`DashboardTicket`: `ticketId`, `reference`, `title`, `repository`, `pipeline` (stored name; the screen
shows it through FR-028), `steps` (StepShape), and `status` — structured, so the screen says it in the
catalogue's words and the running time can tick without a refetch:
`{ kind: 'running' | 'waiting' | 'failed' | 'queued' | 'done'; step: { name, type } | null; since:
ISO string | null (a running step: its `step_results.started_at`); queuePosition: number | null (the
run's place in the sandbox queue); failureReason: string | null; mergeRequestUrl: string | null }`.
Ordering: most recently changed first.

A queued run that has a place in the queue states it — "position 3 in the queue" — never the bare word
"queued", which a reader can do nothing with (001 FR-082, kept).

## FirstAttempt — FR-012, SC-004

`{ counted: number, successes: number, rate: number | null }`, computed by the function shared with
`scripts/audit/first-attempt-rate.ts`:

- population: tickets created in the last 30 days, not `draft`, with at least one acceptance
  criterion;
- decided: population minus tickets whose status is `queued`, `running` or `waiting_approval`;
- success: `merge_request_url` set, highest attempt = 1, attempt 1's run `done`, and no artifact of
  attempt 1 with `created_by` set;
- `rate` = successes ÷ counted, or `null` when `counted` = 0 (the dashboard then says there is nothing
  to measure).

## MergeRequestsByDay — FR-013

`mergeRequestsByDay`: seven entries, oldest first: `{ date: YYYY-MM-DD, count: number, today: boolean }`.
`count` = runs with status `done` whose `finished_at` falls on that server-local date. Days with no
merge request are present with `count = 0`. `mergeRequestsTotal` = the sum of the seven.

## TokensToday — FR-013

`tokensToday: number` — the sum of `input_tokens + output_tokens + cache_read_tokens +
cache_creation_tokens` of `step_results` whose `finished_at` is on or after the start of the current
server-local day. Summed as `bigint`: each column is a 32-bit integer and a busy day passes what one
can hold. A step that reported none adds nothing. (Replaces `costToday`, the dollars of the same
steps, which the dashboard no longer shows; `step_results.cost_usd` is still recorded for the
ceilings.)

## PipelineSummary addition — FR-019

The pipeline list gains `stepCount` — the length of the steps of the pipeline's current version, the
version a ticket created now would pin.

## RepositoryTile additions — FR-015

The existing repository list gains `latest: { reference, title, at } | null` — the ticket on that
repository most recently updated, and when. Active and done counts are already returned.
