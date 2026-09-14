# Quickstart & Validation: Run a ticket's branch on a real port

**Feature**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Date**: 2026-09-14

How to see a ticket's branch running and prove the feature works. The steps are the two user
stories' **Independent Tests**, in order. Structure lives in [data-model.md](./data-model.md) and
[contracts/launches.md](./contracts/launches.md); the decisions and figures in
[research.md](./research.md). This is the run guide — and it is also
[tasks.md](./tasks.md) T013, the one task that needs a machine with a container daemon.

## Prerequisites

| Need | Why |
|---|---|
| Everything `bun run dev` brings up: Postgres, n8n, the sandbox image, the execution service and the application | The feature is a card on the ticket page and three routes on the execution service |
| Docker, running | A launch is a fresh container with one port published on loopback (FR-002, FR-006) |
| A connected repository whose branch holds a Node project with a `dev` or `start` script | What the shipped detector understands (research.md) |
| A ticket on it whose run has finished and pushed its branch | Run it is available only then (FR-003) |

## Step 0 — Prove nothing broke, with no daemon at all

```bash
bun install
bun run verify        # lint, typecheck, both audits, the whole suite
```

**Expect**: green. The execution service's lifecycle is tested through `FakeHost` with a fake
readiness check, so this stays true on a machine with no Docker. If a test here ever needs a
daemon, that is a defect in the test.

## Step 1 — Run it (User Story 1)

```bash
bun run dev           # step 3 applies migration 0006; then open the application
```

Open a finished ticket. In the right-hand column, under Artifacts, the **Run it** card names the
branch and offers the button.

1. Press **Run it**. **Expect**: the card says *Starting* and shows the project's own output as it
   clones, installs and starts (FR-008). "Command from package.json — Vite, npm run dev" (or
   whatever was detected) appears under it (FR-004).
2. Within two minutes on a warm image (SC-001), the card says *Running at
   http://localhost:49153* — the port is whatever Docker chose (FR-006, D3).
3. If the ticket was classified as changing the interface, the page itself is framed on the card;
   otherwise the **Requests** face shows. Switch with **Page** / **Requests**; **Open in new tab**
   opens the address directly (FR-013).
4. On the Requests face, send `GET /api/health` (or any path the project has). **Expect**: status,
   time, response headers behind a toggle, and the body — pretty-printed when it is JSON (FR-014,
   SC-004). Type a full address as the path: it is refused with a message (FR-018).
5. Press **Stop**. **Expect**: the card says *Stopped.* and the address stops answering within a
   minute (FR-002, SC-003).

```bash
docker ps --filter label=code-factory   # after Stop: no container for the launch
```

Leave a launch running and do not open the ticket for 30 minutes: it is stopped and the card says
nobody was looking (FR-011). Set a short wall-clock ceiling in Settings and let it pass: the next
look says the lifetime ceiling was reached (FR-012).

## Step 2 — Tell a repository how it starts (User Story 2)

Repositories → the row's menu → **Set how it starts**. Set the command to what the project needs,
in the shape the form shows, and the port it listens on; leave both empty to go back to detection.

```text
npm run dev -- --host 0.0.0.0 --port $PORT
```

Press Run it on one of its tickets. **Expect**: "Command from set on the repository", and no
detection (FR-005). Set a command that fails at once (`false`): the launch fails with the exit
code and the output, in seconds, not after the start period (FR-009).

## When it does not work

| The card says | What it means | What to do |
|---|---|---|
| *package.json has neither a `dev` nor a `start` script* | The detector found nothing to run (FR-016) | Set a command on the repository |
| *This project runs from a Dockerfile* / names Python, Go or Rust | The sandbox image runs Node only | Out of scope to run; set a command only if the project can start under Node |
| *Nothing answered on port N within 120 seconds … probably listening on localhost* | The server bound `127.0.0.1` inside the container | Give it `--host 0.0.0.0` (or honour `HOST`) in the repository's command |
| *The project exited with code N before it started listening* | A crash on boot; the output is under it (FR-009) | Read the output; fix the project or the command |
| *Could not clone …: the access token was rejected* | The repository credential no longer works | Replace the token on the repository |
| *The branch … is not on …* | The run's push was refused or the branch was deleted | Retry the run |
| *The execution service restarted, and the launch went with it* | The service's memory of the launch is gone, and so is its container | Press Run it again |
| *Could not reach the execution service* | The runner is not up, or Settings has the wrong address | `bun run dev`, or fix the address in Settings |

## What this feature does not do

Reach a launch from another machine (the port is loopback on the execution host), run a
checkpoint's uncommitted workspace, or run anything the sandbox image cannot — all recorded in
spec.md's Assumptions.
