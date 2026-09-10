# Phase 0 Research: Code Factory MVP

**Feature**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Date**: 2026-09-10

The stack was chosen by the product owner: **SvelteKit with remote functions, Postgres, Bun, and
n8n for orchestration.** That settles the four largest unknowns. What remained were the decisions
those choices force, recorded below with the alternatives that were rejected.

---

## D1 — Runtime, framework and orchestrator (given)

**Decision**: Bun as the runtime for every service we write. SvelteKit for the web application,
using remote functions as its data layer. Postgres as the only datastore. n8n executes pipelines.

**Rationale**: Directed by the product owner. It also fits the shape of the product: the spec is
dominated by interface work — 14 screens, eight user stories, most requirements about what a person
sees — with comparatively thin server logic. One language across the web app, the Runner and the
shared contracts keeps the pipeline snapshot and the callback vocabulary in a single type
definition rather than duplicated across languages.

**Alternatives considered**: none — this was specified rather than researched.

---

## D2 — Remote functions are the UI's data layer; HTTP routes serve external callers

**Decision**: All reads and writes initiated by our own interface go through remote functions in
`*.remote.ts` files — `query` for reads, `command` for mutations outside a form, `form` for
submissions that must survive without JavaScript. Everything called by a system that is **not** our
browser client gets a conventional `+server.ts` endpoint: the n8n callback sink, the checkpoint
resume hand-off, and the Runner's log and artifact posts.

**Rationale**: Remote functions compile to a generated, SvelteKit-owned HTTP endpoint and a client
fetch wrapper. That is exactly right for our own client and exactly wrong for a third party: n8n and
the Runner need a stable, documented URL and payload we control and version, which a generated
endpoint does not give us. Drawing the line at "who is calling" keeps the ticket-creation form and
the approval buttons boilerplate-free while leaving the machine-to-machine surface explicit — and
that surface is small: five or six routes total.

**Consequence worth noting**: `form` submissions automatically invalidate the queries they affect,
which covers ticket creation and approval decisions without manual refetching.

**Alternatives considered**:
- *A REST API for everything, including our own UI.* Rejected — it is the boilerplate remote
  functions exist to remove, and the product owner chose remote functions specifically.
- *Remote functions for the n8n callbacks too.* Rejected — the endpoint shape is generated rather
  than specified, so an external caller would be coupled to a SvelteKit implementation detail.

---

## D3 — Database access: Drizzle, not an experimental runtime API

**Decision**: Drizzle ORM with `drizzle-kit` for migrations, talking to Postgres.

**Rationale**: We need three things the schema-less options do not give us: typed queries shared
between the web app and the Runner, checked-in reversible migrations (the data model has 15 tables
and will churn through eight delivery phases), and a schema definition that doubles as the source of
the shared types. Drizzle runs on Bun, and its generated SQL stays legible.

**Alternatives considered**:
- *`Bun.sql`, Bun's built-in Postgres client.* Rejected as the primary layer — it is a driver, not a
  migration story, and leaning on a young runtime API for the persistence of the whole product adds
  risk for no gain. Reasonable later as the driver underneath.
- *Prisma.* Rejected — heavier, a separate engine binary, and its generated client sits awkwardly in
  a Bun monorepo.

---

## D4 — Live updates: Postgres LISTEN/NOTIFY behind server-sent events

**Decision**: When a callback changes a run, the write emits a Postgres `NOTIFY` on a
run-scoped channel. A `+server.ts` route holds a server-sent-events stream per viewer, subscribes
with `LISTEN`, and pushes a small "this changed" signal. The client refreshes the affected query.
Log chunks ride the same stream as payloads rather than signals.

**Rationale**: FR-074 requires the dashboard and any open ticket to update without a reload, and
SC-004 caps the staleness at five seconds. Polling every open run page would put a floor on database
load proportional to viewers × runs; LISTEN/NOTIFY makes the cost proportional to actual events.
Server-sent events are one-directional, which is all we need — every action from the browser already
has a remote function — and they survive proxies far better than sockets.

**Alternatives considered**:
- *Polling `query.refresh()` on an interval.* Rejected — five-second staleness across many
  concurrent runs means constant load and still feels laggy on the live log.
- *WebSockets.* Rejected — bidirectional machinery we would not use, and more to operate.
- *A message broker.* Rejected — a second piece of infrastructure for a signal Postgres already
  carries.

---

## D5 — The Runner is a separate service

**Decision**: A standalone Bun HTTP service, deployed apart from the web application, holding the
only credential that can reach the container host.

**Rationale**: It is the one component that needs privileged access to create containers, and it
runs work measured in minutes while streaming output. Both properties argue against putting it
inside the request path of the web app: a compromise of the interface should not imply control of
the container host, and a deploy of the UI should not interrupt a running pipeline. The product
specification already describes it as a separate service, so this confirms rather than chooses.

**Alternatives considered**: *Runner as routes inside the SvelteKit app.* Rejected — it would give
the public-facing app container-creation rights and couple pipeline execution to web deploys.

---

## D6 — Two agent engines behind one step contract

**Decision**: The Runner executes an agent step by invoking the Claude Code CLI headlessly and a
design step by invoking the pen.dev CLI, behind one internal interface: given a step and a
workspace, produce an outcome, a cost, output files, and a stream of log lines.

Default models per the specification's agent contracts, using exact published identifiers with no
date suffixes:

| Default agent | Model | Input $/MTok | Output $/MTok |
| --- | --- | --- | --- |
| Spec | `claude-sonnet-5` | 2.00 | 10.00 |
| Design | pen.dev's own model list (FR-036a) | — | — |
| Plan | `claude-opus-5` | 5.00 | 25.00 |
| Tasks | `claude-sonnet-5` | 2.00 | 10.00 |
| Implement | `claude-opus-5` | 5.00 | 25.00 |

**Rationale**: FR-025 gives design steps and agent steps equal standing in the step vocabulary, and
FR-108 requires design cost to count against the same ceilings. One interface with two
implementations is what lets the orchestrator, the cost accounting and the run view treat them
alike. The models above are what the source specification assigns; `claude-haiku-4-5` is available
for a cheaper custom agent but is not a default.

**Cost accounting**: actual spend comes from each engine's own reported usage, never from our own
token estimates — the CLI reports it per invocation. The table above is used only for the
pre-flight estimate in FR-019, and estimates are explicitly not commitments (Assumptions).

**Alternatives considered**: *Calling the Anthropic API directly instead of the CLI.* Rejected —
the specification's whole agent model is CLI-shaped: agents are configured as prompt files, skills
as instruction files, and tool permissions as CLI flags. Reimplementing the harness against the API
would mean rebuilding tool execution, and it is not what was specified.

---

## D7 — Pipeline snapshots are resolved once and stored whole

**Decision**: On run creation, resolve the pipeline, every agent, every skill and every ceiling into
one JSON document, store it on the run, and send it to n8n. Nothing re-reads configuration for the
life of the run.

**Rationale**: FR-044 requires exactly this, and FR-041, FR-027 and SC-010 all depend on it — a
member editing their own agent must not alter a run in flight. Storing the snapshot also makes a run
reproducible after the pipeline that produced it has moved on several versions.

**Alternatives considered**: *Version-pinned foreign keys instead of a snapshot.* Rejected — it
requires every configuration table to be fully versioned and immutable, which is a much larger
schema for the same guarantee.

---

## D8 — Secrets: encrypted at rest, injected as environment at container start

**Decision**: Repository credentials, the model credential and the design credential are encrypted
in Postgres with a key held only by the application. The Runner receives them per run and passes
them to the container as environment variables. They are never written into the workspace, never
persisted in n8n, and are redacted from log chunks as they are ingested.

**Rationale**: FR-083, FR-083a, FR-083b and FR-084 require it, and SC-011 makes it measurable — no
credential in any retained output, document, screen or merge request description. Redacting at
ingest rather than at display means a leak cannot be un-redacted later by a change to the viewer.

**Alternatives considered**: *A dedicated secret manager.* Deferred, not rejected — a clean
interface for credential resolution keeps that swap cheap, but standing up another service is not
justified for the MVP.

---

## D9 — Testing

**Decision**: `bun test` for unit and integration tests, running against a real Postgres in a
container rather than a fake. Playwright for the journeys in the spec's eight user stories. Each
story's "Independent Test" becomes one end-to-end spec.

**Rationale**: The spec's acceptance scenarios are written as Given/When/Then over user-visible
behaviour, which maps onto browser tests almost directly. The parts most likely to break — snapshot
resolution, condition evaluation, cost ceilings, idempotent callbacks — are pure logic over the
database and belong in fast integration tests.

---

## Risks carried into Phase 1

| Risk | Why it matters | How the plan handles it |
| --- | --- | --- |
| **Remote functions are experimental** (SvelteKit ≥ 2.27; requires `kit.experimental.remoteFunctions` and `compilerOptions.experimental.async`, and the API may shift before it stabilises) | It is the data layer for all 14 screens | Pin an exact SvelteKit version; keep remote functions thin — validation and a call into a plain service module, no business logic in them — so a signature change is a mechanical edit |
| **n8n must hold a run paused indefinitely** | FR-056 and a `wait_forever` gate have no time bound | Treat the resume hand-off as the contract, not the wait: the app stores the resume address and can drive it; a lost execution is recoverable by re-issuing rather than by restarting the ticket |
| **The Runner holds container-host rights** | Highest-value target in the system | Separate service (D5), no public route, app-to-Runner calls authenticated, containers non-root with the ceilings from FR-085 |
| **Design engine is a second external dependency** | A design step fails without it | FR-083b requires detection at run start with a message naming where to configure it; FR-005a makes the connection testable before anyone depends on it |
| **`has_ui` defaults to false when unparseable** | Interface work can ship undesigned (FR-102) | The warning is a first-class field on the run, surfaced in the run view, not a log line |

## Unresolved — deliberately deferred to implementation

- The exact validation-schema library for remote functions (Zod or Valibot). Both satisfy the need;
  the choice does not affect any contract in this plan.
- Whether log chunks stay in Postgres beyond the MVP. The retention assumption is 90 days; the
  contract in `contracts/` treats a log as an opaque addressable reference so the store can change.
