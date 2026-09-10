# Code Factory — Product Specification

Version 0.1 · 2026-09-10
Design reference: `design.pen` (screens 00–13)

---

## 1. Overview

Code Factory turns a ticket into a merge request automatically.

A user connects a git repository, writes a ticket describing a change, and a pipeline of AI agents produces a specification, a plan, a task list, and finally the implementation. When the pipeline finishes, the system pushes a branch, opens a merge request (MR) on the git provider, and closes the ticket. Humans can insert checkpoints anywhere in the pipeline to review and approve before the next step runs.

### Core principles

| Principle | Meaning |
| --- | --- |
| One ticket, one repo, one run at a time | Every ticket belongs to exactly one repository. A ticket has one active run; retries create a new run on the same ticket. |
| Pipelines are data | A pipeline is an ordered list of steps stored in the app database. Users edit it in the UI. Nothing about a pipeline is hard-coded in the orchestrator. |
| Agents are Claude CLI runs | Every agent step is a headless `claude -p` invocation with its own system prompt, model, allowed tools and skills. |
| n8n orchestrates, the app stays thin | The app stores data and renders UI. n8n executes the pipeline, waits at checkpoints, and opens the MR. |
| Docker isolates | Each run gets one fresh container with the repo, the CLI and the toolchain. It is destroyed at the end. |
| Files are the hand-off | Each agent step reads and writes markdown files in the repo workspace (`docs/spec.md`, `docs/plan.md`, `docs/tasks.md`). The next step reads them. |
| Steps may be conditional | A step can carry a condition. When the condition is false the step is skipped and recorded as skipped, not failed. This is how UI work gets designed and non-UI work does not. |
| UI work is designed before it is built | When a ticket changes the interface, a Design step produces screens with the pen.dev CLI before any code is planned or written. The screens are committed as a `.pen` file and as exported images. |
| Unlimited tickets | Any user may create any number of tickets. Limits are enforced by cost caps and concurrency, not by ticket count. |

### Out of scope for this version

Hosting model, tech stack of the app itself, billing, multi-tenant SaaS concerns. These are deliberately deferred.

---

## 2. Actors and components

```
User (browser)
   │  HTTPS
   ▼
Factory App  ── web UI, REST API, database ──────────────┐
   │  webhook: ticket.created                            │ callback: step results,
   ▼                                                     │ status, logs, MR link
n8n  ── workflow "run-ticket-pipeline" ◄─────────────────┘
   │  HTTP: run step (agent / shell / checkpoint / notify)
   ▼
Runner service ── starts and talks to Docker
   │
   ▼
Docker container (one per run)
   ├─ cloned repo on branch factory/<ticket-id>-<slug>
   ├─ .claude/agents/*.md and .claude/skills/** written from agent config
   └─ claude -p "<step prompt>" --output-format json --allowedTools … --model …
   │  git push · provider API
   ▼
Git provider (GitLab / GitHub) ── branch + merge request
```

| Component | Responsibility |
| --- | --- |
| **Factory App** | UI, authentication, storage of repos, tickets, pipelines, agents, skills, runs and artifacts. Fires the webhook to n8n. Receives callbacks. Resumes n8n Wait nodes when a human approves. |
| **n8n** | One generic workflow. Receives the resolved pipeline as JSON, iterates steps in order, calls the Runner for agent and shell steps, pauses on Wait nodes for checkpoints, opens the MR at the end, posts results back to the app. |
| **Runner** | Small HTTP service next to Docker. Creates the container, clones the repo, injects config and credentials, executes one step at a time, streams logs, enforces limits, destroys the container. |
| **Docker container** | Sandbox with git, Claude CLI, language toolchains. Never reused between runs. |
| **Git provider** | Source of truth for code. Receives the branch and hosts the MR. |
| **Claude CLI** | The agent engine. Invoked once per agent step. |

---

## 3. Data model

All entities live in the Factory App database.

### Workspace
One per team. Holds members, the Anthropic key, the n8n connection, Docker runner settings and cost limits.

### User
`id, name, email, avatar, role (admin | member)`. Users sign in with GitLab, GitHub or email.

### Repository
| Field | Notes |
| --- | --- |
| `id, workspace_id` | |
| `name, full_path` | e.g. `shop-frontend`, `netgroup/shop-frontend` |
| `provider` | `gitlab` \| `github` \| `self-hosted` |
| `url` | clone URL |
| `default_branch` | e.g. `main` |
| `credential_ref` | reference to the encrypted access token |
| `default_pipeline_id` | pipeline used when a ticket does not choose one |
| `status` | `connected` \| `token_expired` \| `error` |

### Ticket
| Field | Notes |
| --- | --- |
| `id` | shown as `#142` |
| `repository_id, created_by` | |
| `title, description` | free text |
| `acceptance_criteria[]` | one per line, must all hold at the end |
| `pipeline_id, pipeline_version` | pinned when the run starts |
| `status` | `backlog` \| `queued` \| `running` \| `waiting_approval` \| `done` \| `failed` \| `cancelled` |
| `current_run_id` | |
| `branch_name` | `factory/<id>-<slug>` |
| `merge_request_url` | set at the end |
| `has_ui` | `null` until the Spec agent decides, then `true` or `false`. Drives every conditional design step. See §8.6. |
| `ui_rationale` | one sentence from the Spec agent explaining the decision, shown in the UI |

### Pipeline
| Field | Notes |
| --- | --- |
| `id, workspace_id, name, description` | e.g. "Standard", "Review-heavy", "Quick fix" |
| `version` | incremented on every save; runs pin a version |
| `steps[]` | ordered list of Step |

### Step (embedded in Pipeline)
| Field | Notes |
| --- | --- |
| `type` | `agent` \| `design` \| `checkpoint` \| `shell` \| `notify` |
| `agent_id` | for `agent` and `design` steps |
| `output_files[]` | files the step must produce, e.g. `docs/spec.md` |
| `condition` | `always` (default) \| `ticket_has_ui` \| `ticket_has_no_ui`. Evaluated when the step is reached. |
| `approvers` | for `checkpoint`: `anyone` \| `ticket_creator` \| list of user ids |
| `timeout_hours, on_timeout` | for `checkpoint`: `wait_forever` \| `auto_continue` \| `fail` |
| `command` | for `shell` steps, e.g. `npm run lint` |
| `channel, template` | for `notify` steps |
| `design` | for `design` steps: `pen_file` (default `docs/design/ui.pen`), `export_dir` (default `docs/design/screens`), `export_scale`, `screens[]` (optional list of screens to require) |

### Agent
| Field | Notes |
| --- | --- |
| `id, workspace_id, name, description, icon` | |
| `kind` | `default` \| `custom` |
| `model` | e.g. `claude-opus-5`, `claude-sonnet-5`, `claude-haiku-4-5` |
| `system_prompt` | markdown, supports `{{variables}}` |
| `allowed_tools[]` | e.g. `Read, Edit, Write, Bash, Git push, WebFetch` |
| `skill_ids[]` | |
| `limits` | `max_cost_usd, max_minutes, max_turns` |

### Skill
`id, workspace_id, name (slug), description, content (markdown), updated_by, updated_at`. Written into `.claude/skills/<name>/SKILL.md` inside the container.

### Run
| Field | Notes |
| --- | --- |
| `id` | shown as `#142-r1` |
| `ticket_id, attempt` | |
| `pipeline_snapshot` | full resolved JSON sent to n8n |
| `status` | same vocabulary as Ticket plus `verifying`, `opening_mr` |
| `current_step_index` | |
| `n8n_execution_id, container_id, runner_image` | |
| `cost_usd, started_at, finished_at` | |

### StepResult
`run_id, step_index, status (done | running | waiting | failed | skipped), started_at, finished_at, duration_s, cost_usd, session_id, summary, log_ref, artifacts[]`.

### Artifact
`run_id, step_index, kind, path, content, version`. Also used for commit lists and the MR link.

| `kind` | Stored as | Shown as |
| --- | --- | --- |
| `document` | markdown text (`docs/spec.md`, `docs/plan.md`, `docs/tasks.md`) | rendered document |
| `design_file` | the `.pen` file, committed to the repo | download plus a link to open it in pen.dev |
| `screen` | one exported PNG per screen, with the screen name | image, in a gallery |
| `commits` | list of commit hashes and messages | list |
| `merge_request` | the MR URL | link |

A design step produces one `design_file` artifact and one `screen` artifact per exported image. Screens are the only artifact rendered as pictures; everything else is text.

### Approval
`run_id, step_index, decided_by, decision (approved | changes_requested | edited), feedback, decided_at`.

---

## 4. Screens

Every application screen shares the same frame: a white left sidebar (Dashboard, Repositories, Tickets, Pipelines, Agents, Skills, Settings, current user) and a top bar with the page title, global search, notifications and one primary action. Screen numbers match the artboard names in `design.pen`.

### 00 Login
**Purpose:** sign in.
Left panel explains the product in one sentence and shows the flow Ticket → Spec → Plan → Tasks → Implement → MR. Right panel offers "Continue with GitLab", "Continue with GitHub", or email and password.
**Behavior:** first successful sign-in creates the user in the workspace. No repositories are connected at this point.

### 01 Dashboard
**Purpose:** answer "what is happening right now and what needs me".
- Four stat tiles: connected repos, tickets running, waiting for approval, merge requests this week.
- **Active runs** list: ticket id, title, repo, a four-segment progress bar (Spec, Plan, Tasks, Implement) coloured by state, and a status badge.
- **Waiting for your approval** panel with a Review button per item. This is the most important call to action on the page.
- **Recent activity** feed: MR merged, run completed, run failed, checkpoint reached, ticket created.
**Behavior:** everything is live; the page updates as callbacks arrive from n8n.

### 02 Repositories
**Purpose:** see and manage connected repos.
Table columns: repository (name and path), provider, default branch, default pipeline, tickets (running · done), status (Connected / Token expired), overflow menu.
**Behavior:** clicking a row opens the repo; the overflow menu allows editing the default pipeline, rotating the token and disconnecting. A repo with `token_expired` blocks new tickets until fixed.

### 03 Connect Repository (modal)
**Purpose:** connect a repo in four steps.
1. Choose provider: GitLab, GitHub, Self-hosted Git.
2. Repository URL.
3. Access token, with the required scopes listed (`api, read_repository, write_repository` for GitLab). Stored encrypted.
4. Default pipeline for new tickets.
Primary action **Test & connect**.
**Behavior:** the app verifies the token by reading the repo and checking it can create branches and MRs before saving. Failure shows the exact missing permission.

### 04 Tickets Board
**Purpose:** overview of all tickets across repos.
Filters: repository, pipeline, creator. Toggle between board and list.
Columns: **Backlog**, **Running**, **Waiting approval**, **Done**, **Failed**. Each card shows ticket id, creator avatar, title, repo, pipeline, and a status strip: current step ("Implement · step 4 of 4"), the pending checkpoint ("Plan needs your approval"), the MR result ("MR !91 opened") or the failure reason ("Tests failed at Implement").
**Behavior:** cards move automatically as run status changes. Clicking a card opens 06 or 07.

### 05 Create Ticket
**Purpose:** describe the change well enough for agents to succeed.
Fields: repository (required), title (required), description, acceptance criteria (one per line), pipeline choice (Standard / Review-heavy / Quick fix) with a one-line explanation of each.
Right panel **What will happen** lists every step of the chosen pipeline with the agent and model, ending in "Open merge request". Conditional steps are shown greyed with the condition stated, for example "Design, only if this ticket changes the interface". A tip explains that acceptance criteria are the biggest quality lever.
Footer shows an estimated cost and duration. Actions: **Save as draft**, **Create & start pipeline**.
**Behavior:** on create, the ticket is stored with the pipeline version pinned, status becomes `queued`, and the webhook fires (see §5). The user does not declare whether the ticket has UI work; the Spec agent decides that at the first step (§8.6).

### 06a Design Review
**Purpose:** look at the screens the Design step produced and decide whether to build them.
Reached when a checkpoint follows a design step, and openable read-only at any later point from the run's artifacts.
- Banner naming the checkpoint and stating that no code has been written yet.
- **Screen gallery**: every exported image as a large thumbnail with its screen name. Clicking one opens it full size with next and previous.
- Side panel: the ticket's acceptance criteria, so the reviewer can check the screens against them, and the Spec agent's reason for classifying the ticket as UI work.
- Actions: **Approve & continue**, **Request changes** with a feedback box, **Open in pen.dev** (link to the committed `.pen` file), **Cancel run**.
**Behavior:** approving continues the pipeline to Plan. Requesting changes re-runs the design step with the feedback appended, which revises the existing `.pen` file rather than starting a new one (§8.6), then returns here with the new screens.

### 06 Ticket Run
**Purpose:** watch one run and understand exactly where it is.
- Header: breadcrumb, title, status badge, branch name, creator, start time, cost so far. Actions: **Pause**, **Cancel run**.
- **Pipeline steps** tracker: Spec, Design, Plan, Tasks, Implement, Merge request. Each shows done (green check), running (blue), upcoming (grey) or skipped (grey, struck through, with the reason "no UI change"), plus duration and cost.
- **Live log**: streamed terminal output of the current step, with the exact command shown in the header. This is the Claude CLI for agent steps and the pen.dev CLI for design steps.
- **Artifacts**: `spec.md`, the design screens, `plan.md`, `tasks.md`, commits on the branch, and the merge request once it exists. Documents open in a viewer. Screens appear as a row of thumbnails that opens the gallery (06a).
- **Run details**: pipeline, attempt, sandbox image, n8n execution id (deep link), budget used of cap.
**Behavior:** the page is the visual form of the run state machine (§6). When the run finishes, the MR link appears and the ticket closes. When it fails, the failed step is highlighted, the log shows the error, and a **Retry** action creates a new attempt.

### 07 Approval Checkpoint
**Purpose:** let a human decide before the pipeline continues.
- Banner explains which checkpoint this is and that the pipeline is paused.
- Document viewer with tabs for the artifacts produced so far (`spec.md`, `plan.md`), plus **Edit plan** to change the file directly.
- Actions: **Approve & continue**, **Request changes** (with a feedback textarea that is sent back to the previous agent), **Cancel run**.
- Timeline of everything that happened on this run.
**Behavior:** see §7.

### 08 Pipeline Builder
**Purpose:** define the order of steps and where humans intervene.
Vertical flow from **Trigger: ticket created** to **Open merge request → close ticket**. Each node is an agent step (blue), a design step (pink), a checkpoint (amber), or a custom agent (purple). Nodes can be dragged to reorder, and each connector has a + to insert a step.
A step carrying a condition shows a **Conditional** badge and the condition in words, for example "Runs only if the ticket changes the interface".
Right palette: **Human checkpoint**, **Agent step**, **Design step**, **Shell command**, **Notify**, and a list of the workspace's agents to drop in.
Header actions: **Duplicate**, **Test run**, **Save pipeline**. A badge shows how many repos use the pipeline.
**Behavior:** saving increments the pipeline version. Running tickets keep the version they started with. A pipeline must contain a step that produces code; the MR step is implicit and always last. A design step must come after the Spec step, because the condition it depends on is only known once Spec has run.

### 09 Agents
**Purpose:** see every agent and what it is allowed to do.
Card per agent: icon, Default or Custom badge, name, description, model, tools, skills, and usage ("Used in 3 pipelines · 41 runs"). **Edit** opens 10. **New agent** creates a custom one.
The **Design agent** is shown here alongside the others, marked as running on the pen.dev CLI rather than the Claude CLI. Its editor (10) hides the tool toggles, which do not apply, and offers the pen.dev model list instead of the Claude one.

### 10 Agent Editor
**Purpose:** configure one agent.
- **System prompt** editor with template variables `{{ticket.title}}`, `{{ticket.acceptance}}`, `{{repo.branch}}` and others (§8.3).
- **Model & limits**: model select, max cost per run, max time, max turns.
- **Allowed tools** toggles: Read, Edit / Write, Bash, Git push, WebFetch.
- **Skills attached** chips with add and remove.
- Actions: **Reset to default** (only for default agents), **Test in sandbox**, **Save agent**.
**Behavior:** changes apply to new runs only.

### 11 Skills
**Purpose:** manage reusable instruction files.
Left: searchable list of skills with description and how many agents use each. Right: editor with name, description (shown to the agent so it knows when to apply the skill), markdown content, history and delete.
**Behavior:** skills are copied into `.claude/skills/<name>/SKILL.md` for every run of an agent that references them.

### 12 Settings
Sections: Workspace, **Orchestration (n8n)**, **Sandbox (Docker)**, Claude CLI & keys, **Design (pen.dev)**, Cost limits, Members, Notifications.
- **n8n**: base URL, API key, the workflow used for ticket pipelines, the callback webhook URL, connection health and **Test connection**.
- **Docker**: runner image, Docker host, CPU and memory per container, max wall time, parallel containers, network access during Implement, destroy container after MR.
- **pen.dev**: account credential, default design model, export format and scale, default output paths for the `.pen` file and the screens, connection health and **Test connection**. Required only if any pipeline contains a design step.

### 13 System Architecture
Diagram artboard for the team, not an application screen. Shows User → Factory App → n8n → Runner + Docker → Git provider and the eight-step ticket lifecycle.

---

## 5. End-to-end flow of a ticket

```
1. Created      user submits ticket (05)                 status: backlog → queued
2. Queued       app resolves pipeline, POSTs to n8n     run created, attempt 1
3. Spec         agent writes docs/spec.md, decides      running
                whether the ticket changes the UI
4. Design       only if it does: pen.dev CLI writes     running, or skipped
                docs/design/ui.pen and exports screens
5. Checkpoint   optional, anywhere                      waiting_approval
6. Plan → Tasks agents write plan.md, tasks.md          running
7. Implement    code, tests, commits                    running
8. MR opened    branch pushed, MR created               opening_mr
9. Done         ticket closed, MR linked                done
```

### 5.1 Trigger
When a ticket is created (or retried), the app:
1. Loads the pipeline at the pinned version and resolves every agent, skill and limit into one JSON document (the **pipeline snapshot**). Nothing is looked up later.
2. Creates a Run record with `attempt = previous + 1`.
3. Generates the branch name `factory/<ticket-id>-<slug>`.
4. POSTs to the n8n webhook:

```json
{
  "run_id": "142-r1",
  "ticket": { "id": 142, "title": "...", "description": "...", "acceptance_criteria": ["..."] },
  "repo": { "clone_url": "...", "default_branch": "main", "branch": "factory/142-oauth-google",
            "provider": "gitlab", "credential_ref": "cred_8a1" },
  "pipeline": { "id": "p2", "version": 7, "name": "Review-heavy", "steps": [ ... ] },
  "limits": { "max_cost_usd": 5.0, "max_minutes": 45 },
  "callback_url": "https://factory.example/api/hooks/n8n"
}
```

### 5.2 n8n workflow `run-ticket-pipeline`
One generic workflow, never edited per pipeline.

1. **Webhook** node receives the payload above.
2. **HTTP → Runner: create workspace** (`POST /runs/{run_id}/start`). Runner starts the container, clones the repo, creates the branch, writes `.claude/` config. Returns `container_id`.
3. **Loop over `pipeline.steps`** (SplitInBatches or Code node). For each step, first evaluate `step.condition` against the run's accumulated facts. If it is false, post a `step_skipped` callback with the reason and move to the next step without calling the Runner. Otherwise branch on `type`:
   - `agent` → **HTTP → Runner: run step** (`POST /runs/{run_id}/steps/{i}`). Runner executes the Claude CLI (§8.2), streams logs to the app, returns the JSON result. n8n posts the StepResult to the callback.
   - `design` → same Runner endpoint. Runner executes the pen.dev CLI (§8.6), returns the produced `.pen` path, the exported image paths and the cost. n8n posts them as artifacts.
   - `shell` → same Runner endpoint with a command instead of a prompt.
   - `checkpoint` → post `waiting_approval` to the callback with the **Wait node resume URL**, then enter a **Wait** node (webhook resume, optional timeout). See §7.
   - `notify` → Slack / email / HTTP node.
   - After every step: if the result is `failed` or the budget is exceeded, jump to **Fail** (below).

   The only fact conditions read today is `ticket.has_ui`, which the Spec step returns and n8n carries forward for the rest of the loop. A condition on a step reached before Spec has run is an error caught when the pipeline is saved, not at run time.
4. **Verify**: Runner runs the repo's test command once more (from the repo profile or the Implement agent's last command) and pushes the branch.
5. **Open MR**: GitLab or GitHub node creates the MR from `branch` into `default_branch`. Title = ticket title; description = ticket description + acceptance criteria + `spec.md` and `plan.md` collapsed sections + the design screens embedded as images when the ticket had any + link back to the ticket.
6. **Finish**: callback `done` with `merge_request_url`. **HTTP → Runner: destroy** container.
7. **Fail** path: callback `failed` with the step index and error summary, destroy container (or keep it 24 h if the workspace setting says so).

### 5.3 Callbacks (n8n → app)
`POST {callback_url}` with `run_id`, `event` and payload. Events: `started`, `step_started`, `step_finished`, `step_skipped`, `ticket_classified`, `waiting_approval`, `log_chunk`, `mr_opened`, `done`, `failed`, `cancelled`. Every callback carries `step_index` and `attempt` and is idempotent: the app ignores duplicates.

`ticket_classified` carries `{has_ui, rationale}` from the Spec step and is what sets those fields on the ticket. `step_skipped` carries the condition that was false, so the run view can say why a step did not run.

### 5.4 Closing the ticket
On `done`, the app sets `ticket.status = done`, stores `merge_request_url`, records the final cost, and posts to the activity feed. Reviewing and merging the MR happens on the git provider as usual.

---

## 6. Run state machine

```
queued ──► running(step i) ──► running(step i+1) … ──► verifying ──► opening_mr ──► done
             │        ▲
             │        └── approved / edited ────────┐
             ├──► waiting_approval(step i) ─────────┤
             │        └── changes_requested ──► running(step i-1, with feedback)
             │        └── timeout → per step config (auto_continue | fail | wait)
             ├──► failed  (step error, tests failing after retries, budget or time exceeded)
             └──► cancelled (user action at any point)
```

- **Retry** from `failed` or `cancelled` creates a new Run with `attempt + 1`, same pipeline version, fresh container, same branch (force-updated).
- **Pause** stops before the next step starts; the current CLI call finishes.
- A ticket's status mirrors its current run's status.
- A **skipped** step is a terminal state for that step alone. It never fails a run, and the run moves straight to the next step.

---

## 7. Human checkpoints

A checkpoint is a pipeline step of type `checkpoint`. It can appear anywhere, including between any two agent steps and after Implement.

**When reached**
1. n8n posts `waiting_approval` to the app with the resume URL of its Wait node.
2. App sets ticket and run status to `waiting_approval`, notifies the configured approvers, and shows the ticket in the Dashboard approval panel and the Waiting approval board column.

**Reviewer options (screen 07)**
| Action | Effect |
| --- | --- |
| **Approve & continue** | App calls the resume URL with `{decision: "approved"}`. n8n continues with the next step. |
| **Request changes** | App stores the feedback and calls the resume URL with `{decision: "changes_requested", feedback}`. n8n re-runs the previous agent step with the feedback appended to its prompt (and the previous session id if available), then returns to the same checkpoint. |
| **Edit** the artifact | App saves a new artifact version, the Runner writes it into the container, then continues as **approved**. |
| **Cancel run** | Run becomes `cancelled`; container destroyed. |

**Timeout**: per step, `wait_forever` (default), `auto_continue` after N hours, or `fail`.

**Who may approve**: `anyone` in the workspace, `ticket_creator`, or a named list. Approval records who decided and when.

---

## 8. Agent execution

### 8.1 Container preparation (Runner, once per run)
1. `docker run` the runner image with CPU, memory and wall-clock limits from Settings, as a non-root user, workspace mounted at `/work`.
2. Inject `ANTHROPIC_API_KEY`, a git credential for this repo, and a pen.dev credential as environment variables. They are never written to disk in the repo. The pen.dev credential is only injected when the pipeline contains a design step.
3. `git clone --branch <default_branch>` and `git checkout -b factory/<id>-<slug>`.
4. Write ticket context to `/work/.factory/ticket.json`.
5. For every agent in the snapshot, write `/work/.claude/agents/<agent-slug>.md` (system prompt with variables substituted) and every referenced skill to `/work/.claude/skills/<skill>/SKILL.md`.

### 8.2 Running one agent step
```
claude -p "<step prompt>" \
  --output-format json \
  --model <agent.model> \
  --allowedTools "<agent.allowed_tools joined>" \
  --append-system-prompt-file .claude/agents/<agent-slug>.md \
  --max-turns <agent.limits.max_turns>
```
- Working directory is `/work`. The step prompt names the input files to read and the output files to produce.
- `stdout` is streamed to the app as `log_chunk` events for the live log.
- The JSON result provides `session_id`, `total_cost_usd`, `duration_ms`, `num_turns` and the final text. The Runner stores them in the StepResult.
- The Runner checks that every `output_files` entry exists and is non-empty. Missing output = step failed.
- Cost and time are enforced by the Runner: if `total_cost_usd` so far exceeds the agent or run cap, the process is killed and the step fails with reason `budget_exceeded`.

### 8.3 Prompt variables
Available in system prompts and step prompts:
`{{ticket.id}}`, `{{ticket.title}}`, `{{ticket.description}}`, `{{ticket.acceptance}}` (bulleted list), `{{repo.name}}`, `{{repo.branch}}`, `{{repo.default_branch}}`, `{{run.attempt}}`, `{{feedback}}` (present after a changes-requested loop), `{{ticket.has_ui}}` (available after the Spec step), `{{design.screens}}` (list of exported image paths, empty when no design step ran).

### 8.4 Default agents and their contracts
| Agent | Reads | Produces | Model (default) | Tools |
| --- | --- | --- | --- | --- |
| Spec | ticket | `docs/spec.md` and the UI classification (§8.6) | Sonnet 5 | Read, Write |
| Design | spec | `docs/design/ui.pen` and one PNG per screen (§8.6) | Opus 5 via pen.dev | pen.dev CLI |
| Plan | spec, screens if any, repo | `docs/plan.md` — approach, files to change, data changes, risks | Opus 5 | Read, Write, Bash (read-only) |
| Tasks | spec, plan | `docs/tasks.md` — ordered small tasks, each with a verification step | Sonnet 5 | Read, Write |
| Implement | spec, screens if any, plan, tasks | code changes, one commit per task (`feat(#<id>): <task>`), all tests passing | Opus 5 | Read, Edit, Bash, Git push |

Custom agents follow the same contract: declared inputs, declared outputs, model, tools, skills. Example from the design: **Security review** (reads the diff, blocks on high findings) and **Docs writer** (updates README and CHANGELOG).

### 8.5 Shell steps
Run a fixed command in the container (`npm run lint`, `pytest`). Non-zero exit = step failed. Output is logged like an agent step.

### 8.6 The design step

**Deciding whether a ticket has UI work.** The Spec agent makes the call, as the last thing it does. Its instructions require it to end `docs/spec.md` with a machine-readable block:

```
<!-- factory:classification
has_ui: true
rationale: The ticket adds a sign-in button and a callback screen, both visible to end users.
-->
```

The Runner parses that block and returns it in the StepResult. n8n posts it as `ticket_classified` and carries `has_ui` forward for the rest of the loop. If the block is missing or unparseable, `has_ui` defaults to `false` and the run continues, because guessing "yes" would waste a design step on a migration.

A design step whose condition is false is recorded as `skipped` with the reason "ticket has no UI change". It is visible in the run's step tracker, greyed out.

**Running the step.** The Runner invokes the pen.dev CLI, not the Claude CLI:

```
pen --out docs/design/ui.pen \
    --prompt "<design prompt>" \
    --model <agent.model> \
    --repo /work \
    --export docs/design/screens \
    --export-type png \
    --export-scale 2 \
    --usage /tmp/pen-usage.json
```

- On a revision, `--in docs/design/ui.pen` is added so the CLI edits the existing file rather than starting from an empty canvas. This applies to a changes-requested loop from the design review checkpoint and to any retry of a run whose design already exists.
- The design prompt is assembled from the Design agent's system prompt, `docs/spec.md`, the ticket's acceptance criteria, and `{{feedback}}` when returning from a rejected review.
- `stdout` streams to the app as `log_chunk` events, so the live log works the same as for an agent step.
- `--usage` writes cost and token counts as JSON. The Runner reads that file and records the cost in the StepResult, so design spend counts against the same run budget and the same caps as everything else.

**Outputs, both committed.** The step commits two things to the branch:

| Path | Artifact kind | Purpose |
| --- | --- | --- |
| `docs/design/ui.pen` | `design_file` | The editable source. Committed so the design travels with the code, can be opened in pen.dev, reviewed in the merge request, and revised by a later ticket instead of being redrawn. |
| `docs/design/screens/*.png` | `screen` | One exported image per screen. This is what the app displays and what the merge request embeds. |

The Runner fails the step if the `.pen` file is missing or if no image was exported.

**What later steps do with it.** The Plan and Implement agents receive the exported images as part of their context and are instructed to build the interface to match them. The `.pen` file is present in the working tree, so an agent that needs markup rather than a picture can export it through the pen.dev tooling instead of eyeballing the PNG. Nothing forces that path; the images alone are a valid input.

---

## 9. Merge request

- Branch: `factory/<ticket-id>-<slug>`, force-pushed on retries.
- Target: the repository's default branch.
- Title: ticket title. Description: ticket description, acceptance criteria as a checklist, collapsible `spec.md` and `plan.md`, run cost and duration, link to the ticket.
- When the ticket had a design step, the description embeds the exported screens as images directly under the summary, so a reviewer sees the intended interface before reading the diff. The committed `.pen` file is linked below them.
- Labels: `code-factory`, pipeline name, plus `ui` when the ticket was classified as UI work.
- The MR URL is stored on the ticket and shown on 04 and 06. Merging is done by humans on the provider.

---

## 10. Failure handling

| Failure | Behavior |
| --- | --- |
| Agent step produces no output file | Step failed → run failed, ticket `failed`, log kept. |
| Design step produces no `.pen` file or no images | Step failed → run failed. The partial output is kept for inspection. |
| Spec agent omits the classification block | `has_ui` defaults to `false`, design steps skip, run continues. Surfaced as a warning on the run, not a failure. |
| pen.dev credential missing or rejected | Design step fails immediately with a clear message pointing at Settings. Detected at container start when the pipeline contains a design step. |
| Tests fail at Verify | Implement agent is re-invoked with the test output up to 2 times, then run failed. |
| Budget or time cap exceeded | Process killed, run failed with reason shown on 06. |
| Container crash or Runner unreachable | n8n retries the step once with a new container from the last commit on the branch; then failed. |
| Token expired on the repo | Ticket cannot start; repo shows `Token expired` on 02. |
| n8n unreachable when creating a ticket | Ticket stays `queued`; app retries the webhook with backoff and shows a warning on 01. |
| User cancels | Run `cancelled`, container destroyed, branch kept. |

Every failed or cancelled ticket offers **Retry** (new attempt) and **Edit ticket and retry**.

---

## 11. Limits and safety

- **Per run**: cost cap and wall-clock cap from the pipeline or workspace default (design shows $5.00 and 45 min).
- **Per agent step**: cost, minutes, turns from the agent config.
- **Per workspace**: maximum parallel containers (design shows 6). Extra tickets wait in `queued` and show their position.
- **Container**: non-root, CPU and memory limits, network access during Implement configurable, destroyed after MR unless kept for debugging (24 h).
- **Secrets**: git tokens, the Anthropic key and the pen.dev credential are injected as environment variables at container start and never stored in n8n or in the repo workspace. The pen.dev credential is only injected into runs whose pipeline contains a design step.
- **Pinned versions**: runs pin the pipeline version and agent configuration at start, so editing a pipeline or agent never changes a running ticket.

---

## 12. Glossary

| Term | Meaning |
| --- | --- |
| Ticket | A unit of work on one repository, created by a user. |
| Pipeline | Ordered list of steps that turns a ticket into an MR. |
| Step | One item in a pipeline: agent, design, checkpoint, shell or notify. |
| Agent | A configured Claude CLI persona: prompt, model, tools, skills, limits. |
| Design step | A step that runs the pen.dev CLI to produce screens. Conditional on the ticket having UI work. |
| Condition | A rule on a step deciding whether it runs. Today the only one reads `ticket.has_ui`. |
| Skipped | A step whose condition was false. Recorded, never a failure. |
| Skill | A reusable markdown instruction file available to agents. |
| Run | One execution attempt of a pipeline for a ticket. |
| Artifact | Something a step produced: a document, the `.pen` design file, an exported screen image, a commit list, or the MR. |
| Screen | One exported PNG from the design step. The unit the app displays and the merge request embeds. |
| Checkpoint | A step that pauses the run until a human approves. |
| Runner | The service that manages Docker containers and executes steps. |
| Snapshot | The fully resolved pipeline JSON sent to n8n when a run starts. |
