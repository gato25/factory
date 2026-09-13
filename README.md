# Code Factory

Turns a written ticket into a reviewable merge request.

You connect a git repository, write a ticket describing a change, and a pipeline of AI agents
produces a specification, a plan, a task list and then the implementation. When it finishes, a
branch is pushed and a merge request is opened on GitLab or GitHub, carrying everything a reviewer
needs to judge the change. **Nothing is ever merged automatically** — a person always decides.

You can put a checkpoint anywhere in the pipeline. A run stops there and waits for somebody to
approve, edit the document it produced, or send it back with feedback.

## What it looks like

```
Ticket ─→ Spec ─→ Design ─→ Plan ─→ Tasks ─→ Implement ─→ Merge request
                     ↑
        runs only when the ticket changes the interface
```

The pipeline is data, not code. It lives in the database, you edit it in the interface, and the
orchestration service reads each run's own copy of it — so changing a pipeline never disturbs a run
already in flight.

## Running it locally

You need [Bun](https://bun.sh) (the version in `.bun-version`) and Docker. Postgres and the
orchestration service are started for you, so there is nothing else to install.

```bash
bun install
cp .env.example .env            # then fill it in; the comments say what each value is
bun run dev                     # → http://localhost:5173
```

`bun run dev` is the whole of it: Postgres and n8n, the database schema, the sandbox image (built
once, when it is missing), the orchestration workflow (imported once, when it is not there), and
then the execution service and the web application together. It names each step as it goes and
stops at the first thing that genuinely blocks, so a failure tells you where you are. Ctrl-C stops
the two services; Postgres and n8n keep running.

It also fixes something the separate commands could not. `bun run dev:runner` starts the execution
service with its working directory in `apps/runner`, and Bun reads `.env` only from the directory it
starts in — so the execution service never saw the root `.env`. It fell back to its built-in
development credential while the web application used the `RUNNER_AUTH_TOKEN` you had just set, and
every call between the two came back `unauthorised`. `bun run dev` reads the root `.env` itself and
hands it to both, so they cannot disagree about it.

The separate commands are still there — `dev:web`, `dev:runner`, `db:migrate` — for when you want
one of them on its own.

Open it and **create the first account** — the sign-in screen asks for one when nobody has one yet,
and that first account is the administrator. (It used to require hand-written SQL: `role` defaults to
`member`, every Settings operation needs `admin`, and inviting an admin needs to be one.) After that,
people arrive by invitation or through a connected provider.

Settings should already be filled in. The two service addresses come from `.env`, and the
application copies them into Settings the first time it starts; a model key in `.env`
(`ANTHROPIC_API_KEY`, or `CLAUDE_CODE_OAUTH_TOKEN` from `claude setup-token`) is stored the same
way, sealed. Only a repository is left to connect — the one thing that genuinely needs you. Then
press **Test every connection**. The dashboard names anything still missing and links to where it
is fixed, so you should not need to come back here.

### Where a run actually executes

A run's sandbox comes from one of two places, and which one is a single variable on the execution
service — `EXECUTION_HOST`:

| | `docker` (the default) | `hosted` |
|---|---|---|
| What runs the sandbox | A container daemon you administer | A managed sandbox service |
| Deployed as | A long-lived process (`apps/runner/src/index.ts`) | A Worker (`apps/runner/src/worker.ts`) |
| Run state between requests | In the process | One Durable Object per run |
| Image | `SANDBOX_IMAGE`, built from `infra/sandbox/Dockerfile` | Built at deploy from `infra/sandbox/Dockerfile.hosted` |
| Sandbox size | Exactly the workspace's ceilings | The largest offered size *within* them |
| The network restriction | Enforced | **Not available** — see below |

**There are two sandbox images, and they cannot be one.** The managed host reaches a sandbox only
through a control server that is its base image's entrypoint, so that image must not declare one.
The local host keeps a container alive by running `sleep <seconds>` as the command, so an entrypoint
there would swallow it and the container would exit before the first step. `Dockerfile` is the
local one, `Dockerfile.hosted` the managed one, and a contract test holds each to how its host
actually drives it.

Both serve the same four operations from the same routing, so nothing above the execution host
knows which it is talking to. That is what makes the switch a rollback as well as a migration: if
the hosted path misbehaves, set `EXECUTION_HOST=docker`, point `RUNNER_BASE_URL` back at your own
runner, and you are on the path this project shipped with. No migration to undo, no data to move —
a run's state lives only as long as the run.

Two differences are worth knowing before you switch:

- **The network restriction cannot be enforced on the managed host.** Its allow and deny lists
  govern only traffic routed through the provider's own proxy, not sockets a process opens for
  itself — and an agent step runs arbitrary code, which opens its own. So a sandbox there has
  network reach for the whole of its life. The setting is shown as unavailable in Settings rather
  than accepted and ignored, because a switch that saves, reads as "off", and does nothing is worse
  than no switch at all.
- **Sandbox size is chosen, not set.** Processing power and memory are deploy-time configuration
  there, so a run is routed to the largest offered size that fits *within* the workspace's
  ceilings. Those ceilings are upper bounds, so the choice resolves downwards — which means a
  workspace can get less than it asked for. The provider also requires at least 3 GiB of memory per
  processor, and the shipped default of 2 processors / 4096 MB therefore cannot be offered: a
  default workspace lands on 1 processor. Raise the memory default to 6144 MB to get 2 back.

### How the model work is paid for

The model credential in **Settings → Claude CLI & keys** accepts either kind, and which one you
store decides who pays:

| Credential | Where it comes from | What it draws on |
|---|---|---|
| API key | Anthropic Console | Billed per use to that account |
| Subscription token | `claude setup-token` on your own machine | That Claude subscription's allowance |

The runner tells them apart by prefix and hands the Claude CLI whichever variable that kind is read
from — `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN`, one or the other, never both. So switching
is storing a different credential, with no code change and no rebuild.

Two things to weigh before choosing the subscription token. Its limits are shaped around one person
working interactively, and a pipeline runs steps unattended and sometimes several at once — you will
meet those limits in a different pattern than a person does, and meeting them fails runs rather than
queueing them. And it is long-lived rather than permanent: when it expires, every run fails at once
with an authentication error. Whether a subscription covers team automation at all is a question for
Anthropic's terms.

Settings reports which limits the configured host enforces, once you have pressed **Test every
connection** — it asks the execution service rather than assuming, because the execution service is
the only thing that knows what it is.

[docs/operations.md](./docs/operations.md) is the full deployment guide: configuration, the
maintenance pass you must schedule, network boundaries, key rotation, and what to watch.

## Checks

```bash
bun run verify                  # lint, typecheck, and 494 unit and integration tests
bun run e2e                     # 40 browser tests (3 skipped: they need a real provider)
```

Tests run against a real Postgres, not a fake one. `bun run verify` is what CI runs and what a
branch has to pass.

Four audits cover the success criteria no single feature demonstrates — credential leaks,
concurrency contention, sandbox release, first-attempt rate:

```bash
bun run audit:credentials --since 7d
```

Each exits 0 for a pass, 1 for findings, and **2 for inconclusive** — meaning there was nothing to
examine, so nothing was proved. Exit 2 is not a pass.

## Layout

```
apps/web           SvelteKit — every screen, every remote function, the callback routes
apps/runner        The only component with rights on the execution host — a daemon or a Worker
packages/db        Drizzle schema and migrations — the single datastore
packages/shared    Types and contracts both deployables agree on
orchestration/n8n  One generic workflow, for every pipeline
infra/sandbox      The image a run executes in: fresh per run, non-root, destroyed after
scripts/           The maintenance pass, the audits, and the defaults installer
docs/              Operations guide and the Phase 11 reviews
specs/             The specification this was built from
```

## Where the specification lives

This was built spec-first, and the specification is the source of truth rather than a description
written afterwards:

- [`spec.md`](./spec.md) — the product specification, screens 00–14, against `design.pen`
- [`specs/001-code-factory-mvp/`](./specs/001-code-factory-mvp/) — the feature: requirements,
  [plan](./specs/001-code-factory-mvp/plan.md),
  [data model](./specs/001-code-factory-mvp/data-model.md),
  [contracts](./specs/001-code-factory-mvp/contracts/),
  [quickstart and validation scenarios](./specs/001-code-factory-mvp/quickstart.md), and the
  [235 tasks](./specs/001-code-factory-mvp/tasks.md)
- [`.specify/memory/constitution.md`](./.specify/memory/constitution.md) — the five principles the
  code is held to. Comments throughout the source cite requirement identifiers (`FR-082`, `SC-014`)
  so you can find what authorises a piece of behaviour

Requirement identifiers in code comments are not decoration: they are how you tell a deliberate
constraint from an accident.

## State of it

Every one of the 235 tasks is done. 494 unit and integration tests pass, and 37 of 40 browser tests;
the three that are skipped need a GitLab or GitHub credential, an n8n instance and a Docker daemon,
none of which exist in the environment this was built in.

**No end-to-end run has ever executed**, and that is stated here rather than left to be found out.
What is verified, what is not, and why is set out in
[docs/operations.md](./docs/operations.md#what-has-not-been-run) and in the four reviews under
[docs/reviews/](./docs/reviews/).
