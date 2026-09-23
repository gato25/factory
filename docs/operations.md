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
| `RUNNER_AUTH_TOKEN` | `dev-only-token`, development only | **Set it.** Every route but `/health` requires it. The development default is accepted only for a service at a `localhost` address with `NODE_ENV` unset; with `NODE_ENV=production`, or a `RUNNER_BASE_URL` that is not loopback, the Runner refuses to start until this is set. The example's `change-me` is refused everywhere |
| `NODE_ENV` | | `production` marks a deployment: the development credential is refused (above). Nothing else reads it |

**Private files.** The state directory, its run records and its lock are created `0700`/`0600`:
a state file carries the run's snapshot, and the snapshot carries the `resume_secret` that
exchanges for the git token and the model key. They used to be world-readable.

**Paths people name stay in the workspace.** A reviewer's edited document, a step's output file, a
skill's name — each was joined onto the workspace and used; under `process`, `..` walked out of it
into the account running the Runner. Each is now confined once (`apps/runner/src/container/paths.ts`)
and refused, as a `400`, when it leaves.

**Two checks before the first request.** The Runner writes and removes a probe file in
`FACTORY_STATE_DIR` at startup, and refuses to start if it cannot — a full disk or a read-only volume
would otherwise fail the first run with a message about the run. It then takes `runner.lock` in that
directory, with a heartbeat every thirty seconds; a second Runner finding a lock held by a live
process refuses to start and names the first (`another runner holds …`), because two Runners on one
state directory drive every run twice. On the same machine the process is asked directly, so a lock
left by a crash is taken over at once and a supervisor's restart is never refused; on another
machine — a shared volume — a heartbeat under two minutes old counts as alive. A takeover is logged
with a warning. Give each Runner its own `FACTORY_STATE_DIR`.

A blank value — `FACTORY_WORK_DIR=` with nothing after it, as `.env.example` ships several keys — is
read as absent and gets the default. It used to be read as an empty string, which for the work
directory meant every run's directory was made relative to wherever the Runner happened to start.

### Execution hosts

The Runner executes a run on one of two hosts, chosen by `EXECUTION_HOST`, behind one interface
(`apps/runner/src/container/host.ts`). Both are held to the same contract by
`apps/runner/tests/contract/execution-host.test.ts`.

| | `process` | `docker` |
| --- | --- | --- |
| A run is | a fresh directory under `FACTORY_WORK_DIR`, removed at the end | a fresh container from the sandbox image, removed at the end |
| Runs as | whoever started the Runner | an unprivileged user (uid 1000), with every capability dropped, no new privileges, and a bounded process table (`apps/runner/src/container/hardening.ts`) |
| CPU and memory ceilings | recorded, **not enforced** | enforced by Docker |
| Wall-clock ceiling | enforced: the directory and everything it started are removed | enforced: the container's own `sleep` ends |
| "No network while code is written" | **not available** — a run that asks for it is refused at start, naming the setting | enforced after the clone; the network is given back for each push and taken away again after, since the push runs inside the sandbox too |
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

A step under `process` sees an **allowlisted** environment, not the Runner's: `PATH`, `HOME`, the
user, locale, temp and terminal variables, proxies and certificate bundles, and the Windows
essentials — plus whatever `FACTORY_STEP_ENV_ALLOW` names, comma-separated. It used to see everything
but nine denylisted names, which under `bun run dev` meant `SESSION_SECRET`, `SECRET_ENCRYPTION_KEY`,
`RUNNER_AUTH_TOKEN` and the OAuth secrets were one `env | sort` away from a step log. The credentials
a run is given still arrive, and only those. A step's container is also known to the Runner while it
runs, so a cancel, a failure or a stop removes it rather than leaving the agent working in it.

The step's container runs as the sandbox image's user, uid 1000, when the Runner runs as uid 1000
too — a developer whose own uid is 1000, or the runner image. When the Runner runs as some other
unprivileged user, the container runs as **that** user instead, with a home of its own under `/tmp`,
so the bind-mounted workspace is writable inside the step. When the Runner runs as **root**, the
container keeps uid 1000, and every write inside a step fails: the Runner says so at startup
(`isolated steps will not be able to write their workspace`). Run it as an unprivileged user, or
set `EXECUTION_HOST=docker`. The same hardening as a run's sandbox applies to a step's container.

Docker absent, or the image unbuilt, and the Runner logs `steps that may run commands will NOT be
isolated` at startup with the reason, and runs them as processes. It does not refuse to start.

This exists because a step that may run commands can reach the whole machine. An Implement agent
tidying up after a dev server it had started ran `Get-Process -Name bun | Stop-Process -Force`,
which on a developer's machine names the Runner supervising it; the run died four steps in, and the
agent went on working orphaned for twenty minutes. `apps/runner/src/container/guard.ts` refuses
that shape of command through a `PreToolUse` hook, as a second line for the steps that are not
isolated and for hosts with no Docker. It is a rule and not a wall: it fails open if the hook cannot
run, which is why the Runner self-tests it before every step and says so in the step log when it is
not working. It had never run at all until 2026-09-23: the settings gave the CLI a hook with an
`args` field, which the CLI's hook shape does not have and silently dropped, so the hook was bare
`node`, which read its input as a script and failed — and a failed hook objects to nothing. The hook
is now one shell command string, and a test runs it the way the CLI does and expects exit 2.

**Accepted risk, recorded here because this is where the decision lives.** The constitution's
sandbox invariant — one fresh sandbox per run, non-root, bounded in processing power, memory and
lifetime — is met for the whole run only by `docker`. Under `process` it is met for the steps that
run commands and not for the rest: those execute an agent's code as the person running the Runner,
on their machine, against repositories they already hold credentials for. That is acceptable for
that person's own machine and for nothing else. A deployment MUST set `EXECUTION_HOST=docker`.

### Hosting the runner in a container

`infra/runner/Dockerfile` and `infra/runner/compose.yml` run the Runner as a container on a machine
whose Docker daemon the sandboxes are created on. That is **docker-out-of-docker**: the host's
`/var/run/docker.sock` is mounted into the Runner's container, and every sandbox is a sibling
container on the host's daemon — one fresh container per run, exactly as `EXECUTION_HOST=docker`
from a bare process. There is no daemon inside the image and nothing about it is privileged.

What the container gives that a bare `bun src/index.ts` does not: `restart: unless-stopped`, so a
Runner that dies is started again and resumes every run from `FACTORY_STATE_DIR`; a memory and a
process ceiling on the Runner itself, so a runaway elsewhere on the machine cannot take the
orchestrator down with it; rotated logs; a health check the restart policy can act on; and pinned
versions of bun and the Docker CLI. It is `EXECUTION_HOST=docker` only. `process` would need git,
Node and the Claude CLI in the image and would run every agent inside the Runner's own container —
one shared sandbox for every run, which the constitution's sandbox invariant forbids.

```bash
sudo mkdir -p /srv/factory/runs && sudo chown 1000:1000 /srv/factory/runs   # once
stat -c %g /var/run/docker.sock                                              # → DOCKER_GID, into .env
docker compose -f infra/runner/compose.yml --env-file .env up -d --build
docker compose -f infra/runner/compose.yml logs -f runner
```

Three things the compose file gets right that are easy to get wrong, and that any other way of
running the image must get right too:

1. **The same path on both sides.** An isolated step bind-mounts a run's workspace into a step's
   container, and the daemon resolves that path **on the host**. So the runs directory is mounted at
   an identical path inside the Runner's container and on the host, and `FACTORY_WORK_DIR` names it
   (`FACTORY_RUNS_DIR` in `.env`, default `/srv/factory/runs`). A different path on either side and
   every isolated step sees an empty directory.
2. **State on a volume.** `FACTORY_STATE_DIR` is a named volume. Without it a restart forgets every
   run in flight — which is the one thing the restart policy exists to prevent.
3. **The host's network.** The application reaches the Runner, the Runner reaches the application,
   and the Run it card publishes on the host's loopback; every one of those addresses says
   `localhost`. `network_mode: host` keeps all of them true. The Runner already holds the Docker
   socket, so no isolation it had is given up.

The image runs as uid 1000 — the same uid the sandbox image runs as — so a workspace directory the
Runner makes is writable inside a step's container. `group_add` gives that user the host's `docker`
group, which is why `DOCKER_GID` has to be right; a wrong id shows up as `container_host:
unreachable` on **Test every connection**, with `permission denied` in the Runner's log.

The socket is root-equivalent on the host. That is the arrangement the constitution allows for
exactly one component — the one holding execution rights, which serves no interface and no session
(Principle V) — and no other container may be given it. Where the machine's policy wants more, a
rootless daemon, or a socket proxy that exposes only the container, exec and image endpoints, both
work unchanged with this image.

The same image runs equally well under systemd on the host instead, with `Restart=always` and
`MemoryMax=`; the compose file is the shape, not the requirement.

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
| `a callback could not be delivered; it will be tried again` (runner) | The application did not answer; `attempt` and `next_attempt_in_ms` say where the retry stands. One or two during a deploy is normal; a run of them means the application is down |
| `the container host is not answering` (runner) | Docker stopped answering after startup. `consequence` says what that costs this deployment; steps in flight wait for it, and `the container host is answering again` follows with how long it was gone |
| `the container host is not answering; the run waits for it` (runner) | A run lost its sandbox while Docker was down and is waiting, for up to five minutes, rather than failing |
| `removed stopped sandboxes nothing was going to release` (runner) | Housekeeping: containers left by a crash, or by an older Runner, were removed. Informational |
| `stopped processes still running in an adopted sandbox from before the restart` (runner) | The last Runner died mid-step and its agent kept working; it was stopped before the step ran again. Expected after a crash; a surprise after a clean stop |
| `stopped launches a restart had forgotten` (runner) | Launch containers nobody could reach any more were removed. Informational |
| `the provider did not open the merge request; it will be asked again` (runner) | GitLab or GitHub stumbled at the last step; retried, after a look for an already-open request |
| `shutting down` … `shutdown: runs left where a restart picks them up` (runner) | A clean stop. `agents_stopped_in` names the runs whose agents were working; they run their step again after the restart |
| `isolated steps will not be able to write their workspace` (runner, at startup) | The Runner runs as root under `process`; run it as an unprivileged user or use `EXECUTION_HOST=docker` |
| `another runner holds …` (runner, refusing to start) | Two Runners share a state directory. Stop one, or give it its own `FACTORY_STATE_DIR` |
| `could not release the sandbox of a run that ended` (runner) | `docker rm` failed or timed out; the container is still there. The maintenance pass retries; if it repeats, the daemon is refusing |
| `could not write the failure down` (runner) | The state directory refused a write while a run was failing. Disk, first |
| `the run was released while it was being driven` (runner, in a failure detail) | Expected: a cancel landed during a step and the loop stood down |

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

**Before a step runs again after a restart, whatever the last Runner left running in the adopted
sandbox is stopped.** The Runner's death killed the `docker exec` client of the step that was
executing, not the agent inside the container; that agent went on working — and spending — with
nothing recording it, while the restarted Runner started the step again beside it. Adoption now
stops every process in the sandbox but the `sleep` that keeps it alive, and logs how many it found
(`stopped processes still running in an adopted sandbox from before the restart`). Under `process`
the same is done for processes whose working directory is the run's, on Linux.

**A stop is clean.** On `SIGTERM` or `SIGINT` the Runner refuses new runs with `503` (the
application retries later), stops the agents of every step in flight so nothing works headless
while it is down, discards the outcome of a step that concludes because of that (the step runs again
after the restart), lets deliveries settle for up to ten seconds, releases its lock, and exits `0`.
Every run is left where the restart picks it up. `docker stop`, systemd's `Restart=` and a deploy
all send `SIGTERM`; nothing needs configuring.

**A run that ends stays ended.** A cancel that lands while a step is executing is not undone when
the step finishes — the loop re-reads the run's state before writing, and a state that is gone or
cancelled is a signal to stop, not something to write over. A `failed` or `cancelled` outcome is
written down before it is sent or the sandbox released, so a Runner that stops in the middle of
either finishes the job on restart: the application is told, the sandbox goes, the run is forgotten.
The merge request's address is written down the moment it is opened, and the provider is asked
whether it already has one for the branch before a new one is created, so a restart between
opening it and telling the application never opens a second.

A step that had **finished** when the Runner stopped is not run again. Its outcome is written to the
state file before it is sent to the application, so a Runner that picks the run up sends that
outcome first — before it asks the application for anything else — and goes on from there. The
application treats a repeated delivery as a no-op (FR-095), which is what makes writing it down
before sending it safe.

**Restarting the application** does not fail runs that finish a step meanwhile. A callback the loop
depends on is retried with pauses that double up to a minute, for fifteen minutes in all, each
request with a timeout of its own; only when that budget is spent does the run fail, naming the
application as unreachable. The old schedule gave up after twelve seconds — less than an
application restart takes.

**Opening the merge request** — the last step, after every expensive one has succeeded — is
retried when the provider cannot be reached or answers 5xx or 429, with pauses of 2, 5 and 10
seconds. Before each retry the Runner asks the provider whether it already has an open merge request
for the branch, so a create whose answer was lost is found rather than repeated; a 4xx that is not
429 is a refusal and is not retried. Every request to the application and to a provider carries a
30-second timeout (`apps/runner/src/container/reach.ts`), so a hung connection fails the request
rather than holding the run.

**Every Docker management command has a deadline** (30 s; 120 s to create, which may pull an
image), so a wedged daemon fails a command rather than holding a loop — and the shutdown behind it —
for ever. A removal is checked: `docker rm` failing used to log `sandbox released` and forget the
container; it now fails the release, which the maintenance pass retries. A step stopped at its
deadline under Docker has its agent stopped too, not only the `docker exec` client that was
watching it.

**Restarting the Docker daemon** takes every sandbox with it unless the daemon is configured to keep
them (`live-restore`). A run whose step was executing loses its sandbox; the Runner asks the daemon
whether it is answering, and if it is not, waits for it — for five minutes, polling every ten
seconds — and then goes on in a replacement sandbox built from the branch. A daemon still silent
after five minutes fails the run, saying that it was the daemon. Stopped containers the Runner
made and nothing was going to release are removed at startup and every ten minutes; a running one
is never touched by that sweep, because it may be a retained failed sandbox somebody is inspecting.
Launches are the exception: they live in memory, so a restarted Runner knows none of them, and a
launch nobody can show, stop or reach is removed at startup whether or not it is running — this
Runner's launches only, told apart by the `factory.runner` label every container carries.

**A retained failed sandbox survives a restart.** Run records are kept on disk under
`FACTORY_STATE_DIR/runs` — everything but the credentials, which stay in memory — so when the
retention window ends and the application asks for the sandbox to be released, a Runner that has
restarted in between still knows which container that is.

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
