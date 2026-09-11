# `run-ticket-pipeline`

One generic workflow serves every pipeline. It is never edited per pipeline,
because a pipeline is data (FR-024).

## Importing

1. In n8n: **Workflows → Import from file →** `run-ticket-pipeline.json`.
2. Set two environment variables on the n8n instance: `RUNNER_BASE_URL` and
   `RUNNER_AUTH_TOKEN`. The Runner is not reachable from the public internet,
   so n8n must sit where it can reach it.
3. Activate the workflow and copy the production webhook address into the
   Factory app under **Settings → Orchestration**.
4. Add provider credentials for the **Open merge request** node.

The Factory app posts the resolved snapshot to the webhook; everything the
workflow needs is in that one payload (`contracts/orchestrator.md` §1).

## What this workflow must never do

These are the invariants that keep it generic. A change that breaks one of
them is a change to the product, not to the workflow:

- **Look anything up.** It reads only the snapshot it was handed. No pipeline,
  agent, skill or ceiling is fetched (FR-044).
- **Hold state** beyond the current execution.
- **Decide what a step *means*.** `Decide next step` evaluates the condition and
  `Switch on step type` branches on the type. Nothing else (Principle III).
- **Store a credential.** Credentials reach the container from the Runner, never
  through here (FR-083).
- **Merge a merge request.** It opens one; a human merges (FR-070).

## The two Code nodes

`Decide next step` and `Advance` mirror
[`packages/shared/src/step-loop.ts`](../../packages/shared/src/step-loop.ts),
which is typechecked and covered by 14 tests. When you change the loop, change
that module first and copy it here — the tests are the specification of this
behaviour:

- a condition that does not hold yields `skip`, recorded with its reason and
  never a failure, and the run continues at the next index (FR-110, FR-111)
- an unestablished fact reads as false, so a ticket with no classification
  skips design rather than guessing yes (FR-102)
- the classification is carried forward from the step that established it
- a ceiling reached after any step fails the run, naming the ceiling (FR-081)

## Not yet exercised

This workflow has **not been executed** — the environment it was written in has
no n8n instance and no Docker daemon. Its JSON is valid and every connection
resolves to a real node, but the first real import will likely need small
adjustments to node type versions for your n8n release. The logic it carries is
tested independently in `packages/shared`.
