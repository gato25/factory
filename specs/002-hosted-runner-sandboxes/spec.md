> **Retired.** The hosted execution path this specification describes was built, deployed once,
> and then removed from the codebase at the owner's request: the project runs on a Docker daemon
> the team administers, and a second execution host it does not use was cost without benefit. The
> code is in git history under the commit that removed it. This directory is kept because several
> things here were *measured* rather than assumed — the provider's 3 GiB-per-vCPU floor, its 2×
> memory cap on disk, that per-host egress filtering was not available — and anyone revisiting a
> managed sandbox service should start from those findings rather than rediscover them.

# Feature Specification: Hosted Runner Sandboxes

**Feature Branch**: `claude/spectkit-specify-cu28jm`

**Created**: 2026-09-11

**Status**: Draft

**Input**: User description: "first create spec" — for the change decided in conversation: stop
executing runs on a container daemon the team operates, and execute them on a managed sandbox
service instead, with the run execution service itself hosted rather than run on a local machine.

## Clarifications

### Session 2026-09-11

- Q: Should the service that creates and runs sandboxes be allowed to sit at an address anyone on
  the internet can reach, with a credential on every request as its only gate? → A: Yes — public
  address, credential on every request, and the constitution's invariant reworded to say its
  subject is the component serving user sessions rather than network reachability. A network-level
  gate in front was considered and rejected as more setup than the risk warrants at this scale.
- Q: When the hosting provider has no room to start another sandbox, should the run wait in line or
  fail? → A: Neither as originally framed — retry the start over a bounded period (about 30
  seconds), then fail naming capacity. A provider's capacity refusal is transient and is a
  different thing from the workspace's own concurrency ceiling, which keeps its queue.
- Q: When a step runs under the "no network while writing code" setting, what should it still be
  allowed to reach? → A: The model service and the run's git provider always, plus a permitted-host
  list the administrator can edit, shipped pre-filled with the package registries in common use so
  a dependency install works untouched. Emptying the list is how an administrator gets total
  isolation.
- Q: Which steps should the network restriction actually apply to, given that no step type is named
  "implement"? → A: Every step whose work a model carries out — the agent and design types. Steps
  that run commands a pipeline author wrote, wait on a person, or send a notification stay
  unrestricted, because what they run was written and reviewed rather than decided in the moment.
  The rule reads a step's declared type, so a new kind of step does not require rewriting it.
- Q: Should the product show what sandboxes are costing, or is that read on the execution host's
  own dashboard? → A: Read it on the host's dashboard. The product surfaces no sandbox cost or
  duration figure, so SC-004 and SC-005 are verified there rather than in the product, and the
  wall-clock ceiling becomes the only in-product guard against a runaway.
- Q: T006 measured that the intended execution host cannot filter a sandbox's traffic by host in
  either direction, so per-step network restriction is not buildable. Rewrite the setting, simulate
  it with a proxy, or change host? → A: **Rewrite it, honestly.** Network reach becomes
  all-or-nothing, and a host that cannot enforce the restriction must present the setting as
  unavailable rather than accept a value it will ignore (FR-011a, FR-012). Routing the sandbox
  through a proxy was rejected: an agent step runs arbitrary code by design, arbitrary code can
  ignore a proxy variable, and a control that stops accidents while appearing to stop attacks is
  worse than none. FR-012a, FR-012b and FR-012c are withdrawn.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Run a ticket without operating a container host (Priority: P1)

An operator installs the product and starts a ticket. The steps execute, the live log streams, the
branch is pushed and a merge request opens — and at no point did the operator install, configure,
patch, or watch a container daemon. Nothing about the machine that serves the application
determines whether a run can execute.

**Why this priority**: this is the whole point of the change. Today the product only works where
somebody keeps a container daemon healthy on a machine they own. That single dependency is what
stops the product being deployed anywhere ordinary, and removing it is the value. Every other story
here is a property of this one done properly.

**Independent Test**: deploy the application and the execution service to a clean environment with
no container daemon present or reachable, start a ticket against a real repository, and confirm the
run reaches a merge request. Delivers a usable product on infrastructure nobody has to administer.

**Acceptance Scenarios**:

1. **Given** an environment with no container daemon installed, **When** a user starts a ticket,
   **Then** the run's steps execute and the run reaches its terminal state.
2. **Given** a run whose first step wrote a document into the workspace, **When** a later step
   executes, **Then** that step reads the document the earlier step wrote.
3. **Given** a run executing a step, **When** a user views the ticket, **Then** the step's output
   appears as it is produced rather than only when the step ends.
4. **Given** an execution service that cannot reach the application, **When** a run starts,
   **Then** the run fails with a message naming which component could not be reached, not a generic
   error.
5. **Given** an execution service deployed at an address anyone can reach, **When** a request
   arrives without a valid credential, **Then** it is refused, and no sandbox is created,
   inspected, used or released.
6. **Given** two such refused requests, one naming a run that exists and one naming a run that does
   not, **Then** the two refusals are indistinguishable.
7. **Given** runs executing, **When** an operator replaces the credential that authenticates
   requests to the execution service, **Then** those runs continue to completion, and **Then** the
   replaced credential is refused once the replacement is in effect.
8. **Given** an execution host that refuses a sandbox for capacity and then frees one, **When** a
   run starts, **Then** the run obtains a sandbox without anybody retrying by hand and without the
   member being shown a failure.

---

### User Story 2 - Sandbox limits hold, and an agent can still do its job (Priority: P2)

An administrator sets their workspace's sandbox ceilings — processing power, memory, wall-clock —
and a run honours every one of them. Where the configured execution host cannot enforce a limit,
the administrator is told so rather than left with a setting that does nothing.

**Why this priority**: the ceilings are a workspace's only control over what a run may consume, and
moving execution to somebody else's infrastructure is exactly when that control must be shown to
still work. This story also carries a correction: the network restriction was specified as
per-step, and the execution host measured in T006 cannot filter a sandbox's traffic by host at all
(research D7). A setting that appears to constrain and does not is worse than one that says it
cannot, which is why FR-011a and FR-012 exist.

**Independent Test**: set each ceiling to a distinctive value, run a ticket, and confirm from
observable behaviour that each ceiling took effect — a step that exceeds the time ceiling is
stopped and reported as such; a sandbox is never larger than the ceilings allow; an agent step
completes. Then confirm the network setting is shown as unavailable on a host that cannot enforce
it. Delivers the safety guarantee the product can actually keep.

**Acceptance Scenarios**:

1. **Given** a workspace with a wall-clock ceiling of N minutes, **When** a run's sandbox has
   existed for N minutes, **Then** the sandbox is released whether or not anything asked for it.
2. **Given** a run on an execution host with no per-host filtering, **When** an administrator opens
   the sandbox settings, **Then** the network restriction is shown as unavailable and names the host
   as the reason.
3. **Given** that same host, **When** a run executes, **Then** every step has the same network
   reach, and an agent step reaches the model service.
4. **Given** an agent whose time limit is N seconds, **When** the step runs longer than N seconds,
   **Then** the step is stopped and reported as having reached its limit, distinguishably from a
   step that failed on its own.
5. **Given** a step whose command arguments contain text a person typed — a ticket title, reviewer
   feedback, a required document's path — **When** the step executes, **Then** no command runs
   other than the one the step declares, whatever that text contains.
6. **Given** a workspace whose memory ceiling is lower than the smallest allocation the execution
   host offers, **When** a run starts, **Then** the run fails naming that ceiling, rather than
   starting with an allocation above it.
7. **Given** a workspace whose ceilings sit between two allocations the host offers, **When** a run
   starts, **Then** its sandbox gets the larger allocation that still fits within the ceilings, and
   never the smaller allocation above them.
8. **Given** a sandbox that takes several seconds to become ready, **When** a step with a short
   time limit runs, **Then** the readying time is not charged to that limit and the step is not
   reported as having timed out.
9. **Given** a step that fails because an address was unreachable, **When** the failure is shown,
   **Then** it names the address.

---

### User Story 3 - A finished run stops costing money (Priority: P3)

A run ends — successfully, by failing, or by being abandoned when nothing calls back. Its sandbox
stops consuming paid capacity promptly, and an administrator who asked to keep failed sandboxes for
inspection gets exactly the window they asked for and no more.

**Why this priority**: sandbox capacity on a managed service is billed by the second, and a run
that leaks its sandbox turns a per-run cost into a standing one. The people paying for sandbox
capacity and the people paying for model usage are not the same, so a leak is invisible to whoever
would notice it first.

**Independent Test**: start runs that end each of the three ways, and confirm for each that the
sandbox is no longer consuming capacity within the expected window. Delivers a predictable bill.

**Acceptance Scenarios**:

1. **Given** a run that completed, **When** the run reaches its terminal state, **Then** its
   sandbox is released and consumes no further capacity.
2. **Given** a workspace that retains failed sandboxes for H hours, **When** a run fails,
   **Then** its sandbox remains inspectable for H hours and is released after.
3. **Given** a run whose caller stopped making requests without ever ending the run, **When** the
   run's wall-clock ceiling passes, **Then** the sandbox is released without anybody intervening.
4. **Given** no run is executing, **When** an hour passes, **Then** no sandbox capacity is billed.

---

### User Story 4 - The product is still developable and testable without the hosted service (Priority: P4)

A contributor clones the repository and runs the test suite. It passes, with no account on any
hosted execution service and no outbound network access to one. An operator who needs to move
execution back to a locally administered host can do so by changing configuration, not code.

**Why this priority**: last, because it protects the change rather than delivering it — but the
change is not safely finishable without it. A migration that cannot be reversed by configuration
is a one-way door, and a test suite that needs an account is a test suite that stops being run.

**Independent Test**: run the full automated suite on a machine with no credentials for any hosted
execution service, and confirm it passes. Separately, switch a deployment's configured execution
host and confirm runs execute on the other one with no code change.

**Acceptance Scenarios**:

1. **Given** a checkout with no hosted-service credentials, **When** the test suite runs,
   **Then** it completes without contacting any hosted execution service.
2. **Given** a deployment configured to use one execution host, **When** an operator changes that
   configuration to the other and restarts, **Then** subsequent runs execute on the other host and
   no code changed.
3. **Given** a run that started on one execution host, **When** the configured host changes while
   that run is in flight, **Then** a further request for that run is refused rather than executed
   on the new host.
4. **Given** a deployment whose configured execution host is unreachable, **When** an operator
   checks readiness, **Then** the readiness answer says the execution host is unreachable, and is
   distinguishable both from the service being down and from the credential being wrong.

---

### Edge Cases

- **The execution service has no capacity.** A refusal is usually transient and clears in seconds,
  so the start must be retried for a bounded period before it counts as a failure. A run that still
  cannot get a sandbox fails naming capacity, and must not be reported as a step that failed on its
  merits. This is distinct from the workspace's own concurrency ceiling, which holds runs in a
  queue showing each author their position (`specs/001-code-factory-mvp` FR-082) — a provider's
  transient refusal must not consume a place in that queue.
- **The first minutes after a new deployment.** A newly deployed execution service may refuse
  sandbox starts while the provider readies capacity, for longer than the bounded retry allows.
  This must be legible as a deployment that is not ready yet, not as a run that failed.
- **A sandbox disappears between two steps.** The run must recognise the loss as a loss of the
  sandbox rather than as a failing step, and the workspace's contents must be reconstructable, or
  the run must fail saying the workspace was lost.
- **Two requests arrive for the same run at once.** They must address the same sandbox and the same
  workspace; neither may create a second one.
- **A workspace's ceiling is below everything the execution service offers** — a memory ceiling
  under the smallest allocation, for instance. The run must fail at start naming that ceiling,
  rather than starting with an allocation above it. A ceiling *above* everything offered is not an
  error: the run gets the largest allocation and stays under its ceiling.
- **A step cannot reach an address it needs** — a private package mirror, an internal service, a
  registry that is down. The step fails, and the failure must name the address (FR-013), so an
  unreachable dependency is not mistaken for the work itself failing. On a host with no per-host
  filtering there is no list to add it to; the answer is network-level, outside this product.
- **The application is unreachable when the execution service exchanges credential references.**
  The run fails before any step executes, naming the application as unreachable.
- **A run is in flight when a deployment's execution host changes.** That run must either finish on
  the host it started on or fail saying its sandbox is gone; it must never execute half its steps
  on one host and half on another (FR-025a). Nothing about switching hosts by configuration
  prevents this on its own, which is why the run records the host it started on.
- **Ticket text contains shell syntax.** A ticket titled with quotes, semicolons, backticks or
  substitutions must be carried to the step as text and must not alter what runs.
- **The first run after an idle period.** A cold start must not be reported as a timeout, and must
  not count against the step's own time limit — the limit begins when the step's command begins
  (FR-014a). A step with a short limit is the case that exposes this.
- **A step produces more output than one response can carry.** The output must still stream and the
  step must still report its outcome.

## Requirements *(mandatory)*

### Functional Requirements

#### Where runs execute

- **FR-001**: System MUST execute a run's steps without requiring a container host installed,
  administered, or reachable on any machine the operating team maintains.
- **FR-002**: System MUST create one fresh sandbox per run, MUST NOT reuse a sandbox between runs,
  and MUST release it when the run ends.
- **FR-003**: System MUST execute every step as a non-privileged user inside the sandbox.
- **FR-004**: System MUST pin the sandbox image a run uses when the run starts, and MUST NOT change
  it for the life of that run.
- **FR-005**: System MUST fail a run at start, naming the ceiling it could not respect, when no
  allocation the execution host offers fits within the workspace's processing-power or memory
  ceiling, or when the host cannot enforce the workspace's wall-clock ceiling.

#### Continuity of a run across separate requests

- **FR-006**: System MUST address the same sandbox and the same workspace across every request
  belonging to one run, so that a document written by one step is readable by every later step.
- **FR-007**: System MUST refuse a step or push request that names a run with no sandbox, with a
  message saying the run must be started first.
- **FR-008**: System MUST NOT create a second sandbox for a run that already has one, whatever the
  order or overlap of the requests it receives.

#### Limits and reach

- **FR-009**: System MUST NOT give a run's sandbox more processing power or memory than the
  workspace's ceilings allow, and MUST give it the largest allocation the execution host offers
  within them. A ceiling is an upper bound on what a run may consume, never a minimum to be rounded
  up to.
- **FR-009a**: System MUST enforce the workspace's wall-clock ceiling exactly, not to the nearest
  allocation the host offers.
- **FR-010**: System MUST release a run's sandbox no later than its wall-clock ceiling, with no
  request required to trigger the release.
- **FR-011**: System MUST give a run's sandbox network reach for the whole of its life. A
  model-driven step is itself a call to the model service, so a sandbox with no reach cannot run
  one, and reach cannot be varied between steps of a run.
- **FR-011a**: System MUST NOT offer a network restriction it cannot enforce. Where the configured
  execution host provides no per-host filtering, the workspace's network setting MUST be presented
  as unavailable, naming the host as the reason, rather than accepted and silently ignored.
- **FR-012**: System MUST tell an administrator, where sandbox limits are configured, which of
  those limits the configured execution host enforces and which it cannot — so that a setting which
  does nothing is visible as such before a run depends on it.
- **FR-013**: System MUST name the address a step could not reach when the step fails on a network
  error, so that an unreachable dependency is distinguishable from a failure of the work itself.
- **FR-014**: System MUST stop a step that exceeds its agent's time limit, and MUST report the
  outcome so that reaching a limit is distinguishable from failing on its own.
- **FR-014a**: System MUST begin a step's time limit when the step's command begins, not when the
  sandbox is asked for, so that time spent readying a sandbox is never charged to the step's limit
  and is never reported as the step having timed out.

#### Safety of what a run is told to do

- **FR-015**: System MUST treat every piece of person-authored text that reaches a step's command —
  a ticket's reference, title and description, a reviewer's feedback, a step's required document
  paths — as text, such that no command runs other than the one the step declares.
- **FR-016**: System MUST supply credentials to a sandbox as environment, MUST NOT write them into
  the run's workspace, and MUST NOT retain them after the run.
- **FR-017**: System MUST remove credentials from a step's output where the output is taken in,
  before it is stored or streamed.

#### Reaching the execution service

- **FR-018**: System MUST authenticate every operation that creates, inspects, uses or releases a
  sandbox, and MUST refuse an unauthenticated or wrongly-credentialed request without creating,
  inspecting or releasing anything.
- **FR-018a**: Operators MUST be able to replace the credential that authenticates execution-service
  operations without interrupting runs already executing, and the replaced credential MUST be
  refused once its replacement is in effect.
- **FR-019**: System MUST NOT reveal, in a refused request's answer, whether the named run exists.
- **FR-020**: System MUST answer a readiness check with whether the execution host is reachable,
  such that an unreachable host, an unreachable service, and a rejected credential are three
  distinguishable answers.
- **FR-021**: System MUST fail a run with a message naming the application as unreachable when the
  execution service cannot reach it to exchange the run's credential references for values.

#### Cost and release

- **FR-022**: System MUST stop a released sandbox consuming paid capacity, and MUST consume no
  sandbox capacity at all while no run is executing.
- **FR-023**: System MUST keep a failed run's sandbox inspectable for exactly the window the
  workspace configured, and MUST release it once that window passes.
- **FR-024**: System MUST retry a sandbox start refused for capacity, over a bounded period, before
  treating the refusal as a failure.
- **FR-024a**: System MUST report a run that still could not obtain a sandbox once that period
  passes as having failed to obtain one, naming capacity as the reason, distinguishably from a step
  that failed on its merits.
- **FR-024b**: System MUST release a run's place against the workspace's concurrency limit as soon
  as the run fails for capacity, so that a queued run advances immediately rather than waiting for
  anything to time out.

#### Operability

- **FR-025**: Operators MUST be able to choose which execution host a deployment uses through
  configuration alone, with no code change and no rebuild.
- **FR-025a**: System MUST execute every step of a run on the execution host that run started on,
  and MUST refuse a request for a run whose recorded host is not the one now configured rather than
  executing part of that run somewhere else.
- **FR-026**: System MUST allow its full automated test suite to run with no credentials for, and
  no network access to, any hosted execution service.
- **FR-027**: System MUST stream a step's output as it is produced, whatever the step's total
  output volume.

### Withdrawn requirements

Recorded rather than deleted, because a plan, a task list and a contract all cited them, and a
reader finding the citation deserves to know what happened.

| Identifier | Was | Withdrawn because |
|---|---|---|
| FR-012a | An administrator-editable permitted-host list, pre-filled with the package registries in common use | T006 measured that the intended execution host cannot filter a sandbox's traffic by host, so there is no list for an administrator to edit |
| FR-012b | Emptying that list as the route to total isolation | Same — turning the network off blocks the model service too, so total isolation cannot run an agent step |
| FR-012c | Pinning the list into the run's snapshot | Nothing to pin |

FR-011, FR-011a, FR-012 and FR-013 are their replacements, and they describe behaviour this host can
actually keep.

### Key Entities

- **Execution service**: the component that creates sandboxes and executes steps inside them —
  the component `specs/001-code-factory-mvp` calls the Runner. It serves no user interface, holds
  no user session, and is the only component with rights on an execution host. It is reachable at
  a public address and admits nothing without a valid credential.
- **Sandbox**: the isolated workspace one run executes in. Has an identity the run can address
  across separate requests, ceilings on processing power, memory and lifetime, a permitted set of
  addresses that varies by step, and a lifetime that ends when the run ends or its ceiling passes.
- **Run execution record**: what the execution service holds for a live run — which sandbox belongs
  to it, the pinned snapshot it was started with, and the credential values it resolved. Exists
  from the moment a run starts until its sandbox is released, and must be reachable by every
  request belonging to that run.
- **Sandbox limits**: the workspace's ceilings, resolved into the run's snapshot when it starts and
  never consulted again for that run — processing power, memory, wall-clock, whether the network
  restriction was requested at all, and how long a failed run's sandbox is retained. Whether the
  restriction can be *enforced* is a property of the configured execution host, not of the run, so
  it is not pinned (FR-011a).
- **Execution host**: the named place sandboxes are created. A deployment uses exactly one at a
  time, chosen by configuration.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An operator reaches a completed run from a clean checkout with zero steps that
  install, configure or administer a container host.
- **SC-002**: 100% of runs execute in a sandbox no earlier run used.
- **SC-003**: 100% of ended runs — completed, failed past their retention window, or abandoned —
  hold no sandbox capacity 2 minutes later.
- **SC-004**: Sandbox capacity billed for a completed run at the default ceilings stays under
  $0.05, and under $0.10 at the 95th percentile — read from the execution host's own usage
  reporting, since the product does not surface this figure.
- **SC-005**: No sandbox capacity is billed during any hour in which no run executed, read from the
  same reporting.
- **SC-006**: A run's first step produces its first line of output within 60 seconds of the run
  starting, at the 95th percentile, including runs that follow an idle period.
- **SC-007**: 0 of a corpus of adversarial ticket titles, reviewer feedback and document paths
  cause any command to run other than the one the step declared.
- **SC-008**: 100% of abandoned runs release their sandbox no later than their configured
  wall-clock ceiling.
- **SC-009**: The full automated test suite passes with outbound network access to hosted execution
  services blocked.
- **SC-010**: Moving a deployment back to a locally administered execution host takes one
  configuration change and no code change.
- **SC-011**: Every requirement this specification carries that restates a guarantee from
  `specs/001-code-factory-mvp` produces the same observable behaviour on the new execution host as
  on the old one, demonstrated by the existing tests for those guarantees passing unchanged.
- **SC-012**: Replacing the execution service's credential takes effect within 5 minutes and
  interrupts 0 runs already executing.
- **SC-013**: 0 runs are failed for capacity without the bounded retry having been exhausted first,
  and a capacity refusal that clears within that period costs the member nothing but latency.

## Assumptions

- **Network reach is all-or-nothing on the intended host, and the setting says so.** A
  code-writing step's work *is* a call to the model service, so a sandbox with no reach cannot run
  one — and T006 measured that the intended host cannot filter a sandbox's traffic by host in
  either direction. So there is no permitted set to configure. FR-011a and FR-012 make the setting
  report itself unavailable rather than accept a value it will ignore.
- **What actually protects a run, now that reach does not.** The sandbox is fresh per run, released
  when the run ends and never reused (FR-002); work runs unprivileged (FR-003); it holds only that
  run's credentials and they never touch the workspace (FR-016); and output is redacted where it is
  taken in (FR-017). None of those depend on egress filtering. It is worth stating plainly that the
  network restriction was never the load-bearing control, because losing it reads worse than it is.
- **A host with per-host filtering would change this.** FR-011a is written about "the configured
  execution host" rather than about this one, so a host that can filter would simply report the
  setting as available. Nothing in this feature forecloses that.
- **The hosted path becomes the default for deployed environments**, and the locally administered
  path is retained for development and for the automated suite. Both are expected to remain
  supported; neither is expected to be deleted by this feature.
- **The application is reachable from the execution service.** The execution service exchanges
  credential references and posts callbacks over the network to the application. Today both run on
  one machine; once the execution service is hosted, the application must be reachable from
  outside, which is a deployment prerequisite this feature assumes rather than delivers.
- **Cost figures in SC-004 assume the default ceilings** in the workspace settings and a run of
  roughly a dozen minutes. They are a budget to design against, not a measurement.
- **Sandbox cost and duration are not surfaced anywhere in the product.** The run record keeps
  showing model cost, as it does today; sandbox spend is read on the execution host's own
  dashboard. Adding it later needs no rework, because the underlying fact is how long a sandbox
  lived at what size.
- **Whoever pays for sandbox capacity is not whoever pays for model usage.** Model usage is a
  company cost; sandbox capacity is an individual one. This is why cost has its own user story and
  its own success criteria rather than being folded into operability.
- **One execution host per deployment.** Nothing here asks for a run to choose its host, or for two
  hosts to be used at once. FR-025a is about a run that outlives a change of that setting, not about
  choosing.
- **Processing power and memory come in fixed allocations, so a ceiling is honoured by staying
  under it.** An execution host may offer a handful of sizes rather than an arbitrary figure, so a
  workspace's ceiling usually lands between two of them. FR-009 resolves that downwards — the
  largest allocation that still fits — because a ceiling an administrator set is an upper bound on
  what a run may consume, and quietly exceeding it would invert the setting's meaning. The cost is
  that a workspace can get less than it asked for; that is visible in what the run records, and it
  is the safe direction to be wrong in. Wall-clock is not quantised and is enforced exactly
  (FR-009a).
- **The bounded retry in FR-024 is about 30 seconds**, on the evidence that a capacity refusal on
  the intended provider clears in seconds rather than minutes. The figure is a starting point for
  the plan to tune against real behaviour, not a measured one.
- **The provider's concurrency ceiling is far above the workspace's.** The intended provider allows
  on the order of hundreds of concurrent sandboxes at this feature's default ceilings, so the
  workspace's own concurrency limit — not the provider — is expected to be the binding constraint,
  and the queue in `specs/001-code-factory-mvp` FR-082 keeps its existing meaning. The plan should
  confirm the provider's current figures rather than inherit this assumption.

## Dependencies

- A managed sandbox service that can start an isolated environment from a pinned image, run
  commands in it, read and write files in it, survive between separate requests belonging to one
  run, and release it. The intended service is Cloudflare's sandbox offering, reached from a
  Cloudflare Worker; the execution service itself is expected to be deployed as that Worker.
- A registry holding the pinned sandbox image, in a form the managed sandbox service accepts.
- The existing application, unchanged in its contract with the execution service: the four
  operations in `specs/001-code-factory-mvp/contracts/runner.md`, the credential-exchange endpoint,
  and the callback endpoint.
- The model service and the two supported git providers, reachable from a sandbox.

## Divergence and Accepted Risk

Constitution Principle I requires divergence from source material to be recorded here rather than
left silent, and the Development Workflow section requires an understood-but-accepted risk to be
recorded where the decision lives. Four are recorded.

**1. The execution service becomes reachable from the public internet.**
`specs/001-code-factory-mvp/contracts/runner.md` states the Runner "is never reachable from the
public internet", and the constitution's Principle V stated, at the time this specification was
written, that no public-facing component may create containers. Hosting the execution service
contradicts the first statement literally: it will have a public address. It was held to honour the
second, on the reading that the principle's subject is the *user-facing* application — the
component that serves sessions and renders pages — and that the execution service remains a
separate component serving no user interface and holding no session. That reading was a judgement,
not a restatement, which is why it is recorded — and it was put to the product owner and accepted
(Clarifications, Session 2026-09-11). Two things followed.

First, the constitution and `contracts/runner.md` had to be reworded to say that their subject is
the component serving user sessions, not network reachability. **The constitution was amended on
2026-09-11 (version 2.0.0)**, and Principle V now permits a component holding execution rights to
be reachable at a public address provided it serves no user interface, holds no session,
authenticates every operation, and reveals nothing on refusal. `contracts/runner.md` is still
unamended, so this feature remains in stated conflict with that document alone.

Second, the accepted risk is now explicit rather than implied: the credential on each request is
the only thing between an outsider and a sandbox, so a leaked credential grants arbitrary code
execution billed to whoever pays for sandbox capacity. FR-018, FR-018a and FR-019 are the
compensating requirements — every operation authenticated, the credential replaceable without
stopping work, and a refused request revealing nothing about what exists. A network-level gate in
front of the service was considered and rejected as more setup than the risk warrants at this
scale; it remains the upgrade path if a credential is ever exposed.

**2. This feature corrects shipped behaviour, not only its location.** The network restriction is
currently applied to a run's sandbox for its whole life rather than to the step the setting names.
With the shipped default, which forbids reach while code is written, an agent step cannot reach the
model service and the run cannot succeed. FR-011 and FR-012 change that behaviour rather than
porting it. This is a correction of a defect against `specs/001-code-factory-mvp` FR-085, and is
recorded as drift under Principle I rather than folded silently into the move.

Clarification changed the setting's scope, and measurement then removed its substance. FR-085 needs
amending on both counts.

Its scope: "while code is being written" names no step that exists, since the declared types are
agent, design, checkpoint, shell and notify, and nothing distinguishes the agent step that writes
code from the agent step that writes the specification.

Its substance: T006 measured that the intended execution host cannot filter a sandbox's traffic by
host at all. A deny list did not deny; an allow list did not allow; `enableInternet: false` blocked
everything including the permitted host. The lists govern traffic routed through the SDK's proxy,
not sockets a process inside the sandbox opens for itself — and an agent step runs arbitrary code,
which opens its own sockets. So FR-085's restriction cannot be honoured here in any form.

The product owner chose to say so rather than to simulate it (Clarifications, Session 2026-09-11).
FR-011a and FR-012 therefore require the setting to present itself as unavailable, naming the host.
The rejected alternative was routing the sandbox's traffic through a proxy so an allowlist could
apply: it was rejected because an agent step executes arbitrary code by design, arbitrary code can
ignore a proxy environment variable, and a control that stops only accidents while appearing to
stop attacks is worse than none.

**3. Argument handling changes shape, and the new shape is the riskier one.** The current execution
host passes a step's arguments as a list, which no shell interprets. A managed sandbox service is
expected to take a command line instead, which a shell does interpret — and the arguments contain
ticket titles, reviewer feedback and document paths that people type. FR-015 and SC-007 exist
because this change introduces a class of defect that could not previously occur, and they should
be treated as blocking rather than as hardening.

**4. A sandbox that overruns its cost is invisible until the bill.** Clarification settled that the
product surfaces no sandbox cost or duration, so nothing inside it can show a run consuming more
than it should while it is happening. That leaves the wall-clock ceiling (FR-010) and the retention
window (FR-023) as the only in-product guards against runaway spend, which makes both more
load-bearing than they read. FR-010 in particular must be enforced by the execution host itself
rather than by something calling in to release the sandbox, because the case it guards against is
exactly the one where nothing calls in. The risk accepted is bounded: the ceiling caps a single
run's exposure, and what the decision gives up is noticing a pattern of expensive runs early.
