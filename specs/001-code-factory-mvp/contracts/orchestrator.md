# Contract: Factory App ⇄ Orchestrator (n8n)

Three interactions: the app **triggers** a run, the orchestrator **reports** progress, and the app
**resumes** a paused run. One generic workflow serves every pipeline — it is never edited per
pipeline, because a pipeline is data (FR-024).

## 1. Trigger — app → orchestrator

`POST {orchestrator_base_url}/webhook/run-ticket-pipeline`

The body is the **resolved snapshot**: pipeline, agents, skills and ceilings already flattened
(FR-044). The orchestrator looks nothing up.

```
{ run_id, attempt,
  ticket:  { reference, title, description, acceptance_criteria[] },
  repo:    { clone_url, default_branch, branch, provider, credential_ref },
  pipeline:{ id, version, name, steps[] },          // steps carry type + condition
  limits:  { cost_ceiling_usd, time_ceiling_minutes },
  sandbox: { image, cpu, memory_mb, wall_clock_minutes, network_during_implement },
  callback_url, resume_secret }
```

`sandbox` is what an administrator set for the workspace (FR-085), pinned here for the same reason
the ceilings are: a limit changed mid-run must not reshape a container already running. It travels
in the snapshot because the snapshot is the only channel to the Runner — the Runner cannot read a
workspace setting, and without this it fell back to figures compiled into it, so nothing an
administrator set had any effect.

Delivery is retried with increasing delays if the orchestrator is unreachable; the ticket stays
`queued` and the user is told the run has not begun (FR-094).

## 2. Step loop — the orchestrator's only logic

For each step in order (FR-049):

1. **Evaluate `condition`** against facts the run has established (FR-032c). The only fact today is
   `ticket.has_ui`, returned by the specification step and carried forward.
   False ⇒ post `step_skipped` with the condition that failed and move on **without** calling the
   Runner (FR-110, FR-111).
2. Otherwise branch on `type` — and only on `type`:
   - `agent`, `design`, `shell` → call the Runner (see [runner.md](./runner.md))
   - `checkpoint` → post `waiting_approval` carrying the resume address, then wait
   - `notify` → send on the configured channel
3. After each step: if it failed, or a ceiling is exceeded, go to the failure path (FR-055).
4. **Before beginning the next step**, honour a pause. The reply to every callback carries
   `paused`; when it is true the step that was running has already concluded and nothing further
   begins — post `paused` carrying the resume address, then wait (FR-096).

Then push the branch, open the merge request (FR-065), post `done`, and destroy the container.

## 3. Callbacks — orchestrator → app

`POST {callback_url}` — every event carries `run_id`, `attempt`, `step_index`, `event`.

| Event | Payload | Effect |
| --- | --- | --- |
| `started` | `container_id` | Run → `running` |
| `step_started` | — | Step → `running` |
| `step_finished` | `status, duration_s, cost_usd, engine_session_id, summary, artifacts[]` | Step recorded; cost added to the ledger |
| `step_skipped` | `condition_not_met` | Step → `skipped`, run continues (FR-111) |
| `ticket_classified` | `has_ui, rationale` | Sets the ticket's classification (FR-099, FR-100) |
| `waiting_approval` | `resume_url, approvers` | Run and ticket → `waiting_approval`; approvers notified (FR-057, FR-058) |
| `paused` | `resume_url` | Resume address stored; run keeps its status, so the interface shows where it stopped (FR-096) |
| `log_chunk` | `seq, stream, text` | Appended; pushed to viewers (FR-076) |
| `mr_opened` | `merge_request_url` | Stored on the ticket (FR-069) |
| `done` | `merge_request_url, cost_usd` | Ticket → `done` (FR-070a) |
| `failed` | `step_index, reason, detail` | Run → `failed` with a readable reason (FR-087) |
| `cancelled` | — | Run → `cancelled`, sandbox released (FR-097) |

**Every callback is idempotent.** `(run_id, step_index)` is the key; a repeat is a no-op and must
not advance the run twice (FR-095). Authenticated with `resume_secret`; unauthenticated calls are
rejected without revealing whether the run exists.

**Every reply carries whether the run may continue**: `{ applied, paused, continue }`. A pause is
answered here rather than polled for, because the orchestrator already posts after every step — the
step in flight concludes and this reply is what stops the next one beginning (FR-096).

## 4. Resume — app → orchestrator

`POST {resume_url}` when a human decides at a gate (FR-060, FR-061), or `{ paused: false }` when a
pause is withdrawn and the run continues from where it stopped (FR-096):

```
{ decision: "approved" | "changes_requested" | "edited" | "cancelled",
  feedback?, edited_paths?[] }
```

- `approved` / `edited` → continue at the next step; `edited` means the artifact was already
  rewritten, so following steps read the new version (FR-062)
- `changes_requested` → re-run the **preceding** step with `feedback` available to it, then return
  to this same gate (FR-061). Where the preceding step is a design step, it revises the existing
  design source rather than starting fresh (FR-061a, FR-106)
- `cancelled` → failure path, sandbox released

The app stores `resume_url` (data-model.md), so a gate remains drivable even if the orchestrator
execution is lost. Change-request loops are bounded by the run's ceilings, not a round count
(Assumptions).

## What the orchestrator must never do

- Look up a pipeline, agent, skill or ceiling — it only ever reads the snapshot it was handed
- Hold state beyond the current execution
- Decide what a step *means*; it branches on `type` and `condition`, nothing more
- Store a credential (FR-083)
- Merge a merge request (FR-070)
