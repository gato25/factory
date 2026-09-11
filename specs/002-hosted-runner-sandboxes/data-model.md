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

**Nothing is added.** An earlier version of this feature added a
`sandbox_permitted_hosts` column, because FR-012 described an administrator-editable permitted set.
T006 measured that the intended execution host cannot filter a sandbox's traffic by host in either
direction (research D7), so there is no list to store and the column was never created.

What changes instead is how `sandbox_network_during_implement` is **presented**: on a host that
cannot enforce it, the setting reports itself unavailable and names the host, rather than accepting
a value it will ignore (FR-011a, FR-012). That is a property of the configured execution host, not
a column — so it is read at display time and never pinned into a run.

---

## Pipeline snapshot — unchanged

`packages/shared/src/snapshot.ts`, `PipelineSnapshot.sandbox`, keeps exactly the shape it has:

```
sandbox?: {
  image: string;
  cpu: number;
  memory_mb: number;
  wall_clock_minutes: number;
  network_during_implement: boolean;
}
```

An earlier version added `permitted_hosts: string[]`. It is withdrawn along with FR-012c: there is
no permitted set to pin, because the host cannot act on one. `network_during_implement` stays,
because whether an administrator *asked* for the restriction is still worth pinning — it is what
the run was started under, and a host that can enforce it would need it.

**What is NOT pinned**: whether the configured host can enforce the restriction. That is a property
of the deployment, not of the run, and pinning it would claim a run is reproducible in a respect it
is not.

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

## Network reach — a property of the host, not of a run

Not a table, not a derived function, and not per step.

T006 measured that the intended execution host offers no per-host filtering: a deny list did not
deny, an allow list did not allow, and turning the internet off blocked everything including the
permitted host. Reach is all-or-nothing for a sandbox's whole life (FR-011).

So the only thing to model is **what an administrator is told**:

| Configured execution host | `network_during_implement` |
|---|---|
| One with no per-host filtering | Shown as unavailable, naming the host (FR-011a) |
| One that can filter | Shown as available and honoured |

FR-012 generalises that to every ceiling: an administrator should be able to see which limits the
configured host enforces. Processing power, memory and wall-clock are all enforced (T005, T007,
D5); network reach is not. A setting that appears to constrain and does not is worse than one that
says it cannot.
