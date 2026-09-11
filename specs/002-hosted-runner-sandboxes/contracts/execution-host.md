# Contract: Execution Service ⇄ Execution Host

**Feature**: `specs/002-hosted-runner-sandboxes` | **Date**: 2026-09-11

The execution host is the seam this whole feature turns on. It already exists — `ContainerHost` in
`apps/runner/src/container/host.ts`, six methods, implemented once by `dockerHost` and once by
`apps/runner/tests/fake-host.ts`. This feature adds a third implementation and **does not change the
interface's shape**, which is what lets the existing suite keep passing offline (FR-026) and lets a
deployment switch hosts by configuration (FR-025).

Every implementation MUST satisfy everything below. The contract test that proves it runs against
all implementations available in the environment, so the hosted one is held to exactly what the
local one is.

---

## The interface

```ts
interface ContainerHost {
  create(spec: ContainerSpec): Promise<string>;
  exec(containerId: string, argv: string[], options?: ExecOptions): Promise<ExecResult>;
  writeFile(containerId: string, path: string, content: string): Promise<void>;
  readFile(containerId: string, path: string): Promise<string | null>;
  stat(containerId: string, path: string): Promise<{ size: number } | null>;
  destroy(containerId: string): Promise<void>;
}
```

`ContainerSpec` gains one field and one clarification:

```ts
interface ContainerSpec {
  image: string;
  cpu: number;
  memoryMb: number;
  wallClockMinutes: number;
  network: boolean;              // whether model-driven steps are restricted at all
  env: Record<string, string>;
  workdir: string;
}
```

`ExecOptions` and `ExecResult` are unchanged. This matters: the provider's own `ExecOptions` carries
`timeout`, `env`, `cwd`, `encoding` and `onOutput(stream, data)`, which maps onto ours one-for-one,
so the hosted implementation is a translation and not an adapter with behaviour of its own.

---

## Obligations of every implementation

### `create`

| # | Obligation | Requirement |
|---|---|---|
| C1 | Returns an identifier that `exec`, `writeFile`, `readFile`, `stat` and `destroy` all accept for the life of the sandbox. | FR-006 |
| C2 | The sandbox is fresh. No state from any earlier run is visible in it. | FR-002 |
| C3 | Commands run as an unprivileged user. The workspace at `workdir` is writable by that user. | FR-003 |
| C4 | The image is the one in `spec.image`, not a default substituted for it. | FR-004 |
| C5 | Processing power and memory **do not exceed** `spec.cpu` and `spec.memoryMb` — these are upper bounds, not minimums — and are the largest allocation the host offers within them. A host with no allocation that fits throws `sandbox_lost` naming the ceiling, and creates nothing. | FR-005, FR-009 |
| C5a | The wall-clock ceiling is enforced exactly, not rounded to an allocation the host offers. | FR-009a |
| C6 | The sandbox is released no later than `wallClockMinutes` from creation, with no further call required. | FR-010 |
| C7 | Credentials in `spec.env` reach the sandbox as environment. They are never written to a file in the workspace, and never appear in a process listing. | FR-016 |
| C8 | A refusal for capacity is retried over a bounded period before it is reported as a failure. A refusal that outlasts the period throws with a reason naming capacity, distinguishable from a step failure. | FR-024, FR-024a |
| C9 | On any failure, nothing is left running. A half-prepared sandbox is destroyed before the error propagates. | FR-002, FR-022 |

### `exec`

| # | Obligation | Requirement |
|---|---|---|
| E1 | Every element of `argv` reaches the process as one argument, exactly as given, whatever characters it contains. A host that joins into a command line MUST quote first. | FR-015 |
| E2 | `options.onOutput` is called as output is produced, not once at the end. | FR-027 |
| E3 | `options.timeoutMs` is enforced. A command that exceeds it is stopped and the result carries `TIMEOUT_EXIT_CODE` (124), which is how a caller tells a deadline from an ordinary non-zero exit. | FR-014 |
| E3a | The deadline starts when the command starts, not when `exec` is called. Time spent readying a sandbox is never charged to the step's limit and never reported as the step timing out. | FR-014a |
| E4 | `options.cwd` and `options.env` apply to the command and do not leak into later ones. | — |
| E5 | Output volume does not change the outcome. A command producing more than a single response could carry still streams and still reports its exit code. | FR-027 |
| E6 | Network reach during the command is whatever the caller established for this step. `exec` does not decide reach. | FR-011 |

### `writeFile`, `readFile`, `stat`

| # | Obligation | Requirement |
|---|---|---|
| F1 | `path` is data. A path containing shell syntax is a path, and reads or writes that file or nothing. | FR-015 |
| F2 | `readFile` returns `null` for a file that does not exist, and throws only when the sandbox itself is unreachable — a missing document and a lost sandbox are different answers. | FR-051 (spec 001) |
| F3 | `stat` returns `null` for a missing path and `{ size }` for a present one, so empty is distinguishable from absent. | FR-051 (spec 001) |
| F4 | `writeFile` failure throws `sandbox_lost` with the detail, never silently. | — |

### `destroy`

| # | Obligation | Requirement |
|---|---|---|
| D1 | The sandbox stops consuming paid capacity. | FR-022 |
| D2 | Destroying a sandbox that is already gone succeeds. Recovery calls it on a corpse by design. | — |
| D3 | Never throws. `container/recover.ts` calls it inside `.catch(() => {})` on the loss path, and a host that throws there would mask the original error. | — |

---

## Errors

Every implementation signals through `FactoryError` with these reasons, because `runs.ts` and
`container/recover.ts` branch on them:

| Reason | Means | Consequence |
|---|---|---|
| `sandbox_lost` | The sandbox is gone, or could not be made | `withSandboxRecovery` rebuilds once, resuming from the last commit on the branch. A second loss fails the run. |
| `credential_invalid` | A credential was rejected — a clone refused, for instance | The run fails naming the credential. Not retried: a rejected token is rejected twice. |
| `credential_missing` | A credential the pipeline needs was not supplied | Fails before any step runs. |

A capacity refusal that outlasts C8's retry window is `sandbox_lost` with a detail naming capacity.
It is deliberately the same reason: from the run's point of view no sandbox exists, and recovery's
single rebuild is the right response.

---

## What the hosted implementation adds around the interface

These are not interface methods. They are obligations the hosted implementation carries because the
provider gives it somewhere to put them.

| Obligation | Requirement |
|---|---|
| Before each step, narrow or widen outbound reach according to the step's declared type. Model-driven steps get the permitted set; every other type is unrestricted. | FR-011, FR-011a, FR-012 |
| A step failing because reach was refused reports the address that was refused. | FR-013 |
| A failed run's sandbox stays inspectable for the workspace's retention window and is released after it. | FR-023 |

---

## Unchanged: the HTTP contract with the application and orchestrator

`specs/001-code-factory-mvp/contracts/runner.md` keeps its four operations, their bodies and their
callbacks. Three things about it change meaning without changing shape:

- **`GET /ready`** stops probing a container daemon and reports whether the execution host is
  reachable. Three answers must stay distinguishable: the service is down (no response), the
  credential is wrong (401), the host is unreachable (200 with `container_host: "unreachable"`).
  FR-020.
- **Every route is reachable from the public internet.** Authentication was already required on
  every route except `/health`; what changes is that it is now the only boundary, so a refusal must
  reveal nothing about whether a run exists (FR-019) and the credential must be replaceable without
  interrupting work (FR-018a).
- **A step's request is held open for the length of the step.** Unchanged in shape, but the
  consequence is new: the caller disconnecting now cancels the step. The orchestrator's request
  timeout MUST exceed the longest step's ceiling. D9.
