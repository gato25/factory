# Running every quickstart scenario

**Task**: T233 — run every scenario in
[quickstart.md](../../specs/001-code-factory-mvp/quickstart.md) end to end against a real
repository. **Date**: 2026-09-10

## The honest summary first

**Six of the eight scenarios ran in full. Two did not, and cannot in this environment.** Scenario A's
value path and scenario E's provider-side expectations need a GitLab or GitHub repository with a
push credential, an n8n instance, and a Docker daemon. None exists here:

```
$ docker version --format '{{.Server.Version}}'
failed to connect to the docker API at unix:///var/run/docker.sock: no such file or directory
$ curl -m 3 http://localhost:5678          # n8n
(nothing listening)
```

Outbound network access exists — `git ls-remote` against a public repository succeeds — so the gap
is the credential and the two services, not connectivity.

The three browser tests covering those expectations are **skipped, not passed**
(`ticket-to-mr.spec.ts`), which is the state they should be in: written, and waiting for an
environment.

## Scenario by scenario

### A — Ticket to merge request (Story 1) — partially run

**Ran.** Everything up to the moment the pipeline would start, plus everything after the Runner
would report back. The sign-in path, the ticket form and its refusals, the snapshot resolution, the
callback handling for all eleven events, the merge request body, the ticket's completion and stored
address. `apps/web/tests/integration/merge-request.test.ts` asserts the body's contents — the
criteria as a checklist, the specification and plan, cost, duration, the attempt, the link back —
and the composed artefact is reproduced in
[merge-request-legibility.md](./merge-request-legibility.md).

**Not run.** No branch was pushed and no merge request was opened, because there is no provider
credential. The two refusals that need a provider — a token missing a permission named by
permission (FR-009), and a repository hosted elsewhere refused by host (FR-014b) — are the two
skipped tests.

**Ran, of the third refusal.** A step whose required document is missing or empty fails the run and
opens no merge request (FR-051, FR-055) — covered by integration tests, no provider needed.

### B — Watching a run (Story 2) — ran

2 browser tests pass. A run reports which step is executing, what has been spent and what the last
agent produced, and updates without a reload (FR-074, SC-004). The dashboard lists active runs with
their progress.

The five-second freshness claim (SC-004) rests on `pg_notify` behind SSE, which the browser test
exercises: it makes a change and asserts the page follows it without a reload. What is not measured
is latency under load.

### C — Approving before work continues (Story 3) — ran

7 browser tests pass — more than the scenario asks for. All four gate decisions: approve continues
at the next step; an edit carries the edited document forward and keeps the previous version;
requested changes re-run the preceding step and come back to the same gate; cancelling at a gate
stops the run and leaves the branch alone. Plus a non-approver reading everything and deciding
nothing, a second decider being told the gate is already decided (FR-064a), and a live page
following somebody else's decision.

### D — Recovering from failure (Story 4) — ran

5 browser tests pass. Both forced failures the scenario asks for: a ticket whose criteria cannot be
met, and a deliberately low cost ceiling. The failing step and a readable reason without opening raw
output; retry creating attempt 2 with attempt 1 still readable; the ceiling case naming the ceiling
and what was consumed; edit-and-retry as one action.

### E — Designing before building (Story 5) — partially run

**Ran.** All three of the scenario's cases as browser tests: the interface ticket is classified with
a reason visible on the ticket, the design step produces a source and screens, the gate shows them
with the criteria beside them and states that no code has been written; the migration ticket has its
design step **skipped with its reason**, spends no design budget, and still reaches a merge request
(FR-111, SC-018); and the honest failure — with no usable classification the run continues, treated
as not interface work, with the warning **on the run** rather than only in step output (FR-102).

**Not run.** That request-changes revises the *existing* design source rather than redrawing it
depends on the design CLI, which needs a design credential. The revision path itself — a second
version of the same artifact path, with the first retained — is asserted in integration tests.

**Found, not run.** The merge request embeds the screens, but they will very likely render as broken
images on a provider: `/api/artifacts/:id/image` requires a signed-in user and providers fetch
images server-side through a proxy with no cookies. Recorded in
[credential-path.md](./credential-path.md#5-screens-embedded-in-a-merge-request-require-a-factory-session---residual).

### F — Composing the pipeline (Story 6) — ran

4 browser tests pass. A non-default order with a gate and a shell step saves; a run already in
flight continues on the version it started with (SC-010); all three refusals state a reason — no
code-producing step (FR-028), a design step before the classifying step (FR-032e), a condition
depending on a fact not yet established (FR-032d).

### G — Configuring agents and skills (Story 7) — ran

5 browser tests pass. A member — not an administrator — creates an agent, changes its instructions
and model, withholds a tool, attaches a skill and swaps it into their own pipeline, with no
administrator involvement (SC-015). Another member's agent is readable and usable but not
changeable, with its owner named (FR-006c, FR-006d). A design-engine agent offers that service's
models and no tool toggles (FR-036a). Resetting a modified default restores what shipped (FR-040).

What a run *does* with the withheld tool (FR-039) is asserted where it is decided — the snapshot and
the engine's argv — rather than in the browser, since no agent executes here.

### H — Workspace governance (Story 8) — ran

8 browser tests pass. The ceilings and the concurrency cap; runs beyond the cap waiting with a
position on their own ticket and on the dashboard (FR-082); a ceiling of zero refused with a reason;
no stored credential readable back in full (FR-011); a member unable to change credentials,
connections or ceilings — checked both on the screen and against the remote function directly
(FR-004); membership changes; and each connection test reporting its own state rather than a shared
"failed".

The 5%-overshoot claim (SC-006) is asserted structurally rather than by threshold: the bound is what
the enforcement mechanism makes possible, not a number chosen to pass.

An agent limit set above the workspace ceiling not raising what a run may consume, and the member
being told which limit applies (FR-079a), is in
`apps/web/tests/integration/limit-cap.test.ts`.

## Cross-cutting checks

All four audits were run against the development database. Their verdicts, verbatim:

| Criterion | Verdict | What it examined |
| --- | --- | --- |
| SC-011 credentials in output | **PASS** | 105 runs: 3 log chunks, 24 artifacts with text, 3 merge requests, 27 failure details |
| SC-007 concurrency contention | **INCONCLUSIVE** | 33 completed steps; no step ran both alone and contended, so there is no baseline |
| SC-012 sandbox release | **PASS** | 101 finished runs, all naming no container |
| SC-002 first-attempt rate | **FAIL** — 20% | 15 tickets with a settled outcome |

Three of these deserve saying plainly rather than being presented as results:

**SC-011's pass is real, and was proved to be capable of failing.** A `glpat-…` planted in a log
chunk was caught, reported by shape with the value withheld, and the script exited 1. The clean run
then exited 0 and an empty window exited 2.

**SC-007 is inconclusive because the data is serial, not because the check is broken.** Its
arithmetic is exercised on data built to contain the answer in
`scripts/audit/tests/contention.test.ts` — including the cases that would otherwise hide a
slowdown: averaging across step kinds, and a mean baseline that one pathological control would
inflate.

**SC-002's 20% is not a measurement of the product.** The population is browser-test tickets, most
of them deliberately made to fail or be cancelled in order to test failure and cancellation. The
audit is reporting exactly what it should about the data it has; the data is not real operation.
This number becomes meaningful after real tickets, and the script's `--exclude` exists for the
judgement no script can make.

**SC-012's pass required a correction.** It first reported four overdue sandboxes, all named
`container-e2e` — debris from browser tests against a fake container host, where the ids never
named a real container. Those rows were cleared with that reasoning recorded in the statement. What
the finding exposed before that was genuine and is fixed: nothing in the product released a sandbox
at all (see below).

## What running these actually found

Running the scenarios, rather than reading them, found five defects. All five were the same shape —
correct logic that nothing reached:

1. **Nothing released a sandbox.** `sandboxesToRelease` had no caller, no `releaseSandbox` was ever
   supplied, and neither release site cleared `runs.container_id`. SC-012 could not have passed.
   Now driven by `scripts/maintenance.ts`.
2. **Nothing composed a merge request body.** The workflow opened the merge request with a field
   nothing ever set.
3. **`/settings` answered 500 on a fresh deployment**, and there was no way out by hand.
4. **The Runner connection test could not fail on a credential.** A wrong token reported "it
   accepted our credential".
5. **Key rotation would have destroyed every stored credential.**

The maintenance pass was then verified end to end against the live Runner — web → HTTP → the
Runner's own decision → a reported problem naming the run and container, exit 1. Every link works
except the container host itself.

## What remains for a real deployment

An operator with a provider credential, an n8n instance and a Docker host should:

1. Un-skip the three tests in `ticket-to-mr.spec.ts` by providing the environment they gate on, and
   run scenario A to an actual merge request.
2. Confirm the merge request is accepted by **both** providers. The field shapes differ
   (`source_branch`/`description` against `head`/`body`), both are produced, and neither has been
   acknowledged by a provider.
3. Look at whether the Screens section renders, and decide about signed artifact addresses.
4. Run scenario E's request-changes case with a real design credential, and confirm the existing
   design source is revised rather than redrawn.
5. Re-run `audit:concurrency` after starting more tickets than the cap allows — that is the only way
   to turn its INCONCLUSIVE into a verdict.
6. Re-run `audit:first-attempt` once there are real tickets, and use `--exclude` for those whose
   criteria somebody has judged incomplete.

[operations.md](../operations.md) lists what to have ready before starting, so none of that time is
spent hunting for an address or a token.
