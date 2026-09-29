# Research: Bento redesign of every screen

**Feature**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md)

Each decision below resolves a question the plan would otherwise leave open. None required a new
library.

## D1 — Where the bento visual language lives

**Decision**: surfaces that carry no behaviour are global classes in `apps/web/src/app.css`
(`.tile`, `.tile--approval`, `.orb` and its tone modifiers, `.pill` and its tones, `.btn` primary /
secondary / danger, `.field`, `.section-title`, the page ground). Parts that take data and are reused
across screens become small Svelte components: `TopNav`, `StepBar`, `StatusPill`, `Orb`.

**Rationale**: the UI kit (`Kit · 12 Bento хэсгүүд`, `Kit · 05`–`Kit · 11`) defines each surface
once; one class per surface keeps every screen from re-deriving gradients and shadows. A component is
worth it only where the markup has structure (a step bar's segments, a pill's dot and label).

**Alternatives considered**: a component for every surface (`Tile.svelte` wrapping a slot) — rejected,
it adds a wrapper element per tile and makes layout harder without adding behaviour; per-component
copies of the styles — rejected, it is how the previous design drifted.

## D2 — The frame

**Decision**: `apps/web/src/routes/(app)/+layout.svelte` replaces the `aside` and header with one
`TopNav` component. The active-section rule stays as it is (`/` exact, others by prefix); settings is
matched separately so it lights the settings button and no section. Search keeps its form submitting
to `/tickets?q=` (FR-003). The bell, which had no destination of its own, is dropped; the design has
none.

**Rationale**: FR-001, FR-002; the design's Top Nav component (`Kit · 08`).

## D3 — Step bars sized to each ticket's pipeline

**Decision**: one `StepBar` component takes `{ count, current, kinds, skipped, state }`. The data comes
from the run's pinned snapshot when the ticket has a run (`runs.snapshot.pipeline.steps`), and from
the ticket's pinned pipeline version when it is still queued without one
(`pipeline_versions.steps` for `tickets.pipeline_id` + `tickets.pipeline_version`). `board()` and the
new dashboard query both return this shape.

**Rationale**: FR-010, FR-018, spec edge cases "no snapshot yet" and "pipeline changed after start" —
the pinned version, never the current one (Constitution IV).

**Alternatives considered**: computing from the pipeline's current version — rejected, it violates
pinning and draws the wrong bar after an edit.

## D4 — The three new dashboard figures

**First-attempt rate (FR-012, SC-004).** Decision: move the counting of
`scripts/audit/first-attempt-rate.ts` into a function in `apps/web/src/lib/services/first-attempt.ts`
that takes the rows and returns `{ counted, successes, rate | null }`, with a query beside it. The
audit script and the dashboard both call it. Rationale: the clarification made the two numbers the
same by definition; one function makes them the same by construction. The audit had no test; the
shared function gains one (`first-attempt.test.ts`), so both callers are covered at once. Alternative: re-implement in the service — rejected, two copies drift.

**Merge requests per day (FR-013).** Decision: count runs with status `done` whose `finished_at` falls
on each of the last 7 server-local days, including days with zero. Rationale: a run finishing `done`
is the moment its merge request was opened (the orchestrator sends `mr_opened` then `done`);
`tickets.updated_at` moves on later edits and would count a ticket twice.

**Tokens today (FR-013, amended from "today's cost").** Decision: sum the four token counts of
`step_results` whose `finished_at` is today, across all runs. Rationale: tokens are recorded per step,
so a long run spanning midnight is split correctly; a step that reported none is zero and contributes
nothing, as the spec's edge case now states. Summed as `bigint` because each column is 32-bit.

## D5 — The dashboard's ticket list

**Decision**: a new query `dashboardTickets()` returns the four groups of FR-009 from one pass over
tickets with their current run: in progress = run status `running`, `waiting_approval`,
`opening_mr`; needs attention = `failed`; queued = `queued`; done = `done` with the run finished in
the last 7 days. Each row carries the D3 step shape, the status line from the same catalogue strings
the board uses (`m.strip`), and for a running step its elapsed time from the current step's
`step_results.started_at`. Each group is capped at 6 rows with the remainder counted (spec edge case
"many tickets"). A queued row carries its queue position from one `queueState` pass, as `activeRuns`
does today, and says it in words (001 FR-082 is kept — only FR-071 and FR-073 are superseded).

**Rationale**: FR-009, FR-010; reuses the board's strip wording so the two screens say the same thing.

## D6 — Superseded dashboard parts

**Decision**: `StatTile`, `ActivityFeed` and `ActiveRuns` are removed, with the `tiles`, `active` and
`activity` remote queries and the `dashboardTiles`, `activeRuns`, `recentActivity` services, once
nothing references them. `ApprovalPanel` is kept and restyled. 001 FR-071 and FR-073 are amended to
point to 004 (see the spec's Divergence section).

**Rationale**: dead code is a place for drift to hide; the constitution requires the supersession to
be written where the requirement lives.

## D7 — Legibility, measured rather than eyeballed

**Decision**: a browser test (`apps/web/tests/e2e/legibility.spec.ts`) visits every screen and, for
every visible text node, reads the computed font size and the contrast of its colour against the
nearest opaque background, failing on any node under 12px, any primary-content node under 14px, and
any contrast under 4.5:1 (3:1 at 20px and above). A second check asserts that each neutral tile is
lighter than the ground under it by at least 1.1:1 and each tinted tile differs from it by a ΔE of at
least 10. `design.pen` text sizes and colours below the minimum are corrected
first, so the design and the screens agree (spec assumption). The same measurement was run over the
design itself (every text against the fills behind it, each gradient stop counted): 244 of 1,011
screen texts failed before, none after. For a gradient ground the browser test likewise takes the
lower-contrast of its stops.

**Rationale**: FR-004, FR-007, FR-008, SC-002 require measurement; a screenshot review cannot prove
100%.

**Alternatives considered**: a lint over CSS values — rejected, sizes come from several rules and only
the rendered page knows the result.

## D8 — Fonts

**Decision**: add the Cyrillic-extended subset of Inter to `static/fonts` as one variable file
(`inter-cyrillic-ext.woff2`, weights 400–700) with one `@font-face` rule, as was done for Inter Tight;
the shipped Inter subsets are the same variable file copied once per weight. Geist Mono carries only code and log text,
where Mongolian rarely appears; it is left as is and noted.

**Rationale**: spec assumption; Ө, ө, Ү, ү (U+04E8, U+04E9, U+04AE, U+04AF) are outside the Cyrillic
subset the app ships today.

## D9 — The fidelity check

**Decision**: rewrite `scripts/design/screens.ts` from the current artboards: every screen lists the
fixed Mongolian phrases it takes from its artboard, and its `files` include the Mongolian catalogue
(`apps/web/src/lib/i18n/mn.ts`), because the screens take their words from it. The "omits" entries
are re-checked against the new artboards (14 now draws "pen.dev дээр нээх" and ".pen татах").

**Rationale**: FR-027, SC-006. The check failed before this feature for the same two reasons: its
phrases were the English design, and the words moved into the catalogue after it was written.

## D10 — Copy

**Decision**: every new or changed string is added to `mn.ts` first (it defines the catalogue's shape)
and then to `en.ts`; the compiler rejects a key missing from either.

**Rationale**: FR-026.

## D11 — Verification per screen

**Decision**: each screen is done when (1) typecheck and the existing tests of its behaviour pass,
(2) the legibility test passes for it, (3) the fidelity entry for it passes, and (4) a screenshot of
the running page at 1440px, taken with the browser test harness, matches its artboard exported from
`design.pen` in tiles, order, copy and colour meaning (SC-007).

## D12 — Tests that assert removed elements

**Decision**: two browser tests assert elements that leave the dashboard, and each is replaced by an
assertion on its successor (SC-005):

- `apps/web/tests/e2e/watch-run.spec.ts` asserts the "tickets running" tile and the "Active runs"
  list → the grouped list's "in progress" heading and the ticket's row.
- `apps/web/tests/e2e/governance.spec.ts` ("the dashboard says the same thing") reads the queue
  positions inside the "Active runs" card → the same three assertions scoped to the "queued" group.

No other test references a removed element (searched: `StatTile`, `ActivityFeed`, `ActiveRuns`,
`dashboardTiles`, `recentActivity`, the removed labels). Tests that select by `.card` or `.badge`
classes are found and updated in the step that renames the class.

## D13 — The execution-service section of settings

**Decision**: the settings page gains a runner section built from what already exists: the address is
the workspace's `runnerBaseUrl` field, moved out of the sandbox section into this one with the same
form field name (so saving is unchanged); the credential is shown masked — only whether
`RUNNER_AUTH_TOKEN` is set, never any part of its value; the callback address is what the existing
`callbackBaseUrl()` query returns, followed by `/api/hooks/orchestrator`, the path the run snapshot
already sends; the connection check is the existing `connections` command's runner result. The only
new datum is `settings().runner.tokenSet`, read-only, computed by a pure `runnerSummary(config)` in
`connections.ts` whose test proves nothing but the boolean leaves it.

**Rationale**: FR-024 and Constitution V — the token never reaches the browser, only a boolean does.
The section was never an n8n one in this code (n8n was removed earlier); the runner address sat under
the sandbox heading, which is what the design separates.
