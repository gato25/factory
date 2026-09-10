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

### Pipeline
| Field | Notes |
| --- | --- |
| `id, workspace_id, name, description` | e.g. "Standard", "Review-heavy", "Quick fix" |
| `version` | incremented on every save; runs pin a version |
| `steps[]` | ordered list of Step |

### Step (embedded in Pipeline)
| Field | Notes |
| --- | --- |
| `type` | `agent` \| `checkpoint` \| `shell` \| `notify` |
| `agent_id` | for `agent` steps |
| `output_files[]` | files the step must produce, e.g. `docs/spec.md` |
| `approvers` | for `checkpoint`: `anyone` \| `ticket_creator` \| list of user ids |
| `timeout_hours, on_timeout` | for `checkpoint`: `wait_forever` \| `auto_continue` \| `fail` |
| `command` | for `shell` steps, e.g. `npm run lint` |
| `channel, template` | for `notify` steps |

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
`run_id, step_index, path (docs/spec.md), content, version`. Also used for commit lists and the MR link.

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
Right panel **What will happen** lists every step of the chosen pipeline with the agent and model, ending in "Open merge request". A tip explains that acceptance criteria are the biggest quality lever.
Footer shows an estimated cost and duration. Actions: **Save as draft**, **Create & start pipeline**.
**Behavior:** on create, the ticket is stored with the pipeline version pinned, status becomes `queued`, and the webhook fires (see §5).

### 06 Ticket Run
**Purpose:** watch one run and understand exactly where it is.
- Header: breadcrumb, title, status badge, branch name, creator, start time, cost so far. Actions: **Pause**, **Cancel run**.
- **Pipeline steps** tracker: Spec, Plan, Tasks, Implement, Merge request. Each shows done (green check), running (blue) or upcoming (grey) with duration and cost.
- **Live log**: streamed terminal output of the current Claude CLI step, with the exact command shown in the header.
- **Artifacts**: `spec.md`, `plan.md`, `tasks.md`, commits on the branch, and the merge request once it exists. Each opens in a viewer.
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
Vertical flow from **Trigger: ticket created** to **Open merge request → close ticket**. Each node is an agent step (blue), a checkpoint (amber), or a custom agent (purple). Nodes can be dragged to reorder, and each connector has a + to insert a step.
Right palette: **Human checkpoint**, **Agent step**, **Shell command**, **Notify**, and a list of the workspace's agents to drop in.
Header actions: **Duplicate**, **Test run**, **Save pipeline**. A badge shows how many repos use the pipeline.
**Behavior:** saving increments the pipeline version. Running tickets keep the version they started with. A pipeline must end with the Implement step or a custom agent that produces code; the MR step is implicit and always last.

### 09 Agents
**Purpose:** see every agent and what it is allowed to do.
Card per agent: icon, Default or Custom badge, name, description, model, tools, skills, and usage ("Used in 3 pipelines · 41 runs"). **Edit** opens 10. **New agent** creates a custom one.

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
Sections: Workspace, **Orchestration (n8n)**, **Sandbox (Docker)**, Claude CLI & keys, Cost limits, Members, Notifications.
- **n8n**: base URL, API key, the workflow used for ticket pipelines, the callback webhook URL, connection health and **Test connection**.
- **Docker**: runner image, Docker host, CPU and memory per container, max wall time, parallel containers, network access during Implement, destroy container after MR.

### 13 System Architecture
Diagram artboard for the team, not an application screen. Shows User → Factory App → n8n → Runner + Docker → Git provider and the eight-step ticket lifecycle.

---

## 5. End-to-end flow of a ticket

```
1. Created      user submits ticket (05)                 status: backlog → queued
2. Queued       app resolves pipeline, POSTs to n8n     run created, attempt 1
3. Spec         agent writes docs/spec.md               running
4. Checkpoint   optional, anywhere                      waiting_approval
5. Plan → Tasks agents write plan.md, tasks.md          running
6. Implement    code, tests, commits                    running
7. MR opened    branch pushed, MR created               opening_mr
8. Done         ticket closed, MR linked                done
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
3. **Loop over `pipeline.steps`** (SplitInBatches or Code node). For each step, branch on `type`:
   - `agent` → **HTTP → Runner: run step** (`POST /runs/{run_id}/steps/{i}`). Runner executes the CLI (§8), streams logs to the app, returns the JSON result. n8n posts the StepResult to the callback.
   - `shell` → same Runner endpoint with a command instead of a prompt.
   - `checkpoint` → post `waiting_approval` to the callback with the **Wait node resume URL**, then enter a **Wait** node (webhook resume, optional timeout). See §7.
   - `notify` → Slack / email / HTTP node.
   - After every step: if the result is `failed` or the budget is exceeded, jump to **Fail** (below).
4. **Verify**: Runner runs the repo's test command once more (from the repo profile or the Implement agent's last command) and pushes the branch.
5. **Open MR**: GitLab or GitHub node creates the MR from `branch` into `default_branch`. Title = ticket title; description = ticket description + acceptance criteria + `spec.md` and `plan.md` collapsed sections + link back to the ticket.
6. **Finish**: callback `done` with `merge_request_url`. **HTTP → Runner: destroy** container.
7. **Fail** path: callback `failed` with the step index and error summary, destroy container (or keep it 24 h if the workspace setting says so).

### 5.3 Callbacks (n8n → app)
`POST {callback_url}` with `run_id`, `event` and payload. Events: `started`, `step_started`, `step_finished`, `waiting_approval`, `log_chunk`, `mr_opened`, `done`, `failed`, `cancelled`. Every callback carries `step_index` and `attempt` and is idempotent: the app ignores duplicates.

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
2. Inject `ANTHROPIC_API_KEY` and a git credential for this repo as environment variables. They are never written to disk in the repo.
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
`{{ticket.id}}`, `{{ticket.title}}`, `{{ticket.description}}`, `{{ticket.acceptance}}` (bulleted list), `{{repo.name}}`, `{{repo.branch}}`, `{{repo.default_branch}}`, `{{run.attempt}}`, `{{feedback}}` (present after a changes-requested loop).

### 8.4 Default agents and their contracts
| Agent | Reads | Produces | Model (default) | Tools |
| --- | --- | --- | --- | --- |
| Spec | ticket | `docs/spec.md` — goal, scope, non-goals, acceptance criteria restated, open questions resolved by stated assumptions | Sonnet 5 | Read, Write |
| Plan | spec, repo | `docs/plan.md` — approach, files to change, data changes, risks | Opus 5 | Read, Write, Bash (read-only) |
| Tasks | spec, plan | `docs/tasks.md` — ordered small tasks, each with a verification step | Sonnet 5 | Read, Write |
| Implement | spec, plan, tasks | code changes, one commit per task (`feat(#<id>): <task>`), all tests passing | Opus 5 | Read, Edit, Bash, Git push |

Custom agents follow the same contract: declared inputs, declared outputs, model, tools, skills. Example from the design: **Security review** (reads the diff, blocks on high findings) and **Docs writer** (updates README and CHANGELOG).

### 8.5 Shell steps
Run a fixed command in the container (`npm run lint`, `pytest`). Non-zero exit = step failed. Output is logged like an agent step.

---

## 9. Merge request

- Branch: `factory/<ticket-id>-<slug>`, force-pushed on retries.
- Target: the repository's default branch.
- Title: ticket title. Description: ticket description, acceptance criteria as a checklist, collapsible `spec.md` and `plan.md`, run cost and duration, link to the ticket.
- Labels: `code-factory`, pipeline name.
- The MR URL is stored on the ticket and shown on 04 and 06. Merging is done by humans on the provider.

---

## 10. Failure handling

| Failure | Behavior |
| --- | --- |
| Agent step produces no output file | Step failed → run failed, ticket `failed`, log kept. |
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
- **Secrets**: git tokens and the Anthropic key are injected as environment variables at container start and never stored in n8n or in the repo workspace.
- **Pinned versions**: runs pin the pipeline version and agent configuration at start, so editing a pipeline or agent never changes a running ticket.

---

## 12. Glossary

| Term | Meaning |
| --- | --- |
| Ticket | A unit of work on one repository, created by a user. |
| Pipeline | Ordered list of steps that turns a ticket into an MR. |
| Step | One item in a pipeline: agent, checkpoint, shell or notify. |
| Agent | A configured Claude CLI persona: prompt, model, tools, skills, limits. |
| Skill | A reusable markdown instruction file available to agents. |
| Run | One execution attempt of a pipeline for a ticket. |
| Artifact | A file produced by a step (`spec.md`, `plan.md`, `tasks.md`), a commit list, or the MR. |
| Checkpoint | A step that pauses the run until a human approves. |
| Runner | The service that manages Docker containers and executes steps. |
| Snapshot | The fully resolved pipeline JSON sent to n8n when a run starts. |
