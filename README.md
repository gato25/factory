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
execution service reads each run's own copy of it — so changing a pipeline never disturbs a run
already in flight.

## Running it locally

You need [Bun](https://bun.sh) (the version in `.bun-version`), a Postgres — Docker's, or one you
installed — and the tools a step runs: git, Node and the
[Claude CLI](https://docs.anthropic.com/en/docs/claude-code). On Windows that means Git for
Windows, whose shell every step runs in.

```bash
bun install
cp .env.example .env            # then fill it in; the comments say what each value is
bun run dev                     # → http://localhost:5173
```

`bun run dev` is the whole of it: Postgres, the two databases if they are missing, the schema, a
check that git and the Claude CLI are where a step will look for them, and then the execution
service and the web application together. It names each step as it goes and stops at the first thing that genuinely
blocks, so a failure tells you where you are. Ctrl-C stops the two services; Postgres keeps running.

There is no orchestration service any more. The execution service drives each run itself — decides
the next step, runs it, waits at a checkpoint, opens the merge request — and writes every run's
position under `~/.code-factory/state`, so restarting it resumes runs rather than losing them.

It reads the root `.env` itself and hands it to every service, so they cannot disagree about it —
`bun run dev:runner` on its own starts in `apps/runner`, where Bun would not find that file. The
separate commands are still there — `dev:web`, `dev:runner`, `db:migrate` — for when you want one
of them alone.

### Where Postgres comes from

`DATABASE_MODE=docker`, the default, starts the Postgres in `docker-compose.yml` and needs nothing
installed. `DATABASE_MODE=system` uses a Postgres you already have — on this machine or wherever
`DATABASE_URL` points — and then Docker is not needed at all, since runs execute as processes too.
In either mode `bun run dev` creates the database named in `DATABASE_URL`, and its `_test` sibling
the tests use, when they do not exist yet.

### Where a run executes

By default a run executes as ordinary processes on this machine. Each run gets a fresh directory
under `~/.code-factory/runs` (`FACTORY_WORK_DIR` moves it); the repository is cloned into it, the
Claude CLI runs there with the run's credentials in its environment and nothing of yours, and the
directory is removed when the run ends or reaches its wall-clock ceiling. Nothing about Docker is
involved, and every address between the pieces is plain `localhost`.

That is a development arrangement, and it gives up three things the constitution's sandbox invariant
asks for: the process runs as you, not as an unprivileged user; CPU and memory ceilings are recorded
and not enforced; and a run cannot be cut off from the network, so a workspace that asks for that is
refused at start rather than quietly given the internet. `EXECUTION_HOST=docker` restores all three
— one fresh non-root container per run from the sandbox image, which `bun run dev` then builds — and
a deployment should run that way.

The **Run it** card publishes a port and needs a container for it whichever host runs execute on, so
it uses Docker and the sandbox image in either mode. Build the image once when you want it:
`docker build -t code-factory/sandbox:latest infra/sandbox`.

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

### Seeing a change running

A finished ticket has a **Run it** card. It clones the pushed branch into a fresh sandbox, installs,
starts the project on a port only your machine can reach, and shows the result on the ticket: the
running page when the ticket changes the interface, a request console — method, path, headers,
body in; status, headers, body out — when it does not. You can switch between the two. Stop it, or
walk away: a launch nobody looks at for thirty minutes stops itself, and the sandbox's own lifetime
ceiling is underneath that.

The first launch on a repository detects the command from `package.json` and says where the guess
came from. When it is wrong — or the project is not something the sandbox image can run — set the
command and port once on the repository (**Repositories → ⋯ → Set how it starts**). Whatever the
command, the server has to listen on `0.0.0.0` inside the container, not `localhost`; the detected
commands carry each framework's flag for that, and `HOST` and `PORT` are set in the environment.

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
apps/runner        Executes every step and drives every run, as a daemon; the only component with execution rights
packages/db        Drizzle schema and migrations — the single datastore
packages/shared    Types and contracts both deployables agree on
infra/sandbox      The image a run executes in under EXECUTION_HOST=docker, and Run it always
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
the three that are skipped need a GitLab or GitHub credential and a real repository, which do not
exist in the environment this was built in.

**No end-to-end run has ever executed**, and that is stated here rather than left to be found out.
What is verified, what is not, and why is set out in
[docs/operations.md](./docs/operations.md#what-has-not-been-run) and in the four reviews under
[docs/reviews/](./docs/reviews/).
