# Quickstart: validating the bento redesign

**Feature**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Contract**: [contracts/ui-data.md](./contracts/ui-data.md)

## Prerequisites

- The repository set up as in the root README: `bun install`, a Postgres, `.env` filled in,
  `bun run db:migrate`.
- `design.pen` open in pen.dev when comparing a screen with its artboard (read-only).

## 1. Fill a workspace with every state

```bash
bun scripts/demo/seed.ts            # idempotent; --reset empties the demo rows first
```

It creates the design's sample data: repositories on GitLab and GitHub (one with an expired token),
pipelines of 3, 6 and 8 steps, and tickets in every state — running, waiting for approval, failed,
queued, done within the week — plus finished runs over the last 30 days so the first-attempt figure and
the 7-day chart have something to show.

## 2. Look at every screen

```bash
bun run dev:web                     # → http://localhost:5173, sign in
```

Visit, at a 1440px-wide window: `/login`, `/`, `/repositories` (and its connect dialog), `/tickets`,
`/tickets/new`, a running ticket, a ticket waiting at a checkpoint (`/tickets/<id>/approve`), a ticket
waiting at a design checkpoint (`/tickets/<id>/design`), `/pipelines/<id>`, `/agents`, `/agents/<id>`,
`/skills`, `/settings`. For each, compare with the artboard of the same number:

```bash
bun scripts/design/report.ts "01 Dashboard"   # the artboard's tree, copy and values
```

Expected: the same tiles in the same order, the same copy, the same colour meanings (spec SC-007).

## 3. Check the dashboard's figures against their sources

```bash
bun scripts/audit/first-attempt-rate.ts --since 30d
```

Run it without `--exclude`: the dashboard has no manual exclusions. Expected: the dashboard's
first-attempt figure and its ticket count equal the audit's "N of M" line (SC-004); with nothing
decided, both say there is nothing to measure yet. The 7-day chart's total equals the done runs of the week; today's cost equals the sum of the
steps finished today.

## 4. Run the checks

```bash
bun run verify                      # lint, typecheck, unit + integration, token + fidelity checks
bun run e2e                         # browser tests, including legibility.spec.ts
```

Expected: everything passes. `legibility.spec.ts` fails naming the screen, the element, its size and
its contrast when any text is under 12px (14px for primary content) or under 4.5:1 (FR-007, FR-008).
The fidelity check fails naming the screen and phrase if any fixed phrase exists on only one side
(FR-027).

## 5. On the projector

Open `/`, `/tickets` and a running ticket on the projector in the presentation room with its lights on,
and have three people read the ticket titles and states from the back row (SC-003).
