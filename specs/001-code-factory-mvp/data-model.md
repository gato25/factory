# Phase 1 Data Model: Code Factory MVP

**Feature**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Date**: 2026-09-10

Fifteen tables in Postgres, defined in `packages/db` with Drizzle and migrated with `drizzle-kit`.
The schema is the source of the shared types, so the web app and the Runner cannot disagree about
the shape of a step result.

Every table carries `id` (uuid), `created_at` and `updated_at` unless noted. Money is `numeric(10,4)`
in USD — never a float, because ceilings are enforced against it (FR-079, SC-006).

---

## Configuration

### `workspaces`
One row per deployment (Assumptions: single workspace). `name`, `model_credential_id`,
`design_credential_id`, `orchestrator_base_url`, `orchestrator_workflow_id`, `runner_base_url`,
`default_cost_ceiling_usd`, `default_time_ceiling_minutes`, `max_concurrent_runs`,
`sandbox_image`, `sandbox_cpu`, `sandbox_memory_mb`, `sandbox_network_during_implement` (bool),
`retain_failed_sandboxes_hours`.

The ceilings here are the ones a member's own limits cannot exceed (FR-079a).

### `users`
`name`, `email` (unique), `avatar_url`, `role` (`admin` | `member`), `password_hash` (nullable —
null for accounts that only sign in through a provider), `provider`, `provider_user_id`.

`role` gates workspace credentials, connections, ceilings and membership only (FR-004). It does not
gate pipelines, agents or skills — those go by ownership (FR-006, FR-006c).

### `credentials`
`kind` (`git` | `model` | `design`), `ciphertext`, `key_version`, `last_verified_at`,
`status` (`valid` | `invalid` | `unverified`).

Never readable back in plaintext through any interface (FR-011, FR-084). The application holds the
key; the Runner receives resolved values per run and passes them to the container as environment
(D8).

### `repositories`
`name`, `full_path`, `provider` (`gitlab` | `github` — no other value, FR-014a), `clone_url`,
`default_branch`, `credential_id`, `default_pipeline_id`, `status`
(`connected` | `credential_expired` | `error`), `status_detail`.

`status <> 'connected'` blocks new runs (FR-013). `provider` is a two-value enum on purpose: a
third value is what FR-014b must refuse.

### `pipelines` / `pipeline_versions`
`pipelines`: `name`, `description`, `owner_id`, `current_version`.

`pipeline_versions`: `pipeline_id`, `version` (unique per pipeline), `steps` (jsonb), `created_by`.

Immutable once written — a save writes a new row and advances `pipelines.current_version`
(FR-027). Runs reference a version row, never the pipeline, which is what makes SC-010 achievable.

Each entry in `steps` is:

```
{ type: "agent" | "design" | "checkpoint" | "shell" | "notify",
  condition: "always" | "ticket_has_ui" | "ticket_has_no_ui",   // FR-032a, default "always"
  agent_id?, output_files?: string[],                            // agent | design
  design?: { source_path, export_dir, export_scale, screens? },  // design
  approvers?: "anyone" | "ticket_creator" | uuid[],               // checkpoint
  timeout_hours?, on_timeout?: "wait" | "continue" | "fail",      // checkpoint
  command?,                                                       // shell
  channel?, template? }                                           // notify
```

### `agents`
`name`, `description`, `icon`, `kind` (`default` | `custom`), `owner_id` (null for shipped
defaults, FR-006b), `engine` (`claude_cli` | `design_cli`), `model`, `system_prompt`,
`allowed_tools` (text[] — empty and ignored when `engine = 'design_cli'`, FR-036a),
`max_cost_usd`, `max_minutes`, `max_turns`, `default_config` (jsonb, for reset — FR-040).

### `skills`
`name` (slug, unique), `description`, `content`, `owner_id`, `updated_by`.

`description` is given to the agent so it knows when to apply the skill (FR-043).

### `agent_skills`
`agent_id`, `skill_id`. Primary key on both — a skill attaches to any number of agents (FR-042).

---

## Work

### `tickets`
`repository_id`, `created_by`, `reference` (human-readable, unique — `#142`), `title`,
`description`, `acceptance_criteria` (text[]), `pipeline_id`, `pipeline_version`, `status`,
`current_run_id`, `branch_name`, `merge_request_url`, `has_ui` (bool, nullable),
`ui_rationale`, `classification_missing` (bool, default false).

`has_ui` is null until the specification step decides (FR-099). `classification_missing` is what
FR-102's warning hangs on: set when no usable decision arrived, read by the run view so the warning
is a field rather than a log line.

Nobody sets `has_ui` at creation time — FR-101 forbids asking.

### `runs`
`ticket_id`, `attempt`, `snapshot` (jsonb — the whole resolved pipeline, D7), `status`,
`current_step_index`, `orchestrator_execution_id`, `resume_url`, `container_id`, `runner_image`,
`cost_usd`, `cost_ceiling_usd`, `time_ceiling_minutes`, `failure_reason`, `failure_step_index`,
`started_at`, `finished_at`.

`(ticket_id, attempt)` unique. `resume_url` is stored so a gate can be driven even if the
orchestrator execution is lost (research.md, risk 2).

### `step_results`
`run_id`, `step_index`, `status`, `condition_not_met` (text, null unless skipped),
`started_at`, `finished_at`, `duration_s`, `cost_usd`, `engine_session_id`, `summary`,
`log_ref`, `error_detail`.

`(run_id, step_index)` unique — this is the idempotency key. A repeated report of an outcome already
recorded is discarded rather than creating a second row or advancing the run twice (FR-095).

`condition_not_met` carries the condition that was false, which is what FR-110 requires be stated
and FR-075a requires be shown.

### `artifacts`
`run_id`, `step_index`, `kind`, `path`, `version`, `content` (text, null for binary),
`bytes` (bytea, null for text), `screen_name` (null unless `kind = 'screen'`), `created_by`
(null unless a human edited it at a gate).

`kind` is one of `document`, `design_file`, `screen`, `commits`, `merge_request`.
`(run_id, path, version)` unique. Versions are additive — a human editing a document at a gate
writes a new version and the previous one is retained (FR-054, FR-062).

The spec's **Screen** entity is `kind = 'screen'` here rather than its own table: a screen is an
artifact in every respect that matters — versioned, belonging to a run and a step, retained — and
splitting it would duplicate the versioning rules. `screen_name` and `bytes` are what distinguish
it, and `kind` is what the gallery filters on (FR-077).

### `approvals`
`run_id`, `step_index`, `decided_by`, `decision` (`approved` | `changes_requested` | `edited` |
`cancelled`), `feedback`, `decided_at`, `timed_out` (bool).

`(run_id, step_index)` unique — this is what makes FR-064a enforceable in the database rather than
in application logic: the second decider's insert fails and they are told the gate is already
decided.

`timed_out` records a gate that continued or failed without a human (FR-064b).

### `log_chunks`
`run_id`, `step_index`, `seq`, `stream` (`stdout` | `stderr`), `text`, `at`.

`(run_id, step_index, seq)` unique. Credentials are redacted at ingest, never at display (D8), so a
later change to the viewer cannot un-redact them.

---

## State machines

**Ticket** — mirrors its current run (FR-022):

```
draft ──► queued ──► running ⇄ waiting_approval ──► done
                        │                            
                        ├──► failed ──► (retry) ──► queued
                        └──► cancelled ──► (retry) ──► queued
```

**Run** (FR-022, FR-055, FR-111):

```
queued ─► running(i) ─► running(i+1) … ─► opening_mr ─► done
             │  ▲
             │  └─ approved | edited ──────────┐
             ├─► waiting_approval(i) ──────────┤
             │      ├─ changes_requested ─► running(i−1, with feedback)
             │      └─ timeout ─► per step: wait | continue | fail
             ├─► failed        (step failed, ceiling reached, engine unreachable)
             └─► cancelled     (user action, any point)
```

**Step** (FR-110–FR-112):

```
pending ─► running ─► done
   │                   
   ├──────────────────► failed    (terminal; stops the run — FR-055)
   └──────────────────► skipped   (terminal for this step only; run continues — FR-111)
```

`skipped` is deliberately not a kind of `done` and not a kind of `failed`. FR-112 requires all four
of `pending`, `running`, `done`, `failed` and `skipped` to be distinguishable wherever outcomes
appear, which rules out modelling it as `done` with a flag.

---

## Invariants the database enforces

These are requirements strong enough to belong in constraints rather than in code:

| Invariant | Requirement | Mechanism |
| --- | --- | --- |
| At most one active run per ticket | FR-020 | Partial unique index on `runs(ticket_id)` where `status` not terminal |
| One decision per gate | FR-064a | Unique `(run_id, step_index)` on `approvals` |
| A callback cannot be applied twice | FR-095 | Unique `(run_id, step_index)` on `step_results`; upsert-with-no-op |
| Attempts are sequential per ticket | FR-045 | Unique `(ticket_id, attempt)` on `runs` |
| Artifact versions are additive | FR-054 | Unique `(run_id, path, version)`; no updates, only inserts |
| A run's snapshot never changes | FR-044, SC-010 | `snapshot` written once at creation; no update path |
| A pipeline version never changes | FR-027 | `pipeline_versions` insert-only |
| Only two git providers exist | FR-014a/b | Enum with exactly `gitlab`, `github` |
| Log ordering is total per step | FR-076 | Unique `(run_id, step_index, seq)` |
| A member's limit cannot exceed the workspace's | FR-079a | Ceilings resolved as `least(agent, pipeline, workspace)` at snapshot time, stored on the run |

## Validation applied above the database

| Rule | Requirement |
| --- | --- |
| A pipeline must contain a code-producing step; verification, gates and notifications may follow it | FR-028 |
| A design step must not precede the step that classifies the ticket | FR-032e |
| A condition must not depend on a fact unestablished at that point in the pipeline | FR-032d |
| Required output files must exist and be non-empty after an agent step | FR-051 |
| A design step must yield a design source and at least one image | FR-104 |
| A repository credential must prove read, branch-create and merge-request-open before saving | FR-008, FR-009 |
| Only the owner or an administrator may change a pipeline, agent or skill | FR-006c |
| Only a gate's configured approvers may decide it | FR-064 |
