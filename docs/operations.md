# Deploying and operating Code Factory

What to install, what to configure, what to schedule, and what to watch. Written for whoever is on
call, not for whoever wrote it.

Everything here was verified against a real deployment except where it says otherwise — the
exceptions are listed under [What has not been run](#what-has-not-been-run) rather than left for you
to discover.

## What you are deploying

Two long-running services, one database, one workflow definition, and one container image.

| Piece | What it is | Where it may be reached from |
| --- | --- | --- |
| **`apps/web`** | SvelteKit. Every screen, every remote function, and the callback and exchange routes the other pieces use. Holds the encryption key. | The public internet — people sign in to it |
| **`apps/runner`** | An HTTP service with four operations. **The only component that executes anything** — as processes on its own machine, or as containers on a Docker daemon (Principle V, research.md D5). | The orchestration service and the web application only. **Never the public internet** |
| **Postgres 16+** | The only datastore. `LISTEN`/`NOTIFY` carries live run updates to browsers | Both services |
| **n8n** | Executes the one generic workflow, and holds gates paused in `Wait` nodes | The web application posts to it; it posts back |
| **Sandbox image** | `infra/sandbox/Dockerfile`. One fresh container per run, non-root, destroyed at the end. Used under `EXECUTION_HOST=docker`, and by the Run it card always | Built once, pulled by the container host |

The web application never holds a container handle, and the orchestration service never holds a
credential value. Both are deliberate and both are load-bearing — see
[credential-path.md](./reviews/credential-path.md).

## Bringing it up

```bash
bun install                                   # workspace root; Bun is pinned in .bun-version
docker compose up -d postgres                 # or point DATABASE_URL at your own
bun run db:migrate                            # drizzle-kit; idempotent, safe to re-run
docker build -t code-factory/sandbox:latest infra/sandbox   # for EXECUTION_HOST=docker
EXECUTION_HOST=docker bun run dev:runner      # apps/runner → :8080, needs Docker access
bun run dev:web                               # apps/web  → :5173
```

On a development machine `bun run dev` does all of this, with runs executing as processes on that
machine and n8n started there too — see [Execution hosts](#execution-hosts) for what that trades
away and why a deployment should not.

Import `orchestration/n8n/run-ticket-pipeline.json` into n8n and publish it. It is **one generic
workflow for every pipeline** — a pipeline's steps are read from the run's snapshot at execution
time. Do not edit it per pipeline; `apps/web/tests/contract/workflow.test.ts` fails if a step name,
model or agent name is ever baked into it. n8n needs `RUNNER_BASE_URL` and `RUNNER_AUTH_TOKEN` in
its environment, and `N8N_BLOCK_ENV_ACCESS_IN_NODE=false` so the workflow may read them.

Then, in the application: sign in, open **Settings**, and set the orchestration service address, the
container host address and a model credential. The dashboard names anything still missing and links
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
| `ORCHESTRATOR_BASE_URL` | yes | |
| `ORCHESTRATOR_API_KEY` | | |
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
| `EXECUTION_HOST` | `process` | `process`: runs execute as processes on this machine. `docker`: one fresh container per run. **A deployment should set `docker`** — see [Execution hosts](#execution-hosts) |
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

**Accepted risk, recorded here because this is where the decision lives.** The constitution's
sandbox invariant — one fresh sandbox per run, non-root, bounded in processing power, memory and
lifetime — is met only by `docker`. `process` exists because on a development machine the container
layer cost more than it protected: every address had to be spelt twice, the clone failed inside an
isolated container, and the token never reached the containerised orchestrator. A run under
`process` executes an agent's arbitrary code as the person running the Runner, on their machine,
against repositories they already hold credentials for. That is acceptable for that person's own
machine and for nothing else. A deployment MUST set `EXECUTION_HOST=docker`.

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
   route that exchanges credential references for values. It requires the run's own secret, and the
   orchestration service holds that secret because it needs it for callbacks — so anyone who can
   read an n8n execution can call this route and be handed the git token and the model key. An n8n
   execution list is, in effect, a list of bearer tokens. Restrict the route at the proxy, keep
   n8n's execution retention short, and keep n8n's own access controls tight. This is documented as
   a residual risk in [credential-path.md](./reviews/credential-path.md); it cannot be fixed inside
   the application.

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
| `trigger delivery failed, will retry` | n8n is not answering. Retries with backoff; a ticket sits `queued` meanwhile |
| `the specification step produced no usable classification` | FR-102 — the run continues, treated as not interface work, and the warning is on the run for a person to see. Not an outage |
| `run stopped at a ceiling` | Working as intended. Worth counting, not alerting |

A run's own state is on its ticket page and needs no log reading: which step is executing, what has
been spent, what the last agent produced, and the failing step and reason when it fails.

## Restarting things

**The web application** is stateless apart from its database connections; restart freely. Browsers
watching a run reconnect and re-read, so a viewer sees correct state rather than a frozen one.

**The Runner keeps its run-to-container mapping in memory.** A restart loses it, and a sandbox
belonging to an in-flight run can then only be reclaimed by hand or by its own lifetime limit. Drain
before restarting where you can: `Settings → Runs now` shows what is executing.

**n8n holds paused gates in `Wait` nodes.** Its own persistence is what survives a restart; if an
execution is lost, the run's `resume_url` is stored on the run so a gate stays drivable.

## What has not been run

Stated plainly, because a deployment guide that implies more was tested than was is worse than a
short one:

- **No end-to-end run has ever executed.** This environment has no Docker daemon, no n8n instance,
  and no provider credential. The Runner starts, authenticates, and correctly reports its container
  host unreachable; the workflow is importable and its structure is checked by contract tests, but
  it has never executed a step.
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
