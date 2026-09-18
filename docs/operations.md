# Deploying and operating Code Factory

What to install, what to configure, what to schedule, and what to watch. Written for whoever is on
call, not for whoever wrote it.

Everything here was verified against a real deployment except where it says otherwise — the
exceptions are listed under [What has not been run](#what-has-not-been-run) rather than left for you
to discover.

## What you are deploying

Two long-running services, one database, and one container image.

| Piece | What it is | Where it may be reached from |
| --- | --- | --- |
| **`apps/web`** | SvelteKit. Every screen, every remote function, and the callback and exchange routes the other pieces use. Holds the encryption key. | The public internet — people sign in to it |
| **`apps/runner`** | An HTTP service. **The only component that executes anything** — as processes on its own machine, or as containers on a Docker daemon (Principle V, research.md D5) — and the orchestrator: it drives each run from snapshot to merge request and writes every run's position to disk. | The web application only. **Never the public internet** |
| **Postgres 16+** | The only datastore. `LISTEN`/`NOTIFY` carries live run updates to browsers | Both services |
| **Sandbox image** | `infra/sandbox/Dockerfile`. One fresh container per run, non-root, destroyed at the end. Used under `EXECUTION_HOST=docker`, for the steps that run commands under `process`, and by the Run it card always | Built once, pulled by the container host |

The web application never holds a container handle, and the runner holds credentials only in
memory for the life of a run — never on disk, never in the state it writes. Both are deliberate and
both are load-bearing — see [credential-path.md](./reviews/credential-path.md).

## Bringing it up

```bash
bun install                                   # workspace root; Bun is pinned in .bun-version
docker compose up -d postgres                 # or point DATABASE_URL at a Postgres of your own
bun run db:migrate                            # drizzle-kit; idempotent, safe to re-run
docker build -t code-factory/sandbox:latest infra/sandbox   # for EXECUTION_HOST=docker, and for isolated steps under `process`
EXECUTION_HOST=docker bun run dev:runner      # apps/runner → :8080, needs Docker access
bun run dev:web                               # apps/web  → :5173
```

On a development machine `bun run dev` does all of this, with runs executing as processes on that
machine — see [Execution hosts](#execution-hosts) for what that trades away and why a deployment
should not. `DATABASE_MODE` decides where its Postgres comes from: `docker` starts the one in
`docker-compose.yml`; `system` uses the one `DATABASE_URL` names, and creates the database and its
`_test` sibling if they are missing. A deployment points `DATABASE_URL` at its own Postgres and does
not use this script.

There is no separate orchestration service. The runner drives each run: `POST /runs/{id}/execute`
accepts the snapshot and answers at once, the run proceeds and reports through the callbacks in
`contracts/orchestrator.md`, a checkpoint or a pause waits for `POST /runs/{id}/resume`, and the
merge request is opened by the runner with the body the application composes. Each run's position
is written under `FACTORY_STATE_DIR`, so restarting the runner resumes every run in flight.

Then, in the application: sign in, open **Settings**, and set the execution service address and a
model credential. The dashboard names anything still missing and links
to where it is fixed, so you do not need this document open to know what is left.

Finally press **Test every connection** and do not proceed until each says what you expect. The
three results are genuinely different states:

| Result | What it means | What to do |
| --- | --- | --- |
| `Not configured yet.` | A step you have not taken | Set the address or store the credential |
| `Reachable, and it accepted our credential.` | Working | Nothing |
| `Nothing answered at that address.` | Wrong address, or the service is down | Check both |
| `It answered but refused our credential.` | Right address, wrong token | Replace the token |
| `Something answered, but not this service.` | Something else is on that port | Check the address |

The container host result also reports whether the **Runner** can reach Docker. A Runner that
answers but reports `container_host: unreachable` is configured correctly and cannot run anything —
fix Docker access, not the address.

## Configuration

### `apps/web`

| Variable | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | yes | |
| `RUNNER_BASE_URL` | yes | Validated as an absolute URL at startup |
| `RUNNER_AUTH_TOKEN` | yes | Must match the Runner's |
| `PUBLIC_BASE_URL` | yes | Appears in merge request bodies and callback addresses, so it must be the address others can reach |
| `SESSION_SECRET` | yes | 32+ random bytes. Changing it signs everyone out |
| `SECRET_ENCRYPTION_KEY` | yes | base64 of exactly 32 bytes: `openssl rand -base64 32` |
| `SECRET_ENCRYPTION_KEY_VERSION` | | Defaults to `v1`. Recorded on every credential this key seals |
| `SECRET_ENCRYPTION_KEYS_PREVIOUS` | | Retired keys, `version:base64,version:base64`. **See rotation below** |
| `GITLAB_CLIENT_ID` / `GITLAB_CLIENT_SECRET` | | Signing in with GitLab (FR-001). Callback: `<PUBLIC_BASE_URL>/login/gitlab/callback` |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | | Signing in with GitHub. Callback: `<PUBLIC_BASE_URL>/login/github/callback` |

A provider with no client id and secret is **not offered** on the sign-in screen, rather than
offered as a link that fails. Configure neither and email-and-password is the only way in — which
works, but nobody has a password until an administrator sets one, so at least one provider is the
practical choice.

Startup fails, loudly, on a missing or malformed value rather than at the first run.

### `apps/runner`

| Variable | Default | Notes |
| --- | --- | --- |
| `RUNNER_PORT` | `8080` | |
| `RUNNER_BASE_URL` | `http://localhost:<port>` | This service's address as the application reaches it; it appears in the resume addresses handed to the application at a checkpoint or pause |
| `FACTORY_STATE_DIR` | `~/.code-factory/state` | Where each run's position is written, so a restart resumes it. Never holds a credential |
| `EXECUTION_HOST` | `process` | `process`: runs execute as processes on this machine, except steps whose agent may run commands, which get a container over the same workspace. `docker`: one fresh container per run. **A deployment should set `docker`** — see [Execution hosts](#execution-hosts) |
| `FACTORY_WORK_DIR` | `~/.code-factory/runs` | Where the process host makes each run's directory |
| `DATABASE_URL` | | Present for parity; the Runner works from the snapshot it is handed |
| `SANDBOX_IMAGE` | `code-factory/sandbox:latest` | The image a Docker sandbox, and every Run it launch, is made from |
| `RUNNER_AUTH_TOKEN` | `dev-only-token` | **Change it.** Every route but `/health` requires it |

### Execution hosts

The Runner executes a run on one of two hosts, chosen by `EXECUTION_HOST`, behind one interface
(`apps/runner/src/container/host.ts`). Both are held to the same contract by
`apps/runner/tests/contract/execution-host.test.ts`.

| | `process` | `docker` |
| --- | --- | --- |
| A run is | a fresh directory under `FACTORY_WORK_DIR`, removed at the end | a fresh container from the sandbox image, removed at the end |
| Runs as | whoever started the Runner | an unprivileged user (uid 1000) |
| CPU and memory ceilings | recorded, **not enforced** | enforced by Docker |
| Wall-clock ceiling | enforced: the directory and everything it started are removed | enforced: the container's own `sleep` ends |
| "No network while code is written" | **not available** — a run that asks for it is refused at start, naming the setting | enforced after the clone |
| Needs | git, Node, the Claude CLI on the machine (on Windows, Git for Windows' shell) | a Docker daemon and the built image |

#### Isolated steps under `process`

A step whose agent may run **shell commands** does not execute as a process on the machine. It gets
a throwaway container from the sandbox image with the run's workspace bind-mounted at `/work`, runs
there, and the container is removed — `apps/runner/src/container/isolate.ts`. With the shipped
agents that is Plan and Implement. Specification, Tasks and Design read files and write Markdown,
and stay as processes, which is the speed this host exists for.

The workspace does not move: it is one directory per run, made by the process host and handed
between steps by being the same directory, so an isolated step reads what the step before it wrote
and leaves its own work where the step after will find it.

Docker absent, or the image unbuilt, and the Runner logs `steps that may run commands will NOT be
isolated` at startup with the reason, and runs them as processes. It does not refuse to start.

This exists because a step that may run commands can reach the whole machine. An Implement agent
tidying up after a dev server it had started ran `Get-Process -Name bun | Stop-Process -Force`,
which on a developer's machine names the Runner supervising it; the run died four steps in, and the
agent went on working orphaned for twenty minutes. `apps/runner/src/container/guard.ts` refuses
that shape of command through a `PreToolUse` hook, as a second line for the steps that are not
isolated and for hosts with no Docker. It is a rule and not a wall: it fails open if the hook cannot
run, which is why the Runner self-tests it before every step and says so in the step log when it is
not working.

**Accepted risk, recorded here because this is where the decision lives.** The constitution's
sandbox invariant — one fresh sandbox per run, non-root, bounded in processing power, memory and
lifetime — is met for the whole run only by `docker`. Under `process` it is met for the steps that
run commands and not for the rest: those execute an agent's code as the person running the Runner,
on their machine, against repositories they already hold credentials for. That is acceptable for
that person's own machine and for nothing else. A deployment MUST set `EXECUTION_HOST=docker`.

### The shipped agents and pipelines

A fresh deployment installs the shipped agents and the three shipped pipelines (FR-033, FR-034) by
itself, the first time anything reads its workspace. Nothing needs doing.

`bun run install-defaults` exists for the two cases where that is not enough: a deployment created
before the installer existed, and one where the install failed and the log said
`could not install the shipped agents and pipelines`. It is idempotent, and it never overwrites an
agent or pipeline somebody has since changed — a re-install is not a reset. Resetting one shipped
agent to what it shipped as is a person's own action in the interface (FR-040).

### Workspace settings, which live in the database

Ceilings, the concurrency cap, sandbox limits, retention, credentials and membership are set in
**Settings** by an administrator, not by environment variables — they are operational decisions
somebody changes without a deploy. There is exactly one workspace row per deployment; a
`workspaces_singleton` index enforces it, because two rows would mean a read and a write landing on
different ones and a saved setting appearing not to save.

## What you must schedule

**`bun run maintenance`, every few minutes.** Three requirements need something to happen at a
moment nobody triggered, and none of them can be driven by a request, because the whole point is
that nobody is there:

- a gate whose waiting time has expired must continue or fail the run (FR-064b)
- a run past its cost or time ceiling must be stopped and its sandbox released (FR-081)
- a retained failed sandbox must be destroyed when its period ends (FR-086)

Every pass is idempotent, so a missed run costs lateness rather than correctness, and two
overlapping passes are safe. It exits 0 when the pass completed and 1 when part of it could not, and
prints what it did:

```
gates continued: 0; gates failed: 1; runs stopped at a ceiling: 0; sandboxes released: 2
```

`--quiet` prints only when something happened, which is what you want in cron. Nothing else drives
these: if this is not scheduled, a run will wait at an expired gate forever and a retained sandbox
will never be reclaimed.

## The audits

Four scripts, one per success criterion that no single feature demonstrates. Each reads the
database, prints what it examined, and exits non-zero when the criterion is not met — they are meant
to be run by a scheduler, weekly or after a change, not read.

```bash
bun run audit:credentials     --since 7d          # SC-011
bun run audit:concurrency     --since 7d          # SC-007
bun run audit:sandboxes       --since 7d          # SC-012
bun run audit:first-attempt   --since 30d         # SC-002
```

| Exit | Meaning |
| --- | --- |
| 0 | The criterion held over everything examined |
| 1 | Findings, each naming where to go and look |
| 2 | **Inconclusive** — there was nothing to examine, so nothing was proved |

Exit 2 is not a pass and is not an error. `audit:concurrency` reports it most often: it needs a step
that ran both alone and alongside another run, and without both there is no baseline to compare
against. Treat it as "run this again after real traffic", not as "fine".

`audit:credentials` withholds the value of anything it finds and prints only the recognised shape
and the row — a security audit that pasted credentials into your CI log would be worse than the
problem.

`audit:first-attempt` takes `--exclude '#142,#150'` for tickets somebody has read and judged
incomplete or ambiguous. SC-002 is about tickets whose criteria are complete, which no script can
determine; the exclusions are printed with the result so the number always carries its caveats.

## Network boundaries

**This is the part with security consequences.** Three rules, in order of how much they matter:

1. **The Runner must not be reachable from the public internet.** It is the only component with
   rights on the container host. It authenticates every route but `/health`, and that is a second
   line, not the boundary.

2. **`/api/runs/:id/credentials` should be reachable only from the Runner's address.** This is the
   route that exchanges credential references for values. It requires the run's own secret, which
   lives in the run's snapshot — in the application's database and in the runner's state files. Anyone
   who can read either can call this route and be handed the git token and the model key. Restrict
   the route at the proxy and keep the state directory as private as the database. This is
   documented as a residual risk in [credential-path.md](./reviews/credential-path.md); it cannot be
   fixed inside the application.

3. **Under `EXECUTION_HOST=docker`, a sandbox can be kept off the network while code is being
   written.** The setting is refused under `process`, which cannot enforce it. Note that an agent
   step is an outbound call to the model made from inside the sandbox, so a pipeline with agent
   steps needs the network on either way; the setting is for pipelines of shell steps.

## Rotating the encryption key

Credentials are sealed with `SECRET_ENCRYPTION_KEY` and each records which key version sealed it. To
rotate:

1. Generate a new key: `openssl rand -base64 32`.
2. Move the **current** key into `SECRET_ENCRYPTION_KEYS_PREVIOUS` as `<its version>:<its base64>`.
3. Put the new key in `SECRET_ENCRYPTION_KEY` and give it a new `SECRET_ENCRYPTION_KEY_VERSION`.
4. Restart. New credentials seal with the new key; existing ones still decrypt with the old.

**Do not drop the old key until every credential has been re-entered.** Without it, every credential
already stored becomes undecryptable — every repository stops working at once and the only remedy is
typing every token in again. The startup check refuses an entry that repeats the current version,
and a run that meets a credential it cannot decrypt says `no key available for version v1`, which
names exactly what was lost.

## What to watch

Both services log one JSON object per line, with `service`, `level`, `msg` and a `run_id` where
there is one. The lines worth alerting on:

| Line | Means |
| --- | --- |
| `could not release the sandbox of a run stopped at its ceiling` | A container is running that nobody is watching. The maintenance pass will retry; if it repeats, the container host is refusing |
| `maintenance pass finished with problems` | Read the pass's own output; the count is in `problems` |
| `a workspace connection is not usable` | A dependency changed under you. The `state` field says which fault |
| `trigger delivery failed, will retry` | The runner is not answering. Retries with backoff; a ticket sits `queued` meanwhile |
| `run failed` (runner) | A run ended on the failure path; `reason` and `detail` say why, and the application has been told |
| `could not report the failure to the application` (runner) | The run failed AND the application could not be reached. The run's row is stale until somebody looks |
| `the specification step produced no usable classification` | FR-102 — the run continues, treated as not interface work, and the warning is on the run for a person to see. Not an outage |
| `run stopped at a ceiling` | Working as intended. Worth counting, not alerting |

A run's own state is on its ticket page and needs no log reading: which step is executing, what has
been spent, what the last agent produced, and the failing step and reason when it fails.

## Restarting things

**The web application** is stateless apart from its database connections; restart freely. Browsers
watching a run reconnect and re-read, so a viewer sees correct state rather than a frozen one.

**The Runner writes each run's position to `FACTORY_STATE_DIR`** and, on start, drives every run
that was in flight again from that position and keeps waiting on every run that was waiting. A
sandbox that still exists is adopted; one that does not is rebuilt from the branch. A step that was
executing when the runner stopped runs again from its start. Credentials are fetched from the
application again; none are on disk.

## What has not been run

Stated plainly, because a deployment guide that implies more was tested than was is worse than a
short one:

- **No end-to-end run has finished.** On a development machine the runner has driven a run through
  its specification step and posted the result; the steps after that, the checkpoint, the pause and
  the merge request are exercised only by `apps/runner/tests/integration/orchestrate.test.ts`,
  against the fake host and a fake application.
- **No merge request has been opened on a provider.** The body is composed and asserted against
  (see [merge-request-legibility.md](./reviews/merge-request-legibility.md)), and both providers'
  field shapes are produced, but neither GitLab nor GitHub has replied to either.
- **Screens embedded in a merge request will probably not render.**
  `/api/artifacts/:id/image` requires a signed-in user, and providers fetch images server-side
  through an image proxy with no cookies. Expect broken images in the Screens section until this is
  given a signed, expiring address. The rest of the body is unaffected.
- **The 15-minute first-run claim (SC-001) is verified only to a startable ticket** — 2.9 seconds of
  the product's time, four to eight minutes of a person's by estimate. The run itself is not timed.
  See [first-run-walkthrough.md](./reviews/first-run-walkthrough.md).

Everything else is covered by 494 unit and integration tests against a real Postgres, and 37 browser
tests; three browser tests are skipped rather than passed, and they are exactly the three that need
the services above.
