# Phase 1: Data Model — Run a ticket's branch on a real port

**Feature**: `specs/003-launch-branch` | **Date**: 2026-09-14 | **Spec**: [spec.md](./spec.md)

One new table, two new columns, and one short-lived record held by the execution service. The
migration is `packages/db/migrations/0006_launches.sql`.

---

## `launches` — one row per attempt to run a ticket's branch

`packages/db/src/schema/ticket.ts`. A launch belongs to a ticket and to the repository the ticket
is for; it is deleted with the ticket.

| Column | Type | Meaning | Requirement |
|---|---|---|---|
| `id` | uuid | The row | — |
| `ticket_id` | uuid → `tickets`, cascade | Whose branch is running | FR-001 |
| `repository_id` | uuid → `repositories` | Where the branch lives, and whose run settings applied | FR-005 |
| `runner_launch_id` | text | The execution service's own id for it; every look and Stop goes through this | FR-007 |
| `branch` | text | The branch as pushed, pinned at start | Constitution IV |
| `command` | text | What actually ran, once known. `(detecting)` until the service says | FR-004, FR-005 |
| `url` | text, nullable | What a browser here opens while it runs; cleared when it stops | FR-006, FR-013 |
| `status` | `launch_status` | `starting`, `running`, `failed`, `stopped` | FR-007 |
| `detail` | text, nullable | Why it failed or stopped, in words a person can act on | FR-007, SC-002 |
| `started_by` | uuid → `users`, nullable | Who pressed Run it | — |
| `stopped_at` | timestamptz, nullable | When it ended, whatever ended it. Null means live | FR-015 |
| `created_at`, `updated_at` | timestamptz | As every table | — |

**One live launch per ticket** is a partial unique index, `launches_one_live_per_ticket`, on
`ticket_id` where `stopped_at is null` (FR-015). The button checks first so the message is kind;
the index makes it true whatever the button does.

### `launch_status` and how a row moves through it

```text
starting ──(port answers)──▶ running ──(Stop · idle · lifetime ceiling · service restart)──▶ stopped
    │
    └──(no command · install fails · exits before listening · nothing answers · clone refused)──▶ failed
```

- `starting` and `running` are live; `stopped_at` is null. Every look at a live row asks the
  execution service and writes back what it said (FR-007, FR-011).
- `failed` and `stopped` are final; `stopped_at` is set when the row becomes either. The row is
  history and is never asked about again.
- A look that finds the execution service no longer knows the launch marks the row `stopped` with
  a detail naming the restart (edge case in spec.md).

### What is pinned, and what is not

Pinned in the row: the branch and the command that ran, so a launch is reproducible in the two
respects that matter (Constitution IV). Not stored: the repository credential (FR-017 — it goes to
the sandbox as environment and is never written anywhere), the project's output (tailed live from
the sandbox while it exists, forty lines at a time, and gone with it), and the sandbox's address
on the execution host (only the URL a browser here can open).

---

## `repositories` — two new columns

`packages/db/src/schema/repository.ts` (FR-005).

| Column | Type | Meaning |
|---|---|---|
| `run_command` | text, nullable | The start command. Null means detect it from the workspace |
| `run_port` | integer, nullable | The port the project listens on. Null means detect it |

Either may be set alone: a set command with a detected port, or the reverse. When both are null,
detection runs and the launch records where its guess came from (FR-004). A set command runs
through a shell inside the sandbox with `PORT` and `HOST` in the environment, so the shape to
write is `npm run dev -- --host 0.0.0.0 --port $PORT`. Validation: the command at most 500
characters; the port a whole number from 1 to 65535.

---

## The execution service's record — held in memory, for the life of the process

`apps/runner/src/launch/launches.ts`, `LaunchRecord`. Not persisted, by design: the sandbox it
describes dies with the process too, so a persisted record would describe a container that no
longer exists. The application treats "the service does not know this launch" as stopped.

| Field | Meaning | Requirement |
|---|---|---|
| `id` | What the application stores as `runner_launch_id` | — |
| `containerId` | The sandbox, once created | FR-002 |
| `status` | The same four states | FR-007 |
| `cloneUrl`, `branch` | What was cloned | FR-017 |
| `command`, `port`, `installCommand` | What ran — given, or detected | FR-004, FR-005 |
| `from`, `notes` | Where the command came from, and what the project must do (bind every interface) | FR-004 |
| `address` | `127.0.0.1:<port>` on the execution host, once listening | FR-006 |
| `detail` | Why it failed or stopped | FR-007 |
| `startedAt`, `lastActivityAt` | Every look moves `lastActivityAt`; the sweep stops what has not moved in 30 minutes | FR-011 |

Two things the record does **not** hold: the credential, which is passed to the clone as
environment and dropped (FR-017), and the output, which is read from the sandbox on demand.
