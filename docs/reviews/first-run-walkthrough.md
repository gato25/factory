# First-run walkthrough

**Criterion**: SC-001 — a new user, from a fresh workspace and without consulting documentation, can
go from signing in to an open merge request in under 15 minutes of their own attention.
**Task**: T229 · **Date**: 2026-09-10

## How this was done

The database was emptied to a genuinely fresh state — no workspace row, no user, no repository, no
credential — and the product was driven through a browser, reading only what the screens said. No
documentation was consulted, which is the point: the criterion is about whether the product explains
itself.

Timings are of the *product's* part, measured in the browser. A person's reading, typing and
decision time is separate and is estimated below, because that is what "their own attention" means
and no automated walkthrough can measure it.

## What a new user actually met, in order

**1. `/` unauthenticated → `/login`.** The sign-in screen says what the product is and shows the
pipeline as a row of steps — `Ticket → Spec → Design → Plan → Tasks → Implement → MR` — with the one
sentence that makes it comprehensible: *"Design runs only when a ticket changes the interface."* Both
providers are offered, with email and password beneath. Nothing to learn, nothing to look up. Good.

**2. The dashboard.** Four zeroes, an empty run list, an empty activity feed.

> **Finding 1 (fixed).** The empty run list said *"Nothing running. Create a ticket to start a
> pipeline."* On a fresh deployment that advice cannot work — there is no repository, no
> orchestration address, and no model credential — and following it leads to a ticket form that
> refuses with `REPOSITORY REQUIRED` and no explanation. A new user's first action, taken on the
> product's own instruction, was a dead end.
>
> `readiness()` already knew exactly what was missing, and nothing read it outside the
> administrator-only settings query. The dashboard now says:
>
> > Nothing can run yet: this workspace still needs the orchestration service address, the runner
> > address, a model credential and a connected repository. Set that up in Settings and Repositories.
>
> It narrows as things are done — once only the repository is missing it says so, and links only to
> Repositories. A member, who cannot fix connections or credentials (FR-004), is told to ask an
> administrator instead of being sent to a screen that will not let them. The empty run list no
> longer gives advice at all: whether creating a ticket would work is the notice's question to
> answer, and telling somebody to do something that cannot work is worse than saying nothing.

**3. `/settings`.**

> **Finding 2 (fixed).** It answered **HTTP 500**. `getWorkspace` reported `this deployment has no
> workspace yet`, and nothing created the row: `ensureWorkspace` existed and was called only from
> the *write* paths — which were unreachable, because the page that contains them would not render.
> A fresh deployment had no way out of this by hand.
>
> The row is now created on read. A deployment has exactly one workspace by definition; the row is
> where its settings live, not something a person creates, and its absence carries no information
> worth propagating. Two first requests arriving together both try to insert; the
> `workspaces_singleton` index refuses one, and that is treated as the index doing its job — the row
> it wanted now exists. Both cases are covered in
> `apps/web/tests/integration/connections.test.ts`.

Once rendering, the screen is well ordered and explains its own fields: the cost limits section says
these are *"the ceilings a member's own limits cannot exceed"*, and the sandbox section says why
network access is off by default — *"an agent writing code does not need the internet, and a sandbox
that cannot reach it cannot send anything out."* The credentials section states the consequence
before you act: *"never shown again — not even to you."*

**4. Test every connection.** Reported honestly, and differently for each:

| | |
| --- | --- |
| Orchestration service | `unreachable` — Nothing answered at that address. Check the address, and that it is running. |
| Container host | `reachable` — Reachable, and it accepted our credential. |
| Design service | `unconfigured` — No design credential yet. That is only a problem for a pipeline containing a design step, which would fail at that step and say so. |

Those three are genuinely different states with genuinely different fixes, which is what FR-005a
asks for. The Runner was actually running during this walkthrough, so `reachable` is a real result
rather than an optimistic default.

> **Finding 3 (fixed, and recorded in [credential-path.md](./credential-path.md)).** During this
> walkthrough the Runner probe reported `reachable — it accepted our credential` for a *wrong*
> token. It probed `/health`, which is unauthenticated by design, so it could never fail on a
> credential. Fixed by adding an authenticated `GET /ready` to the Runner and pointing the probe at
> it with the credential attached; a wrong token now reports `unauthorised — It answered but refused
> our credential. Replace the credential.`

**5. `/repositories`.** *"Every ticket belongs to exactly one repository."* — one sentence, and it
is the one you need. *"No repositories connected yet. Connect one to create your first ticket."*
This screen was already giving the right next step, which is what made the dashboard's wrong advice
stand out.

**6. `/tickets/new`.** `REPOSITORY REQUIRED`, `TITLE REQUIRED`, `DESCRIPTION`, `ACCEPTANCE CRITERIA
— ONE PER LINE`, and beneath the criteria: *"These are the biggest quality lever you have. Be
specific and testable."* That is the single most useful sentence for a first-time user, and it is on
the field it concerns. `PIPELINE — Use the repository's default` means a first ticket needs no
decision about pipelines at all.

## Timing

| Step | Product's time | A person's attention (estimated) |
| --- | --- | --- |
| Read the sign-in screen, sign in | < 1s | 30s |
| Read the dashboard notice | < 1s (SSR + one query) | 15s |
| Settings: two addresses, save | 0.5s | 60s — finding the n8n and Runner addresses is the slow part |
| Settings: store the model credential | 0.1s | 30s, assuming the key is to hand |
| Test every connection | 0.1s | 20s to read three results |
| Connect a repository | not measured (needs a provider token) | 90s — pasting a path and a token |
| Create a ticket with two criteria | not measured | 3–5 min — **writing good acceptance criteria is the real cost**, and correctly so |
| Watch the run to a merge request | not measured (see below) | 5–20 min of *waiting*, little of it attention |

**Product time to a startable state: 2.9 seconds.** Estimated attention to the same point: **4–8
minutes**, dominated by writing the ticket — which is the work, not overhead.

## Verdict

**Met to the point of a startable ticket, unverified beyond it.**

Nothing in the path required documentation. Every screen stated its own purpose, every required
field said it was required, and after the two fixes above, the product names exactly what is missing
and where to fix it at every stage. Reaching a state where a ticket can be started took under three
seconds of the product's time and, by estimate, four to eight minutes of a person's — comfortably
inside fifteen.

**What is not verified.** The walkthrough stops before "an open merge request", because this
environment cannot produce one:

- **No container host.** `docker version` reports `dial unix /var/run/docker.sock: connect: no such
  file or directory`. The Runner starts, authenticates, and reports `container_host: unreachable` —
  correctly — but no sandbox can be created, so no step can run.
- **No orchestration service.** Nothing is listening on `localhost:5678`. The workflow is
  importable and its structure is checked by `apps/web/tests/contract/workflow.test.ts`, but it has
  never executed.
- **No provider credential.** No GitLab or GitHub token with push and merge-request rights, so no
  branch can be pushed and no merge request opened. `git ls-remote` against a public repository
  succeeds, so outbound access exists; only the credential is absent.
- **No model credential.** No agent step can run.

The three end-to-end specs that need those services are skipped rather than passed
(`ticket-to-mr.spec.ts`), which is the honest state: they are written and they are waiting for an
environment, not silently green. What was verified here is everything up to the moment the pipeline
would start, plus every part of the value path that is exercised by the 447 unit and integration
tests and the 37 browser tests.

An operator completing this walkthrough on a real deployment should confirm the last two rows of the
timing table themselves; [operations.md](../operations.md) lists what to have ready before starting,
so the fifteen minutes is not spent hunting for an address or a token.
