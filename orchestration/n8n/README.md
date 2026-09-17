# `run-ticket-pipeline`

One generic workflow serves every pipeline. It is never edited per pipeline,
because a pipeline is data (FR-024).

## Importing

`bun run dev` runs n8n on your machine — installed with npm the first time — imports this file,
publishes it, and starts n8n with the two environment variables below. Nothing in this section
needs doing by hand on a development machine; it is written down because a deployment still does
it, and because the fields below are what make it work.

By hand, in n8n: **Workflows → Import from file →** `run-ticket-pipeline.json`, then publish it
(n8n 2 says *publish*; older releases say *activate*). Either way you still need to:

1. Set two environment variables on the n8n instance: `RUNNER_BASE_URL` and `RUNNER_AUTH_TOKEN`,
   and `N8N_BLOCK_ENV_ACCESS_IN_NODE=false` so an expression may read them. n8n must sit where it
   can reach the Runner, which is not reachable from the public internet.
2. Add provider credentials for the **Open merge request** node.

### Publishing from the command line, on n8n 2

`n8n publish:workflow --id=RunTicketPipeln1` marks the workflow active and records the version,
and the workflow still answers `The requested webhook "POST run-ticket-pipeline" is not registered`.
Since n8n 2 the server activates what is recorded in the `workflow_published_version` table, which
the editor's Publish button writes and the command line does not. `bun run dev` fills that row
itself, from the version the command did record, against n8n's own SQLite file — see
`ensurePublishedVersion` in `scripts/dev.ts`. Publishing from the editor needs none of this.

### Three fields that are not decoration

- **`webhookId`** on the webhook node. Without it n8n does not register the
  node at `/webhook/run-ticket-pipeline` at all — it registers the fallback
  form `<workflowId>/<node name>/<path>`, so the workflow is active, looks
  right in the interface, and answers the address the app posts to with 404.
- **`active`**. The column is `NOT NULL`, so importing a file without it fails
  with `SQLITE_CONSTRAINT` and no other explanation.
- **`responseMode: onReceived`** on the webhook node. The app posts a snapshot
  and needs an answer at once; with `responseNode` the answer came when the
  workflow ended, minutes later, and was whatever ended it.
- **`id`**. The import matches on it, so re-importing updates this workflow
  instead of adding a second one with the same name beside it.

Import with `--separate --input=<directory>`, not `--input=<file>`: given a
single file n8n's importer expects the JSON to be an array and fails with
`workflows.map is not a function`. Keeping this file a single object is what
lets it also be dragged into the interface by hand.

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

## Where a value comes from

n8n hands each node the **output of the node before it**. After an HTTP Request
node — and after a Wait — `$json` is that request's response, not the run. The
state does not flow through them, however much the shape of the canvas suggests
it does.

So a node that needs the run reads it by name:

- `$('Initialise state').first().json` — everything fixed for the whole run:
  `run_id`, `attempt`, `callback_url`, `resume_secret`, `repo`, `pipeline`,
  `limits`, `sandbox`.
- `$('Decide next step').first().json` — everything that changes per iteration:
  `step`, `step_index`, `facts`, `feedback`.

`$json` on its own is right only where the node before is a Code, Set or Switch
node, or where the response itself is what is wanted. A contract test refuses
any node that reads run state through `$json` while sitting behind an HTTP or
Wait node, because the mistake is invisible in the editor: the expression is
valid, the field exists elsewhere, and nothing says it is being read from the
wrong place.

## How far this has been exercised

Against n8n 1.75.2 in a container: it **imports, activates, registers its
webhook, accepts a snapshot, reaches the runner and posts its first callback to
the application**, which authenticates it. The three fields above, the
`--separate` form and the state rule are what the first real executions turned
out to need, exactly as the note that used to sit here predicted.

Against n8n 2.40.2 on a Windows machine, with Node 24, runs executing as
processes: it imports and publishes from the command line (with the
published-version row above), registers its webhook, starts a run, runs the
specification step to completion and posts its result. The first real step to
finish found two things the happy-path reasoning had not: the **step finished**
callback carried no status, cost or artifacts — it spread a field only a skipped
step sets — so the app answered 500 and every run stopped at its first finished
step; and the webhook answered only when the whole workflow ended, so the app's
trigger request sat open for the entire run and then reported whatever ended
it. The callback now carries the runner's own answer, and the webhook answers
as soon as it has the body. The steps after the first, the checkpoint and the
merge request have still not been observed.

Past that first callback, only the **happy path** has been reasoned through and
none of it observed:

- **Not observed:** a step actually running, the loop advancing, the merge
  request being composed or opened.
- **Not exercised at all:** the checkpoint path (`Wait for a human` and the
  change-request rewind), the pause path (`Wait while paused`), and the
  budget-ceiling failure. Each depends on what the resuming request puts in
  `$json`, and that can only be confirmed by resuming one.

The loop's logic is tested independently in `packages/shared`, and the workflow
file's own invariants in `apps/web/tests/contract/workflow.test.ts`.
