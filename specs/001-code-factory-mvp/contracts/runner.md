# Contract: Factory App / Orchestrator ⇄ Runner

The Runner is the only component with rights on the execution host. It exposes four operations, and
every one of them — `/health` excepted — requires the Runner's own credential.

**Amended 2026-09-11 (002 FR-018, constitution 2.0.0).** This used to read "is never reachable from
the public internet", which was true of a daemon on a private network and is no longer true of a
deployment served as a Worker: such a deployment has a public address by construction. So the
credential is not defence in depth any more, it is the whole boundary. Three obligations follow, and
they are stated here rather than left to a reader to infer:

- Every operation that creates, inspects, uses or releases a sandbox authenticates (002 FR-018).
- A refusal reveals nothing about whether the run it names exists (002 FR-019).
- The credential is replaceable without interrupting runs in flight: the outgoing one is accepted
  alongside the new one for a window, and removing it is what refuses it (002 FR-018a).

Calls are still authenticated per run for the callbacks in the other direction — the run's own
secret — which is a separate credential from the Runner's.

## `POST /runs/{run_id}/start`

Creates the sandbox and prepares the workspace. Body carries the snapshot — which holds credential
REFERENCES, never values, because FR-083 forbids the orchestration service persisting one.

The Runner exchanges those references itself, by posting to
`POST /api/runs/{run_id}/credentials` on the app with the run's own secret. That keeps the
orchestrator out of the credential path entirely: it carries a reference it cannot use, and the two
components that need the value talk directly.

Sequence (FR-046–FR-048):

1. Start one fresh container from the workspace image — non-root, with the configured CPU, memory
   and wall-clock ceilings, workspace at `/work`. Never reuse a container (FR-047).
2. Inject `ANTHROPIC_API_KEY`, the repository git credential, and — only if the pipeline contains a
   design step — the design credential, as environment variables. Never written into the workspace
   (FR-083, FR-083a).
3. Verify the design credential now, if present, and fail fast with a message naming where it is
   configured (FR-083b).
4. Clone the repository at `default_branch` and check out the run's branch.
5. Write each agent's system prompt and each attached skill into the workspace's agent
   configuration, substituting the run's values for prompt variables (FR-037).

Returns `{ container_id }`. → `started` callback.

## `POST /runs/{run_id}/steps/{index}`

Executes exactly one step and returns when it is finished. Body is the step from the snapshot plus
`{ feedback?, has_ui? }`.

```
{ status: "done" | "failed",
  duration_s, cost_usd, engine_session_id, summary,
  artifacts: [ { kind, path, screen_name?, version } ],
  classification?: { has_ui, rationale },     // specification step only
  error?: { reason, detail } }
```

Responsibilities:

- Dispatch to the right engine by step type (see [step-engines.md](./step-engines.md))
- Stream stdout and stderr as `log_chunk` callbacks while running, with credentials redacted at
  ingest (FR-076, D8)
- **Check required outputs.** Every `output_files` entry must exist and be non-empty, or the step
  failed (FR-051). A design step must additionally have produced a design source and at least one
  exported image (FR-104)
- Capture produced files as artifacts with the right `kind`, and commit the design source and
  screens to the branch (FR-103, FR-105)
- Enforce the agent's own cost, time and turn limits, and kill the process when a ceiling is
  reached, reporting the ceiling as the reason (FR-080, FR-081)
- Report cost from the engine's own reported usage, never from an estimate of our own (D6)

A failed step leaves whatever was produced in place for inspection (FR-104).

## `POST /runs/{run_id}/verify-and-push`

Pushes the run's branch. It runs **no tests of its own** — verification exists only as a shell step
an author added to the pipeline (FR-055a, FR-055b). The name is kept because pushing is the gate
before a merge request is opened.

Reports separately when the branch pushed but the merge request could not be opened, so that state
is distinguishable from total failure (FR-098).

## `DELETE /runs/{run_id}`

Destroys the container within five minutes of the run ending (SC-012), unless the workspace is
configured to retain failed runs' sandboxes for diagnosis, in which case it is retained for the
configured window and destroyed after (FR-086).

## `POST /runs/{run_id}/execute`, `POST /runs/{run_id}/resume`, `GET /runs/{run_id}/orchestration`

The orchestrator's own routes, since it moved into this service: the trigger, the answer to a wait,
and where a run is. Their payloads are those of [orchestrator.md](./orchestrator.md) §1 and §4; the
third returns the run's position without its snapshot. The four operations above remain, and are
what the loop calls.

## Recovery

If the sandbox or its host becomes unavailable part-way through a step, the step is attempted once
more in a new container, resuming from the last commit on the branch; a second failure fails the run
(FR-093). On a retry of a whole run, the branch is reset to a known state rather than accumulating
two attempts' work (FR-091).
