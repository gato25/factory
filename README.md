# Code Factory

Turns a written ticket into a reviewable merge request.

You connect a git repository, write a ticket describing a change, and a pipeline of AI agents
produces a specification, a plan, a task list and then the implementation. When it finishes, a
branch is pushed and a merge request is opened on GitLab or GitHub, carrying everything a reviewer
needs to judge the change. **Nothing is ever merged automatically** — a person always decides.

You can put a checkpoint anywhere in the pipeline. A run stops there and waits for somebody to
approve, edit the document it produced, or send it back with feedback.

## What it looks like

```
Ticket ─→ Spec ─→ Design ─→ Plan ─→ Tasks ─→ Implement ─→ Merge request
                     ↑
        runs only when the ticket changes the interface
```

The pipeline is data, not code. It lives in the database, you edit it in the interface, and the
orchestration service reads each run's own copy of it — so changing a pipeline never disturbs a run
already in flight.

## Running it locally

You need [Bun](https://bun.sh) (the version in `.bun-version`), Postgres 16+, and Docker.

```bash
bun install
docker compose up -d postgres
cp .env.example .env            # then fill it in; the comments say what each value is
bun run db:migrate
bun run dev:web                 # → http://localhost:5173
```

That gets you the whole interface, with the shipped agents and the three shipped pipelines already
installed. To execute a pipeline you also need three things the application talks to:

```bash
docker build -t code-factory/sandbox:latest infra/sandbox
bun run dev:runner              # → :8080, needs Docker access
# and an n8n instance, with orchestration/n8n/run-ticket-pipeline.json imported
```

Sign in, open **Settings**, set the two addresses and a model credential, then press **Test every
connection**. The dashboard names anything still missing and links to where it is fixed, so you
should not need to come back here.

[docs/operations.md](./docs/operations.md) is the full deployment guide: configuration, the
maintenance pass you must schedule, network boundaries, key rotation, and what to watch.

## Checks

```bash
bun run verify                  # lint, typecheck, and 494 unit and integration tests
bun run e2e                     # 40 browser tests (3 skipped: they need a real provider)
```

Tests run against a real Postgres, not a fake one. `bun run verify` is what CI runs and what a
branch has to pass.

Four audits cover the success criteria no single feature demonstrates — credential leaks,
concurrency contention, sandbox release, first-attempt rate:

```bash
bun run audit:credentials --since 7d
```

Each exits 0 for a pass, 1 for findings, and **2 for inconclusive** — meaning there was nothing to
examine, so nothing was proved. Exit 2 is not a pass.

## Layout

```
apps/web           SvelteKit — every screen, every remote function, the callback routes
apps/runner        The only component with rights on the container host
packages/db        Drizzle schema and migrations — the single datastore
packages/shared    Types and contracts both deployables agree on
orchestration/n8n  One generic workflow, for every pipeline
infra/sandbox      The image a run executes in: fresh per run, non-root, destroyed after
scripts/           The maintenance pass, the audits, and the defaults installer
docs/              Operations guide and the Phase 11 reviews
specs/             The specification this was built from
```

## Where the specification lives

This was built spec-first, and the specification is the source of truth rather than a description
written afterwards:

- [`spec.md`](./spec.md) — the product specification, screens 00–14, against `design.pen`
- [`specs/001-code-factory-mvp/`](./specs/001-code-factory-mvp/) — the feature: requirements,
  [plan](./specs/001-code-factory-mvp/plan.md),
  [data model](./specs/001-code-factory-mvp/data-model.md),
  [contracts](./specs/001-code-factory-mvp/contracts/),
  [quickstart and validation scenarios](./specs/001-code-factory-mvp/quickstart.md), and the
  [235 tasks](./specs/001-code-factory-mvp/tasks.md)
- [`.specify/memory/constitution.md`](./.specify/memory/constitution.md) — the five principles the
  code is held to. Comments throughout the source cite requirement identifiers (`FR-082`, `SC-014`)
  so you can find what authorises a piece of behaviour

Requirement identifiers in code comments are not decoration: they are how you tell a deliberate
constraint from an accident.

## State of it

Every one of the 235 tasks is done. 494 unit and integration tests pass, and 37 of 40 browser tests;
the three that are skipped need a GitLab or GitHub credential, an n8n instance and a Docker daemon,
none of which exist in the environment this was built in.

**No end-to-end run has ever executed**, and that is stated here rather than left to be found out.
What is verified, what is not, and why is set out in
[docs/operations.md](./docs/operations.md#what-has-not-been-run) and in the four reviews under
[docs/reviews/](./docs/reviews/).
