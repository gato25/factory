# Contract: Browser ⇄ Factory App

Everything our own interface does goes through **remote functions** in `*.remote.ts`. Anything
called by a system that is not our browser gets a conventional route instead (D2).

Enabled by `kit.experimental.remoteFunctions` plus `compilerOptions.experimental.async` in
`svelte.config.js`. The feature is **experimental** and its API may shift, so remote functions stay
thin — validate, then call a service module. No business logic lives in them (research.md, risk 1).

## Shape

| Kind | Used for | Examples |
| --- | --- | --- |
| `query` | Reads | dashboard tiles, active runs, ticket list, one run with its steps, artifacts, a pipeline, agents, skills |
| `form` | Mutations whose submission must not depend on JavaScript | connect a repository, create a ticket, decide at a gate, save an agent |
| `command` | Mutations from a control, not a form | pause, cancel, retry, reorder a pipeline step, attach a skill |
| `prerender` | Nothing in this feature | — |

`form` submissions invalidate the queries they affect, so creating a ticket or approving a gate
refreshes the board and the run view without manual refetching.

## Authorisation is checked inside, per call

Never in the component. Three rules cover the surface:

- **Workspace credentials, connections, ceilings, membership** — administrators only (FR-004)
- **A pipeline, agent or skill** — readable and usable by anyone; changeable only by its owner or an
  administrator (FR-006c)
- **A gate decision** — only the gate's configured approvers, while anyone may read the ticket and
  its artifacts (FR-064)

A caller who may read but not change sees the object and no action, rather than an error after the
fact.

## Live updates are not remote functions

A `query` cannot push. Two conventional routes carry the live behaviour (D4):

- `GET /api/events/{run_id}` — server-sent events. Subscribes with Postgres `LISTEN` on a
  run-scoped channel and emits a change signal; the client refreshes the affected query (FR-074).
  Log chunks ride the same stream as payloads rather than signals (FR-076).
- `POST /api/hooks/n8n` — the callback sink. External caller, so an explicit route with a versioned
  payload, not a generated endpoint ([orchestrator.md](./orchestrator.md)).

Staleness budget: five seconds (SC-004).

## Bytes are not a query either

- `GET /api/artifacts/{id}/image` — one screen's image. A `query` returns JSON to code that asked
  for it; an `<img src>` is the browser fetching a URL, so a screen openable at full size (FR-077)
  needs an address rather than a return value. Authorisation is checked in the route exactly as it
  is in a remote function: signed in, and the artifact is a screen of a run in this workspace.

## What the interface must show, and where it comes from

| Requirement | Source |
| --- | --- |
| Which steps are conditional, and each condition in words, before starting (FR-019a) | the chosen pipeline version's `steps` |
| Whether the pipeline verifies anything at all (FR-034a, SC-016) | presence of a shell step in `steps` |
| A skipped step, marked, with its reason (FR-075a) | `step_results.condition_not_met` |
| Why a ticket was classified as interface work (FR-100) | `tickets.ui_rationale` |
| That a classification never arrived (FR-102) | `tickets.classification_missing` |
| Screens as a gallery, each openable full size (FR-077) | `artifacts` where `kind = 'screen'` |
| Who owns a pipeline, agent or skill (FR-006d) | `owner_id` |
| Which engine an agent runs on (FR-036b) | `agents.engine` |
| Queue position when the concurrency ceiling is full (FR-082) | count of active runs ordered by `created_at` |
