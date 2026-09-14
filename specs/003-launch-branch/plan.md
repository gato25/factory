# Implementation Plan: Run a ticket's branch on a real port

**Branch**: `003-launch-branch` | **Date**: 2026-09-13 | **Spec**: [spec.md](./spec.md)

**Research**: [research.md](./research.md) · **Data model**: [data-model.md](./data-model.md) · **Quickstart**: [quickstart.md](./quickstart.md) · **Contract**: [contracts/launches.md](./contracts/launches.md) · **Tasks**: [tasks.md](./tasks.md)

## Summary

A **launch** is a fresh sandbox that clones the ticket's pushed branch, installs, and starts the
project on a container port published on the execution host's loopback interface. The execution
service owns the container and its lifetime (idle sweep plus the sandbox `sleep` ceiling); the
application owns the record, the permission to start, the repository's override, and the request
console — which sends from the server, so cross-origin headers are never the project's problem.

## Technical Context

**Language/Version**: TypeScript on Bun 1.3 (execution service); SvelteKit 2 on Node (application)
**Primary Dependencies**: Docker CLI (`--publish 127.0.0.1::<port>`, `docker port`), Drizzle, valibot
**Storage**: Postgres — `launches` table, two columns on `repositories`
**Testing**: bun:test; the execution service through `FakeHost` and an injected `fetch`
**Target Platform**: the machine the execution service runs on
**Constraints**: start period 120 s; idle period 30 min; console body cap 256 KB; loopback only

## Constitution Check

- **I. Spec-Driven** — every change cites a 003 FR; detection's refusals are FR-016, not a silent gap.
- **II. Tested** — detection is pure and unit-tested; the lifecycle runs through the router against
  `FakeHost` with a fake readiness `fetch`; the record layer has integration tests (need Postgres).
- **III. Pipelines Are Data** — untouched; a launch is not a step.
- **IV. Pinned Execution** — a launch pins the branch and command it ran in its record.
- **V. Least Privilege** — the credential reaches the sandbox as environment (FR-017); the port is
  loopback-only (FR-006); the container is non-root and destroyed on stop (FR-002).
- **Architectural Invariants** — one fresh sandbox per launch, never reused, released on stop; the
  lifetime ceiling is the host's own `sleep` (FR-012).

## Project Structure

```text
apps/runner/src/launch/detect.ts        # FR-004, FR-016: pure detection
apps/runner/src/launch/launches.ts      # FR-002, FR-007..FR-012: lifecycle, store, idle sweep
apps/runner/src/router.ts               # POST/GET/DELETE /launches
apps/runner/src/container/host.ts       # ContainerSpec.publish, ContainerHost.address (FR-006)
apps/web/src/lib/services/launch.ts     # FR-001, FR-003, FR-013..FR-015: records, proxying
apps/web/src/lib/services/runner-client.ts
apps/web/src/lib/remote/launches.remote.ts
apps/web/src/components/LaunchPanel.svelte, RequestConsole.svelte
packages/db/src/schema/{ticket,repository}.ts, migrations/0006_launches.sql
specs/003-launch-branch/contracts/launches.md
```

## Decisions

- **D1 — Detached start, not a long request.** `POST /launches` answers at once with `starting`;
  install and start continue in the execution service and the application polls. A request held
  open for `npm ci` would time out somewhere between the browser and the container.
- **D2 — Server-side console.** The application sends the composed request and returns the answer.
  A browser `fetch` to the project's port fails on CORS for any project that did not plan for it,
  which is every project this is for.
- **D3 — Loopback and a Docker-chosen host port.** `--publish 127.0.0.1::<port>` then `docker
  port`. No port allocator to get wrong, no collision between two launches.
- **D4 — Exit sentinel.** The start script records the command's exit code to a file; the readiness
  loop checks it, so a crash on boot fails in seconds rather than after the start period (FR-009).
- **D5 — Detection in the sandbox.** The files are read from the cloned workspace, not fetched from
  the provider: no second provider client, and detection sees exactly what will run.
- **D6 — The address a browser opens** is the execution service's host name from Settings plus the
  port the container runtime chose; the page is framed at that address, not proxied.
- **D7 — On the ticket, after the run; detected, with a per-repository override.** The two
  questions put to the product owner before building; both answers were the recommended ones.

The alternatives each decision was chosen over, and every figure, are in [research.md](./research.md).
