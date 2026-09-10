# Quickstart & Validation: Code Factory MVP

**Feature**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Date**: 2026-09-10

How to bring the system up and prove it works. The scenarios below are the eight user stories'
**Independent Tests**, in delivery order — each becomes one end-to-end spec (D9), and each is
demonstrable on its own. Structural detail lives in [data-model.md](./data-model.md) and
[contracts/](./contracts/); this file is the run guide.

## Prerequisites

| Need | Why | Notes |
| --- | --- | --- |
| Bun (pinned in `.bun-version`) | Runtime, package manager, test runner | Pin exactly — see risk 1 |
| Postgres 16+ | The only datastore | `LISTEN`/`NOTIFY` carries live updates (D4) |
| A container host reachable by the Runner | One sandbox per run | The Runner is the only thing that talks to it (D5) |
| An n8n instance | Executes pipelines, holds gates paused | Import `orchestration/n8n` |
| A model credential | Agent steps | Workspace-level |
| A GitLab.com or GitHub.com repository with a test suite, and a token that can read it, push branches and open merge requests | The value path | Only these two providers exist (FR-014a) |
| A design service credential | Design steps only | Needed from Phase E; optional before (FR-005a) |

## Bring it up

```bash
bun install                        # workspace root
bun run db:migrate                 # packages/db — drizzle-kit
bun run --filter web dev           # apps/web
bun run --filter runner dev        # apps/runner (needs container host access)
```

Then, in the application: sign in, open **Settings**, and use **Test connection** on the
orchestrator, the container host and — if you are past Phase E — the design service. Each test must
distinguish reachable-and-authorised from unreachable or unauthorised (FR-005a, Story 8 scenario 1).
Do not proceed until all three are green; every scenario below depends on them.

## Checks

```bash
bun test                           # unit + integration, against a real Postgres
bun test --filter snapshot         # the highest-risk logic: snapshot resolution, conditions,
                                   # ceilings, callback idempotency
bunx playwright test               # the eight scenarios below
```

## Validation scenarios

### A — Ticket to merge request (Story 1, P1)

Connect the repository. Add a shell step running its test suite after the implementing step. Create a
ticket for a small self-contained change with two acceptance criteria. Start it.

**Expect**: a branch on the provider whose commits satisfy the criteria and leave the suite passing;
a merge request open against the default branch; its description carrying the ticket description, the
criteria as a checklist, the specification and plan, cost and duration, and a link back; the ticket
marked done with the merge request address stored.

**Also check the refusals**: a token missing a permission is rejected naming *which* permission
(FR-009); a repository hosted anywhere but GitLab.com or GitHub.com is refused with a reason
(FR-014b); a step whose required document is missing or empty fails the run and opens no merge
request (FR-051, FR-055).

### B — Watching a run (Story 2, P2)

Start a run and watch only the ticket page.

**Expect**: at any moment you can state which step is executing, what has been spent, and what the
last agent wrote — without reloading. Steps show done, running or upcoming with duration and cost.
Output appears progressively. The dashboard lists every active run and updates as they progress.

**Measure**: nothing on screen is more than five seconds behind actual state (SC-004).

### C — Approving before work continues (Story 3, P3)

Add a gate after the planning step. Run three tickets through it and exercise one decision each.

**Expect**: approve continues at the next step; edit carries the edited document into following
steps with the previous version retained; request-changes re-runs the preceding step with the
feedback and comes back to the same gate. Every decision records who and when. A non-approver can
read everything and decide nothing. A second decider on an already-decided gate is told so
(FR-064a).

### D — Recovering from failure (Story 4, P4)

Force a failure twice: once with a ticket whose criteria cannot be met, once with a deliberately low
cost ceiling.

**Expect**: the failing step and a readable reason, without opening raw output (FR-087, SC-008).
Retry creates attempt 2 on the same ticket, and attempt 1 stays readable (FR-090). The ceiling case
names the ceiling and shows what was consumed. Edit-and-retry takes at most two interactions
(SC-009).

### E — Designing before building (Story 5, P5)

Run two tickets through the same pipeline: one that changes the interface, one that only touches a
migration.

**Expect (interface ticket)**: the specification step records the classification and a one-sentence
reason, visible on the ticket. The design step produces a committed design source and one image per
screen. The gate shows every screen full-size-openable, the acceptance criteria beside them, the
reason, and a statement that no code has been written. Request-changes revises the *existing* design
source rather than redrawing it. The planning and implementing steps receive the screens. The merge
request embeds them, links the source, and carries the interface label.

**Expect (migration ticket)**: the design step is shown as **skipped with its reason**, the run does
not fail, no design budget is spent, and a merge request still opens (FR-111, SC-018).

**Also check the honest failure**: with the classification block removed from the specification
agent's instructions, the ticket is treated as not changing the interface, the run continues, and
the warning appears **on the run** — not only in step output (FR-102).

### F — Composing the pipeline (Story 6, P6)

Build a pipeline with a non-default order, a gate, and a shell step. Save it. Start a ticket on it
while an older run is still in flight.

**Expect**: exactly those steps in exactly that order. The in-flight run continues on the version it
started with (SC-010). Saving refuses a pipeline with no code-producing step (FR-028), a design step
before the classifying step (FR-032e), and a condition depending on a fact not yet established
(FR-032d) — each with a stated reason.

### G — Configuring agents and skills (Story 7, P7)

As a member — not an administrator — create your own planning agent, change its instructions and
model, withhold a tool, attach a skill, and swap it into your own pipeline.

**Expect**: no administrator involvement needed (SC-015). The run reflects the new instructions and
cannot use the withheld tool (FR-039). Another member's agent is readable and usable but not
changeable, and its owner is named (FR-006c, FR-006d). A design-engine agent offers that service's
models and no tool toggles (FR-036a). Resetting a modified default restores it (FR-040).

### H — Workspace governance (Story 8, P8)

Set a per-run cost ceiling and a concurrency ceiling. Start more tickets than the concurrency
ceiling allows.

**Expect**: runs beyond the ceiling wait and show their author a queue position (FR-082). A run stops
at the cost ceiling, within 5% (SC-006). No stored credential is readable back in full (FR-011). A
member cannot change credentials, connections or ceilings (FR-004). An agent limit set above the
workspace ceiling does not raise what a run may consume, and the member is told which limit applies
(FR-079a).

## Cross-cutting checks

Worth running once the phases are in, because each is a success criterion no single scenario proves:

| Check | Criterion |
| --- | --- |
| Scan every artifact, log chunk and merge request description of every run in a period for credentials — expect none | SC-011 |
| Run the configured concurrency; no run takes more than 20% longer than it would alone | SC-007 |
| Every sandbox released within five minutes of its run ending, except deliberately retained failures | SC-012 |
| A reviewer who never saw the ticket can judge each merge request from the merge request alone | SC-014 |
| First-run walkthrough: sign-in to open merge request in under 15 minutes of attention, no documentation | SC-001 |
