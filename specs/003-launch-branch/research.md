# Phase 0: Research — Run a ticket's branch on a real port

**Feature**: `specs/003-launch-branch` | **Date**: 2026-09-14 | **Plan**: [plan.md](./plan.md)

The decisions are listed in plan.md; this file holds what each one was chosen over, and the
figures. Everything here was checked against the code as shipped in `e26a0e3` and `c36c1d3`.
Nothing has yet been run against a real container daemon ([tasks.md](./tasks.md) T013), and the
figures that depend on one are marked as targets.

---

## D1 — A detached start, not a request held open

**Decision**: `POST /launches` answers `202` at once with `starting`. Cloning, installing and
starting continue inside the execution service; the application asks after the launch every two
seconds while it starts and every eight once it runs.

**Alternatives considered**: holding the request open until the port answers — rejected because
`npm ci` alone can run for minutes, and a request that long times out somewhere between the
browser, the application and the service, leaving a sandbox running that nothing records. A
server-sent stream of the output — rejected as more than the screen needs; the output is tailed on
each look instead (forty lines), which is what a person reads anyway.

## D2 — The request console sends from the application

**Decision**: the composed request goes from the application's server to the launch, and the
answer comes back shaped for the screen.

**Alternatives considered**: `fetch` from the browser to the launch's port — rejected because any
project that did not set cross-origin headers refuses it, which is every project this feature is
for. Proxying the whole project through the application under its own path — rejected because a
page's absolute links, its websockets and its dev server's reload channel all break under a
prefix; the page is framed at its own address instead, with "Open in new tab" for pages that
refuse framing.

**What the console must not become**: a way of reaching arbitrary addresses from the
application's network position. The path is normalised — a full address or a protocol-relative
one is refused before anything is sent (FR-018); only `Host` is dropped from the typed headers,
because it is the one header that could make the request look aimed at another site, while cookies
and authorization go through because testing a project's own sign-in is what the console is for.
The body is read up to 256 KB and the stream is then cancelled (FR-019).

## D3 — Loopback, with a host port chosen by the container runtime

**Decision**: the container is created with `--publish 127.0.0.1::<port>` and the address is read
back with `docker port`.

**Alternatives considered**: an allocator in the service choosing a host port — rejected as one
more thing to get wrong (collisions between two launches, ports left marked busy after a crash).
Publishing on every interface — rejected by FR-006: a launch is for the person at the machine.
A reverse proxy in front of every launch — rejected as the one component the feature could do
without.

## D4 — An exit sentinel beside the readiness poll

**Decision**: the start script records the command's exit code to a file when it ends; the
readiness loop checks for that file on every turn and fails at once with the output if it exists.

**Alternatives considered**: readiness alone — rejected because a project that crashes on boot
would then take the full start period (120 s) to be reported, with nothing on the screen but
"Starting…" in the meantime. Watching the process table — rejected as fragile across shells and
`npm` wrappers, which spawn children of their own.

## D5 — Detection reads the cloned workspace

**Decision**: `package.json` and the lockfiles are read from the clone inside a first, short-lived
sandbox; the launch's own sandbox is then created with the detected port published.

**Alternatives considered**: reading the files from the provider's API — rejected because it
means a second provider client (GitLab and GitHub differ) and can read a different revision from
the one that will run. Publishing a range of ports speculatively so one sandbox would do —
rejected because the port has to be known when the container is created, and a range on loopback
is a stranger thing to explain than a second clone that takes a few seconds.

## D6 — The address a browser opens

**Decision**: the execution service's host name from the workspace's runner address, plus the
port the container runtime chose. The page is framed at that address directly.

**Alternatives considered**: see D2's proxy alternative. The assumption this rests on is stated in
spec.md: the browser reaches the execution service's host name, which holds when both are on one
machine, which is what FR-006 already assumes.

## D7 — Where the button lives, and how the command is chosen

**Decision**: on the ticket page, available once the run has finished and pushed its branch; the
command is detected from the workspace with a per-repository override.

These were the two questions put to the product owner before building; both answers were the
recommended ones. Alternatives offered and declined: a button on the ticket board (too far from
the merge request the person is about to read) or at every checkpoint (runs a workspace the run has
not finished, which is a different feature — recorded in Assumptions); a mandatory per-repository
command (fails every first launch until somebody configures it) or detection with no override
(fails every project the guesser does not understand).

---

## Figures

| Figure | Value | Where | Why this value |
|---|---|---|---|
| Start period | 120 s | `DEFAULT_START_TIMEOUT_MS` | Long enough for a cold dev server; short enough that "nothing answered" is still news (FR-010). Target until T013 |
| Install period | 10 min | `DEFAULT_INSTALL_TIMEOUT_MS` | `npm ci` on a large project with a cold cache |
| Idle period | 30 min | `DEFAULT_IDLE_MS` | A reviewer's attention span between two looks, with room (FR-011) |
| Sweep interval | 60 s | `apps/runner/src/index.ts` | Idle is measured in minutes; a finer sweep buys nothing |
| Output tail | 40 lines | `LOG_TAIL` | What fits in the card without scrolling the page |
| Console body cap | 256 KB | `CONSOLE_BODY_CAP` | Any JSON a person will read; pretty-printing stops above it (FR-019) |
| Console timeout | 15 s | `CONSOLE_TIMEOUT_MS` | Longer than any healthy request; shorter than a person's patience |
| Poll while starting / running | 2 s / 8 s | `LaunchPanel.svelte` | The output moves while starting; only a lapse changes anything once running |

## Frameworks the detector knows

Each dev server needs telling to bind every interface, or it is unreachable from outside its
container however faithfully the port is published (spec.md, Edge Cases). In the order they win
when more than one is present:

| Dependency | Command | Default port |
|---|---|---|
| `next` | `npm run <script> -- -H 0.0.0.0 -p $PORT` | 3000 |
| `nuxt` | `npm run <script> -- --host 0.0.0.0 --port $PORT` | 3000 |
| `astro` | same shape | 4321 |
| `@sveltejs/kit` | same shape | 5173 |
| `vite` | same shape | 5173 |
| `@angular/cli` | same shape | 4200 |
| none of these | `npm run dev`, else `npm run start`, with a note that the server must honour `HOST` and `PORT` | 3000 |

`<script>` is `dev` when present, else `start`. A `package-lock.json` installs with `npm ci`; any
other lockfile installs with `npm install` and the launch says so, because the sandbox image has
npm only. Anything without a `package.json` — a Dockerfile, `requirements.txt`, `pyproject.toml`,
`go.mod`, `Cargo.toml` — is recognised only so the refusal can name it (FR-016).
