# Phase 1: Data Model — Hosted Runner Sandboxes

**Feature**: `specs/002-hosted-runner-sandboxes` | **Date**: 2026-09-11

This feature adds one persisted field and one short-lived record. Everything else it touches already
exists and is listed here only where its meaning changes.

---

## Workspace settings — one new column

`packages/db/src/schema/workspace.ts` already carries the sandbox ceilings:

| Column | Type | Default | Requirement |
|---|---|---|---|
| `sandbox_image` | text | `code-factory/sandbox:latest` | FR-004 |
| `sandbox_cpu` | integer | `2` | FR-009 |
| `sandbox_memory_mb` | integer | `4096` | FR-009 |
| `sandbox_wall_clock_minutes` | integer | `90` | FR-009, FR-010 |
| `sandbox_network_during_implement` | boolean | `false` | FR-011 |
| `retain_failed_sandboxes_hours` | integer | `0` | FR-023 |

**New**:

| Column | Type | Default | Requirement |
|---|---|---|---|
| `sandbox_permitted_hosts` | text[] | the package registries in common use | FR-012a, FR-012b |

**Validation rules**

- Each entry is a hostname, optionally with a leading `*.` wildcard. No scheme, no path, no port —
  an entry that carries one is rejected at the form rather than silently ignored, because a rule
  that does not match what it looks like is worse than no rule.
- An empty list is valid and meaningful: it is how an administrator reaches total isolation
  (FR-012b). It must be distinguishable from "never configured", which is why the default is a
  populated list written at creation rather than a fallback applied at read time.
- The model service, the design service and the run's git provider are **not** stored here. FR-012
  names them as always permitted, so putting them in an editable list would let an administrator
  remove them and produce a workspace where no run can succeed.

**Default entries**: chosen in Phase E, not here. The spec records that "the package registries in
common use" is a shipped default expected to go stale, and that the list is data an administrator
edits precisely so that staleness is a nuisance rather than a defect.

---

## Pipeline snapshot — one new field

`packages/shared/src/snapshot.ts`, `PipelineSnapshot.sandbox`. Field names stay snake_case because
this crosses service boundaries and is read as sent.

```
sandbox?: {
  image: string;
  cpu: number;
  memory_mb: number;
  wall_clock_minutes: number;
  network_during_implement: boolean;
  permitted_hosts: string[];        // NEW — FR-012c
}
```

**Why it belongs in the snapshot**: Principle IV. The list is resolved when the run starts and never
consulted again, so an administrator editing it changes the behaviour of zero runs in flight. This
is the same reason every other ceiling is here rather than read live.

**Compatibility**: `sandbox` is already optional, and a snapshot written before this field exists
has no `permitted_hosts`. The execution service treats an absent list as empty — total isolation
rather than a silent default — because inventing entries for a run whose workspace never chose them
would be the reverse of pinning. `index.ts` already warns when a snapshot carries no `sandbox` block
at all; that warning covers this case.

---

## Run execution record — held by the Durable Object

New, and short-lived: it exists from the moment a run starts until its sandbox is released. It
replaces the `Map` in `memoryStore()` (D3).

| Field | What it holds | Notes |
|---|---|---|
| `run_id` | The Durable Object's own identity | Not stored — it *is* the address. This is what gives FR-006 and FR-008 their guarantee for free. |
| `snapshot` | The pinned `PipelineSnapshot` the run started with | Principle IV. Read on every step; never refreshed. |
| `credentials` | The resolved model key, git token and, if the pipeline has a design step, the design credential | See *Lifecycle* below. |
| `sandbox_id` | The sandbox this run owns | Replaced, not added to, when a sandbox is lost and rebuilt (`container/recover.ts`). |
| `size` | Which offered size the run was routed to (D4) | Recorded so that a support question about a slow run can be answered — and because the routing resolves downwards, this is where "why was it slow" is visible. |
| `execution_host` | Which host the run started on | FR-025a. A request for a run whose recorded host is not the one now configured is refused rather than executed elsewhere. |
| `deadline` | When the wall-clock ceiling falls due | The alarm's time. Absolute, set once at creation. |
| `outcome` | `running`, or the terminal outcome the destroy call reported | Only meaningful between a failed run ending and its retention window closing. |
| `retain_until` | When a retained failed sandbox may be released | Absent unless the workspace retains failed sandboxes. |

**State transitions**

```
(none) ──start──▶ running ──destroy(done|cancelled)──▶ (released, record deleted)
                     │
                     ├──destroy(failed), retention 0 ──▶ (released, record deleted)
                     │
                     ├──destroy(failed), retention H ──▶ retained ──alarm──▶ (released, deleted)
                     │
                     └──alarm at deadline ──▶ (released, record deleted)
```

Four rules hold across every path:

1. **A sandbox is never reused.** A transition out of `running` releases it; a new run is a new
   Durable Object with a new sandbox (FR-002).
2. **Every path ends at released.** The alarm is the backstop, so a run nothing calls back about
   still terminates (FR-010). This is the invariant the constitution gained in version 2.0.0.
3. **`start` on a record already in `running` returns the existing sandbox** rather than creating a
   second one (FR-008). Concurrency is handled by the Durable Object being single-instance per id,
   not by a lock we write.
4. **A step or push request with no record is refused**, saying the run must be started first
   (FR-007) — and the refusal says nothing about whether that run exists elsewhere (FR-019).
5. **A request for a run recorded against a different execution host is refused** rather than
   executed on the currently configured one, so a run never spans two hosts (FR-025a). Switching
   the deployment's host mid-run is the case this exists for.
6. **A run that fails for capacity releases its concurrency place immediately**, so a queued run
   advances rather than waiting for anything to time out (FR-024b).

**Lifecycle of the credentials field — the part that needs care**

Credentials are fetched from the application once, at start, with the run's own secret, and held
until the sandbox is released. `specs/001-code-factory-mvp` FR-083 forbids persisting them in the
orchestrator; this is the execution service, which is the component permitted to hold them. Three
obligations follow, and each is a task rather than an assumption:

- They are deleted when the record is deleted, on **every** path above including the alarm.
- A retained failed sandbox keeps its sandbox and loses its credentials: retention exists for
  diagnosis, and nothing about diagnosis needs a live token.
- They never reach a log line or a callback. Redaction happens where output is ingested
  (FR-017), which is `apps/runner/src/stream/logs.ts` and already works this way.

D3 records the alternative, kept as a fallback rather than dismissed: re-fetch per step and store
nothing, at the cost of a round trip and a second failure mode mid-run.

---

## Sandbox size — derived, not stored

Not a table. A pure function from the snapshot's ceilings to one of the sizes the deployment offers
(D4), living in `apps/runner/src/container/sizes.ts`.

| Input | From |
|---|---|
| `cpu`, `memory_mb` | The run's snapshot |
| The offered sizes | The deployment's Wrangler configuration |

**Rules**

- Choose the **largest** offered size whose vCPU **and** memory both stay within the snapshot's
  ceilings. A ceiling is an upper bound, so the choice resolves downwards (FR-009).
- If no offered size fits within them — a ceiling below the smallest size — the run fails at start
  naming that ceiling (FR-005). It does not start above the ceiling.
- A ceiling *above* every offered size is not an error: the run gets the largest size and stays
  under its ceiling.
- The chosen size may be below what was asked for. That is D4's accepted cost, recorded in the
  plan's Complexity Tracking; the run records which size it got, so the gap is answerable.
- Wall-clock is not quantised and is enforced exactly by the alarm, never rounded to an offered
  value (FR-009a).

---

## Permitted-host set — derived, not stored

Also a pure function, in `apps/runner/src/container/egress.ts`, from the snapshot plus the step
about to run.

| Step type | Reach |
|---|---|
| `agent`, `design` | Model service + design service + the run's git provider + `permitted_hosts` |
| `shell`, `checkpoint`, `notify` | Unrestricted |

- The always-permitted three are constants of the run, not entries an administrator can remove
  (FR-012).
- The decision reads the step's declared `type` and nothing else (FR-011a), so a new step type needs
  one line in this table and no change to the rule.
- When the workspace does not restrict the network at all, every step is unrestricted and this
  function is not consulted.
