# Merge request legibility review

**Criterion**: SC-014 — a reviewer who never saw the ticket can judge each merge request from the
merge request alone.
**Task**: T228 · **Date**: 2026-09-10 · **Reviewer**: the implementing engineer, reading as a
reviewer who has not seen the ticket

## What was reviewed

A merge request body generated from a real run, not a reading of the code that builds one. The run
was seeded through `startRun` with a specification, a plan, two screens, a committed design source,
one skipped step, a cost and a duration, and the body was composed through `mergeRequestBody` —
the same path the orchestration service takes.

The review was done twice: once on the body as it stood, and once after acting on the findings.

## The finding that mattered: nothing composed the body at all

`composeMergeRequest` had **no caller**. The workflow's "Open merge request" node sent
`$json.merge_request`, and nothing anywhere in the workflow ever set that field. A real merge
request would have been opened with an undefined body — no description, no criteria, no
specification, no link back.

The composer was written, and its shape was right. It was simply never reached. That is the same
class of gap as the credential exchange found in Phase 10: a well-formed component with nothing on
the other end of it. SC-014 was not "partly met"; it was untestable, because no body existed to
judge.

**Closed by** an authenticated `GET /api/runs/:id/merge-request`, which the workflow now fetches
between `verify-and-push` and `Open merge request`. The body is composed by the application because
it needs the run's whole record — the ticket's criteria, the documents the agents wrote, the
screens' addresses *on this deployment*, which steps did not run, what it cost — and the
orchestration service holds only the snapshot. A new node shapes the fetched body per provider,
because GitLab and GitHub disagree about every field name.

`apps/web/tests/contract/workflow.test.ts` now asserts that the composer is reached and that
`verify-and-push` does **not** connect straight to the opening node, so this cannot silently
reopen.

## The body as it stood

```
Users should be able to sign in with Google.

## Screens
![screen](…/api/artifacts/abc/image)
[Open the design source](…)

## Acceptance criteria
- [ ] A Google button appears on the sign-in screen
- [ ] Tests pass

<details><summary>Specification</summary> … </details>
<details><summary>Plan</summary> … </details>

## Run
- Cost: $1.8400
- Duration: 14 min
- Attempt: 1
- [Open ticket #142](…)
```

## Findings, and what was done

| # | Finding | Judgement | Action |
| --- | --- | --- | --- |
| 1 | **The specification was collapsed.** The part a reviewer needs to decide whether this is the right change sat behind a disclosure triangle, under a one-line ticket description. A `<details>` block is where things go to be unread; on both providers it is closed by default and skipped by find-in-page. | Against SC-014 directly. The criterion is about judging the change, and the material for that judgement was hidden. | Promoted to a plain `## Specification` section. The plan stays collapsed: it is *how* the work was done, which the diff already shows. |
| 2 | **Every screen was captioned "screen".** `![screen](url)`, repeated. With three screens a reviewer cannot tell which is which, and `artifacts.screen_name` already held the answer. | A real defect for any interface ticket, which is exactly the ticket where screens matter. | Each screen carries its name; an unnamed one gets `Screen 1`, `Screen 2`, which is still better than three identical captions. |
| 3 | **A document edited by a person read as the agent's work.** `artifacts.created_by` records a gate edit, and the body said nothing. An edited specification is a human's words and deserves more weight, not the same weight. | Material. A reviewer calibrates trust by who wrote a thing. | `## Specification (edited by a person at a review gate)` when `created_by` is set. |
| 4 | **A skipped step was invisible.** A ticket labelled `ui` with no screens is simply puzzling, and FR-111 requires the reason be stated. | Material for any pipeline with conditions. | A `## Steps that did not run` section, quoting each condition that was not met. |
| 5 | **Screens came out alphabetically.** `sign-in-error.png` sorts before `sign-in.png`, so a reviewer met the failure state before the thing that fails. | Small but genuinely confusing. | Ordered by creation, which is the order the design step produced them. A revision replaces its screen in place rather than moving it to the end. |
| 6 | **`Cost: $1.8400`** read like machine output rather than money. | Cosmetic. | `$1.84`. Trailing zeros trimmed; a genuinely fractional cost keeps its digits. |
| 7 | **`Attempt: 1`** told a reader nothing unless they already knew what an attempt was. | Cosmetic, but a second attempt is worth noticing. | `First attempt`, or `Attempt 2 for this ticket`. |
| 8 | **Nothing said the system would not merge.** A reviewer meeting an automated merge request reasonably wonders whether it is about to merge itself. FR-070 says it never does. | Worth one line. | `Opened by Code Factory, which never merges: this waits for a person.` |

## The body after

```
Users should be able to sign in with Google.

## Screens

![Sign in](https://factory.netgroup.mn/api/artifacts/7f3177de-…/image)

![Sign in — Google refused](https://factory.netgroup.mn/api/artifacts/b4e0d09b-…/image)

[Open the design source](https://gitlab.com/netgroup/shop-frontend/-/blob/factory%2F142-add-google-oauth-sign-in/design/sign-in.pen)

## Acceptance criteria
- [ ] A Google button appears on the sign-in screen
- [ ] Tests pass

## Specification

**What changes.** A "Continue with Google" button appears on the sign-in
screen, beside the existing email and password form.

**Why.** Most of our users already have a Google account, and the current
form is the most common place people abandon sign-up.

**Out of scope.** Linking Google to an existing email account. A user who
signs in with Google for the first time gets a new account.

<details>
<summary>Plan</summary>

1. Add the provider configuration and the two environment variables it needs.
2. Add the callback route, which exchanges the code and finds or creates the user.
3. Add the button to the sign-in screen.
4. Cover the find-or-create branch both ways.

</details>

## Steps that did not run
- Step 5: no migration was produced by the implementing step

## Run
- Cost: $1.84
- Duration: 14 min
- First attempt
- [Open ticket #142](https://factory.netgroup.mn/tickets/88314463-…)
- Opened by Code Factory, which never merges: this waits for a person.
```

Labels: `code-factory`, `pipeline:standard`, `ui`. Branch:
`factory/142-add-google-oauth-sign-in` → `main`.

## Verdict

**Met, with one reservation stated below.** Reading only the body above, a reviewer who has never
seen the ticket knows what the change is meant to do, what it must satisfy, what was intended
visually, what the pipeline chose not to do and why, what it cost, and that a person still has to
decide. Everything needed for the judgement is in the body; the ticket link is a convenience, not a
dependency.

**Reservation.** This was judged on a generated artefact against a seeded run, not on a merge request
open on GitLab or GitHub — no provider credential is available in this environment (see
[first-run-walkthrough.md](./first-run-walkthrough.md) for the full list of what is blocked). Two
things can only be confirmed against a real provider:

- that both field shapes are accepted — GitLab's `source_branch`/`description` and GitHub's
  `head`/`body`. The shaping node is asserted to produce both, and the contract test checks the
  field names, but no provider has replied to either.
- that the screen images render. They are served from `/api/artifacts/:id/image`, which requires the
  deployment to be reachable from the provider. A private deployment will show broken images, and
  the body will still be readable but the screens will not be visible. This is worth an operator's
  attention at install time, and is noted in [operations.md](../operations.md).

## Not done, and why

- **A file list or diff summary in the body.** Considered and rejected: the provider already shows
  the diff better than a description can, and a stale list is worse than none.
- **The test suite's result in the body.** A shell step's outcome is on the run, and CI reports on the
  merge request itself. Copying it in would be a second source of truth that could disagree with the
  first.
