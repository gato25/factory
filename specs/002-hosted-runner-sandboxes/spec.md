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

An administrator sets their workspace's sandbox ceilings — processing power, memory, wall-clock,
and whether a code-writing step may reach the network. A run honours every one of them. The
network restriction covers the steps a model drives and leaves the pipeline author's own commands
alone, and a restricted step can always reach the services it must reach to work at all.

**Why this priority**: the ceilings are a workspace's only control over what a run may consume and
touch, and moving execution to somebody else's infrastructure is exactly when that control must be
shown to still work. This story also corrects a defect: the network restriction is currently
applied for a sandbox's entire life, which prevents every agent step from reaching the model
service, so no run can succeed with the shipped default.

**Independent Test**: set each ceiling to a distinctive value, run a ticket, and confirm from
observable behaviour that each ceiling took effect — a step that exceeds the time ceiling is
stopped and reported as such; a restricted step cannot reach an arbitrary address; an agent step
completes. Delivers the safety guarantee the product already claims.

**Acceptance Scenarios**:

1. **Given** a workspace with a wall-clock ceiling of N minutes, **When** a run's sandbox has
   existed for N minutes, **Then** the sandbox is released whether or not anything asked for it.
2. **Given** a workspace that forbids network reach while code is being written, **When** a step
   whose work a model carries out runs, **Then** the step cannot reach an address outside the
   permitted set, and **Then** the step can still reach the model service.
3. **Given** that same workspace, **When** a step that runs commands a pipeline author wrote runs,
   **Then** that step's network reach is unrestricted.
4. **Given** that same workspace, **When** a design step runs, **Then** it can reach the design
   service.
5. **Given** a workspace whose permitted-host list has never been edited, **When** a code-writing
   step installs a dependency from a package registry in common use, **Then** the install succeeds.
6. **Given** an administrator who has emptied the permitted-host list, **When** a code-writing step
   tries to reach a package registry, **Then** it is refused, and **Then** the failure names the
   address that was refused.
7. **Given** an agent whose time limit is N seconds, **When** the step runs longer than N seconds,
   **Then** the step is stopped and reported as having reached its limit, distinguishably from a
   step that failed on its own.
8. **Given** a step whose command arguments contain text a person typed — a ticket title, reviewer
   feedback, a required document's path — **When** the step executes, **Then** no command runs
   other than the one the step declares, whatever that text contains.
9. **Given** a workspace asking for more memory than the execution host will grant, **When** a run
   starts, **Then** the run fails naming the ceiling that could not be met, rather than starting
   with a lower one.

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
3. **Given** a deployment whose configured execution host is unreachable, **When** an operator
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
- **A workspace asks for a ceiling the execution service will not grant** — more memory, longer
  wall-clock, more processing power than it offers. The run must fail at start naming the ceiling
  that could not be met, rather than starting with a silently lower one.
- **A step needs an address the permitted-host list does not carry** — a private package mirror or
  an internal service, for instance. The step fails, and the failure must name the address that
  could not be reached, so an administrator can add it to the list rather than guess.
- **The application is unreachable when the execution service exchanges credential references.**
  The run fails before any step executes, naming the application as unreachable.
- **A run is in flight when a deployment's execution host changes.** That run must either finish on
  the host it started on or fail saying its sandbox is gone; it must never execute half its steps
  on one host and half on another.
- **Ticket text contains shell syntax.** A ticket titled with quotes, semicolons, backticks or
  substitutions must be carried to the step as text and must not alter what runs.
- **The first run after an idle period.** A cold start must not be reported as a timeout, and must
  not count against the step's own time limit.
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
- **FR-005**: System MUST fail a run at start, naming the ceiling that could not be met, when the
  execution host cannot provide the processing power, memory or lifetime the workspace requires.

#### Continuity of a run across separate requests

- **FR-006**: System MUST address the same sandbox and the same workspace across every request
  belonging to one run, so that a document written by one step is readable by every later step.
- **FR-007**: System MUST refuse a step or push request that names a run with no sandbox, with a
  message saying the run must be started first.
- **FR-008**: System MUST NOT create a second sandbox for a run that already has one, whatever the
  order or overlap of the requests it receives.

#### Limits and reach

- **FR-009**: System MUST apply the workspace's processing-power, memory and wall-clock ceilings to
  each run's sandbox.
- **FR-010**: System MUST release a run's sandbox no later than its wall-clock ceiling, with no
  request required to trigger the release.
- **FR-011**: System MUST apply the workspace's network restriction to every step whose work a model
  carries out, and MUST NOT apply it to a step that runs commands a pipeline author wrote, waits on
  a person, or sends a notification.
- **FR-011a**: System MUST decide which steps the restriction covers from each step's declared type
  alone, so that adding a kind of step does not require the rule to be rewritten.
- **FR-012**: System MUST permit a restricted step to reach the model service, the design service,
  and the run's git provider, and MUST refuse it every address that is none of those and not on the
  workspace's permitted-host list.
- **FR-012a**: Administrators MUST be able to edit the workspace's permitted-host list, and a
  workspace that has never been edited MUST start with a list that lets a step install a dependency
  from the package registries in common use.
- **FR-012b**: System MUST let an administrator reach total isolation by emptying the
  permitted-host list, leaving a restricted step able to reach only the model service and the run's
  git provider.
- **FR-012c**: System MUST resolve the permitted-host list into a run's snapshot when the run
  starts, and MUST NOT consult it again for the life of that run.
- **FR-013**: System MUST name the address that could not be reached when a step fails because the
  restriction refused it, so that an administrator can decide whether to permit it.
- **FR-014**: System MUST stop a step that exceeds its agent's time limit, and MUST report the
  outcome so that reaching a limit is distinguishable from failing on its own.

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
- **FR-024b**: System MUST NOT let a capacity refusal consume a run's place in the workspace's
  concurrency queue.

#### Operability

- **FR-025**: Operators MUST be able to choose which execution host a deployment uses through
  configuration alone, with no code change and no rebuild.
- **FR-026**: System MUST allow its full automated test suite to run with no credentials for, and
  no network access to, any hosted execution service.
- **FR-027**: System MUST stream a step's output as it is produced, whatever the step's total
  output volume.

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
  never consulted again for that run — processing power, memory, wall-clock, network restriction,
  the permitted-host list that restriction reads, and how long a failed run's sandbox is retained.
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

- **The restricted set is an allowlist, not silence.** A code-writing step's work *is* a call to
  the model service, so a sandbox with no network reach cannot run one. FR-012 therefore reads the
  workspace's restriction as "only what the work requires" rather than "nothing". Total isolation
  remains reachable, by emptying the permitted-host list (FR-012b) — it is just not what the
  setting means on its own.
- **"The package registries in common use" is a shipped default, not a fixed set.** What FR-012a
  pre-fills the list with is expected to change as ecosystems do; the list is data an administrator
  edits, so a stale default is a nuisance rather than a defect. The plan chooses the initial
  entries.
- **"A step a model drives" means the agent and design step types.** Those are the two of the five
  declared types whose work is decided in the moment rather than written down in advance, which is
  what the restriction is for. A specification or review step is therefore restricted too — harmless,
  since the model service is always permitted. A verification step is not, which matters because
  such a step commonly installs dependencies.
- **The shipped permitted-host list has to carry the design service.** Restricting design steps
  means a design step reaches its service through the permitted set, so FR-012 names it alongside
  the model service and the git provider rather than leaving it to the editable list.
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
  hosts to be used at once.
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
public internet", and the constitution's Architectural Invariants state that no public-facing
component may create containers. Hosting the execution service contradicts the first statement
literally: it will have a public address. It is held to honour the second, on the reading that the
invariant's subject is the *user-facing* application — the component that serves sessions and
renders pages — and that the execution service remains a separate component serving no user
interface and holding no session. That reading is a judgement, not a restatement, which is why it
is recorded — and it was put to the product owner and accepted (Clarifications, Session
2026-09-11). Two things follow.

First, the constitution's invariant and `contracts/runner.md` MUST be reworded to say that their
subject is the component serving user sessions, not network reachability. Until that amendment
lands, this feature stands in stated violation of both. The amendment is a prerequisite of
planning, not of specifying.

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

Clarification also changed the setting's shape and its scope, and FR-085 needs amending on both
counts. Its shape: FR-085 describes a yes/no — "whether it may reach the network while code is
being written" — and FR-012a makes it a yes/no plus a list of hosts an administrator edits, because
a step that may install a dependency needs somewhere to install it from and a fixed list would
decide that for every workspace. Its scope: "while code is being written" names no step that
exists, since the declared types are agent, design, checkpoint, shell and notify, and nothing
distinguishes the agent step that writes code from the agent step that writes the specification.
FR-011 therefore covers every model-driven step rather than one unnameable one. Until FR-085 is
amended, the two specifications describe the same setting differently.

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
