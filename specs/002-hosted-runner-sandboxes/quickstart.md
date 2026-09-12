# Quickstart & Validation: Hosted Runner Sandboxes

**Feature**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Date**: 2026-09-11

How to bring the hosted execution path up and prove it works. The scenarios below are the four user
stories' **Independent Tests**, in delivery order, each demonstrable on its own. Structural detail
lives in [data-model.md](./data-model.md) and [contracts/](./contracts/execution-host.md); the
decisions and the figures behind them live in [research.md](./research.md). This file is the run
guide.

## Prerequisites

| Need | Why | Notes |
| --- | --- | --- |
| Everything in [spec 001's quickstart](../001-code-factory-mvp/quickstart.md) except a container host | The product itself | The container host is what this feature removes |
| A Cloudflare account on the Workers Paid plan | Containers require it | $5/month; the sandbox capacity is billed on top |
| `wrangler`, authenticated | Deploy and tail | Pinned in `apps/runner/package.json` |
| A registry the provider can pull the sandbox image from | FR-004 pins an image per run | The image is `linux/amd64` and must match the SDK version (D10) |
| The application reachable from the internet | The execution service exchanges credential references and posts callbacks to it | A deployment prerequisite this feature assumes, not one it delivers |

## Step 0 — Prove nothing broke, with no account at all

Before any of the above. This is User Story 4's Independent Test and the cheapest signal you will
get.

```bash
bun install
bun run verify                     # lint, typecheck, the whole suite
```

**Expect**: green, with no Cloudflare credentials present and no network reach to any execution
service. The suite drives everything through `apps/runner/tests/fake-host.ts`, so this stays true
for the life of the feature (FR-026). If it ever needs an account, that is a defect in the test, not
a reason to add the account.

```bash
docker info >/dev/null && bun run dev:runner    # the local path, unchanged
```

Then, with a run in flight, change `EXECUTION_HOST` and restart: a further request for that run
must be **refused**, not executed on the other host (FR-025a). A run never spans two hosts.

**Expect**: the runner starts and `GET /ready` answers `container_host: "reachable"`. Switching a
deployment between hosts is one configuration change and no code change (FR-025, SC-010).

## Step 1 — The spike, before the rest of the implementation

Three decisions in [research.md](./research.md) are documented but have not been run, and each could
change the design rather than just the code. Prove them against one real sandbox first.

| Check | Proves | If it fails |
| --- | --- | --- |
| Run a command as the unprivileged user; confirm it is not root and that `/work` is writable by it | D6, FR-003 | The non-root story needs rethinking before anything else is built |
| Set a deny-by-default allowlist, run a command that reaches a permitted host and one that reaches another, then widen the policy on the **running** sandbox and re-run | D7, FR-011, FR-012 | Per-step reach may need a sandbox per step, which changes the cost model |
| Create sandboxes at two declared sizes and confirm each gets what its binding declares | D4, FR-005, FR-009 | Size routing needs a different shape |

Do not proceed to Phase B until all three answer.

## Step 2 — The sandbox image

**Amended after implementation: there is nothing to do here by hand.** `wrangler.jsonc` points each
container binding at `infra/sandbox/Dockerfile`, so the deploy in Step 3 builds and publishes the
image itself. It needs a working Docker CLI locally to do that, and it fails with a message naming
Docker if there is not one.

You can still build it alone to check it:

```bash
docker build -t code-factory/sandbox:check infra/sandbox
docker run --rm code-factory/sandbox:check setpriv --reuid=factory --regid=factory \
  --clear-groups sh -c 'id -u && claude --version && command -v pen'
```

**Expect**: a non-zero user id, a Claude CLI version, and a path for `pen` (D10, D6). The build
verifies both CLIs are installed rather than trusting the installer — an earlier version used
`|| true`, which hid that the Claude CLI had never been installed at all.

**The workspace's `sandbox_image` setting has no effect on this host**, and Settings now says so
rather than accepting a value it will ignore (FR-011a): the image is deploy-time configuration here.
It still applies on the locally administered host, where FR-004 pins it per run — so `:latest`
defeats the point there.

## Step 3 — Deploy the execution service

```bash
bunx wrangler deploy --config apps/runner/wrangler.jsonc
bunx wrangler tail --config apps/runner/wrangler.jsonc     # leave running
```

Then point the application at it and check readiness:

```bash
# RUNNER_BASE_URL=<the worker's address>  RUNNER_AUTH_TOKEN=<the token>
curl -s "$RUNNER_BASE_URL/health"                                   # no credential needed
curl -s -H "authorization: Bearer $RUNNER_AUTH_TOKEN" "$RUNNER_BASE_URL/ready"
curl -s -H "authorization: Bearer wrong" "$RUNNER_BASE_URL/ready"
```

**Expect**, in order: `{"status":"ok"}`; `container_host: "reachable"` with
`execution_host: "hosted"`; and `401`. Those three answers being distinguishable is FR-020 — an
operator with a wrong token must not be told the host is down.

**What readiness does and does not prove, amended after implementation.** It checks that every
sized container binding and the run binding are present, and that Durable Object storage answers.
It deliberately does **not** start a sandbox, and its `detail` says so. Two reasons: a readiness
check that cost a container would be charged for every visit to the Settings screen, and — worse —
it would report `degraded` whenever the instance limit was reached, which is exactly when runs are
healthy and busy.

So the earlier expectation here, that a first deploy reports `container_host: "unreachable"` for
several minutes while the provider readies capacity, **is no longer what happens**: readiness
answers `ok` straight away. That first-deploy delay is real and is still worth knowing about, but it
shows up where the sandbox is actually needed:

**Expect for several minutes after a first deploy**: `POST /runs/{id}/start` failing with "the
execution host had no capacity for a sandbox" while the provider readies capacity. This is normal,
it is longer than the 30-second capacity retry window by design, and the run's failure says to retry
rather than to change anything (D13). Do Step 4 twice on a first deploy and expect the first
attempt to fail this way.

## Step 4 — User Story 1: a run with no container daemon anywhere

Start a ticket from the application against a real repository, on a machine where `docker info`
fails or Docker is not installed.

**Expect**:

1. The run's steps execute and it reaches a merge request.
2. A document written by an early step is read by a later one — the workspace persists across the
   separate requests that make up a run (FR-006).
3. The live log streams while a step runs, rather than appearing when it ends (FR-027).
4. `wrangler tail` shows one sandbox created and one released.

Then the three that are about the public address:

```bash
curl -s -X POST "$RUNNER_BASE_URL/runs/whatever/start"                          # no credential
curl -s -X POST -H "authorization: Bearer $RUNNER_AUTH_TOKEN" "$RUNNER_BASE_URL/runs/does-not-exist/steps/0"
```

**Expect**: the first is refused and creates nothing; the second's refusal is indistinguishable from
one naming a run that does exist (FR-018, FR-019). Replace `RUNNER_AUTH_TOKEN` while a run is
executing: the run finishes and the old token stops working (FR-018a, SC-012).

## Step 5 — User Story 2: the ceilings hold

Set each ceiling to a distinctive value in workspace settings, then run a ticket.

| Set | Expect |
| --- | --- |
| Wall-clock to 2 minutes, then start a run and stop the orchestrator | The sandbox is released at 2 minutes with nothing asking (FR-010, SC-008). Watch `wrangler tail`. |
| An agent time limit shorter than its step | The step stops and reports reaching its limit, distinguishable from failing (FR-014) |
| An agent time limit of a few seconds, run after an idle period | The sandbox's readying time is not charged to the limit, and the step is not reported as timing out (FR-014a) |
| Network restriction requested, on a host that cannot filter by host | The setting is shown as unavailable, naming the host (FR-011a) |
| Any pipeline, any step | Every step has the same network reach, and an agent step reaches the model service (FR-011) |
| A step that cannot reach an address it needs | The failure names the address (FR-013) |
| A memory ceiling below the smallest offered size | The run fails at start naming that ceiling, rather than starting above it (FR-005) |
| Ceilings between two offered sizes | The sandbox gets the larger size that still fits *within* them — never more than the ceiling allows (FR-009) |

Then the one that is not a setting — name a ticket
``x'; touch /tmp/pwned; echo '`` and give a step an `output_files` entry containing the same shape.

**Expect**: the ticket runs normally and nothing was created. `bun test apps/runner/tests/unit/shell.test.ts`
covers this at the unit level with nine cases; this is the end-to-end one (FR-015, SC-007).

## Step 6 — User Story 3: it stops costing money

| Do | Expect |
| --- | --- |
| Let a run complete | No sandbox capacity billed 2 minutes later (SC-003) |
| Fail a run with retention at 0 | Same |
| Fail a run with retention at 1 hour | The sandbox is inspectable for an hour and gone after (FR-023) |
| Abandon a run — stop the orchestrator mid-step | Released at the wall-clock ceiling (FR-010) |
| Run nothing for an hour | No sandbox capacity billed for that hour (SC-005) |

Read all of these on the provider's own usage reporting, not in the product — the product surfaces
no sandbox cost or duration figure, which was decided in the Clarifications session and is why
SC-004 and SC-005 say where they are read.

**Expect** for a completed run at default ceilings: under $0.05, and under $0.10 at the 95th
percentile (SC-004). If it is materially above that, the likely cause is a sandbox outliving its run
rather than a mispriced one — check the alarm before the rates.

## Step 7 — Capacity and recovery

Harder to force, so verify what you can and watch for the rest.

- **Capacity refusal**: the provider refuses when no instance is free anywhere. If you see it in
  `wrangler tail`, expect the retry to absorb it and the member to see no failure (FR-024, SC-013).
  A refusal that outlasts the window must fail naming capacity, not as a step failure (FR-024a).
- **Sandbox loss mid-run**: destroy a sandbox by hand while a step runs. Expect one rebuild
  resuming from the last commit on the branch, and a second loss failing the run — existing
  behaviour in `container/recover.ts`, which this feature must not change.
- **Application unreachable**: stop the application and start a run. Expect a failure naming the
  application as unreachable, before any step executes (FR-021).

## The one thing to check before you trust any of this

The orchestrator's HTTP request timeout must exceed the longest step's ceiling. A step's request is
held open for the length of the step, and a caller that disconnects **cancels the step** rather than
merely losing the response (D9). A timeout set for the old deployment will look like steps failing
at a suspiciously round number of minutes.

**Done, and worth knowing how.** `orchestration/n8n/run-ticket-pipeline.json` set no timeout at all
on the three calls that are held open, which meant n8n's own five-minute default — shorter than a
great many legitimate agent steps. Those three nodes now set it from the run's own ceiling:

```
={{ (($json.sandbox && $json.sandbox.wall_clock_minutes) || 90) * 60000 + 120000 }}
```

Derived rather than fixed, so raising a workspace's wall-clock limit raises this with it. A
hard-coded figure would have meant the limit silently failing to take effect, which is the failure
hardest to attribute. `apps/runner/tests/contract/orchestrator-timeout.test.ts` evaluates the
expression and asserts the result exceeds the ceiling, so this cannot regress quietly.

If you run the orchestrator from something other than the shipped workflow, this is yours to set.
