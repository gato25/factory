# Feature Specification: Code Factory MVP

**Feature Branch**: `claude/spectkit-specify-cu28jm`

**Feature Directory**: `specs/001-code-factory-mvp`

**Created**: 2026-09-10

**Status**: Draft

**Input**: `/speckit-specify` was invoked with no arguments. Source material taken from the
repository-root product specification `spec.md` ("Code Factory — Product Specification", v0.1)
and the design file `design.pen` (artboards 00–14). Scope was confirmed with the user as
**the whole product as one MVP feature**; the planning phase is expected to slice it into phases.
Revised against the source material as of `main`, which added a conditional design stage: interface
work is designed and reviewed before any code is planned or written.

## User Scenarios & Testing *(mandatory)*

Code Factory turns a written ticket into a reviewable merge request. A user connects a git
repository, describes a change, and a chain of AI agents produces a specification, a plan, a task
list, and finally the code — pushing a branch and opening a merge request. Humans can insert
review gates anywhere in that chain.

The stories below are ordered by value. Story 1 alone is a shippable product; each later story
adds a distinct layer of control, visibility, or configurability on top of it.

### User Story 1 - From ticket to merge request (Priority: P1)

A developer signs in, connects a git repository, and writes a ticket: a title, a description of
the change they want, and a short list of acceptance criteria. They choose the default pipeline
and start it. Without further involvement, the system works through the change and, some minutes
later, tells them a merge request is open on their repository. They open the merge request on
GitLab or GitHub, read the diff, and merge it themselves.

**Why this priority**: This is the entire value proposition. Every other story exists to make this
one trustworthy, observable, or adjustable. If only this story shipped, a team could already
convert small, well-described tickets into reviewable code without writing it by hand.

**Independent Test**: Connect a real repository containing a test suite, add a shell step running
that suite after the implementing step, create a ticket for a small self-contained change with two
acceptance criteria, start the pipeline, and verify that a merge request appears on the provider
with a branch whose commits satisfy the acceptance criteria and leave the suite passing.

**Acceptance Scenarios**:

1. **Given** a signed-in user with no connected repositories, **When** they supply a repository
   URL and an access token with the required permissions, **Then** the system verifies it can
   read the repository, create branches, and open merge requests before saving the connection.
2. **Given** an access token missing a required permission, **When** the user attempts to connect,
   **Then** the connection is refused and the specific missing permission is named.
3. **Given** a connected repository, **When** the user submits a ticket with a title and
   acceptance criteria and starts the pipeline, **Then** the ticket is queued, a run is created,
   and the pipeline in use is recorded so later edits to it cannot affect this run.
4. **Given** a queued ticket, **When** the pipeline runs to completion, **Then** a branch named
   after the ticket exists on the repository, a merge request targeting the default branch is
   open, the merge request address is stored on the ticket, and the ticket is marked done.
5. **Given** a completed run, **When** the user opens the merge request, **Then** its description
   contains the ticket description, the acceptance criteria as a checklist, the specification and
   plan the agents produced, and a link back to the ticket.
6. **Given** a pipeline step that was required to produce a document, **When** that document is
   missing or empty, **Then** the step fails, the run fails, and no merge request is opened.

---

### User Story 2 - Watching a run and knowing where it is (Priority: P2)

While a ticket is running, its author wants to know what is happening without asking anyone. They
open the ticket and see which step is active, which are finished, how long each took and what it
cost, the live output of the agent currently working, and the documents produced so far. On the
dashboard they see every active run at a glance and anything that needs their attention.

**Why this priority**: An unattended pipeline that cannot be observed cannot be trusted or
debugged. This story is what makes Story 1 usable in practice rather than a black box.

**Independent Test**: Start a run and, from the ticket page alone, correctly state at any moment
which step is executing, what the run has cost so far, and what the last agent wrote — then
confirm each claim against the produced documents when the run ends.

**Acceptance Scenarios**:

1. **Given** a run in progress, **When** the user opens the ticket, **Then** each pipeline step is
   shown as finished, running, or upcoming, and finished steps display their duration and cost.
2. **Given** an agent step that is executing, **When** the user watches the ticket page, **Then**
   the agent's output appears progressively without the user reloading the page.
3. **Given** a run that has produced a specification and a plan, **When** the user opens the
   artifacts area, **Then** each document can be read in full inside the application.
4. **Given** several runs active at once, **When** the user opens the dashboard, **Then** every
   active run is listed with its ticket, repository, current stage, and status, and the list
   updates as those runs progress.
5. **Given** a run that has finished or failed, **When** the user opens the dashboard, **Then** the
   outcome appears in a recent-activity feed identifying the ticket and what happened.

---

### User Story 3 - Approving before the work continues (Priority: P3)

A team does not want an agent writing code from a plan nobody read. They place a review gate after
the planning step. When a run reaches it, the pipeline pauses and the named approvers are notified.
An approver reads the specification and plan in the application, and either approves so the run
continues, edits the plan directly and approves the edited version, or writes feedback and sends
the work back to the agent that produced it.

**Why this priority**: Review gates are what let a team adopt unattended code generation
incrementally, tightening or loosening oversight per pipeline. They are a core differentiator, but
Stories 1 and 2 must work before gating them is meaningful.

**Independent Test**: Add a review gate after the planning step, start a run, confirm it pauses and
notifies the approver, exercise each of the three decisions in separate runs, and verify that
approve continues to the next step, edit carries the edited document into the following step, and
requested changes re-runs the previous step with the feedback and returns to the same gate.

**Acceptance Scenarios**:

1. **Given** a pipeline containing a review gate, **When** the run reaches it, **Then** the run and
   the ticket both become "waiting for approval", the configured approvers are notified, and the
   ticket appears in the dashboard's approval panel.
2. **Given** a paused run, **When** an approver approves it, **Then** the run continues at the next
   step and the decision is recorded with who made it and when.
3. **Given** a paused run, **When** an approver requests changes with written feedback, **Then**
   the preceding agent step runs again with that feedback available to it, and the run returns to
   the same gate afterwards.
4. **Given** a paused run, **When** an approver edits a produced document and approves, **Then**
   the edited version is what subsequent steps read, and the earlier version is retained.
5. **Given** a gate restricted to named approvers, **When** a user who is not among them opens the
   ticket, **Then** they can read everything but cannot record a decision.
6. **Given** a gate configured to continue automatically after a set time, **When** that time
   passes with no decision, **Then** the run continues and the timeout is recorded as the reason.
7. **Given** a paused run, **When** an approver cancels it, **Then** the run is cancelled, its
   sandbox is released, and the branch produced so far is left intact.

---

### User Story 4 - Recovering from a failed run (Priority: P4)

A run fails: the test suite would not pass, or the agent ran past its cost limit. The ticket author
opens it, reads which step failed and why in plain language, and decides. Sometimes they retry as
is. More often they sharpen the acceptance criteria first and then retry, which starts a fresh
attempt on the same ticket without losing the record of the previous one.

**Why this priority**: Failures are routine, not exceptional, when agents write code. Recovery that
does not require re-creating the ticket is what makes the product survivable day to day.

**Independent Test**: Force a failure (a ticket whose acceptance criteria cannot be met, or a cost
cap set deliberately low), confirm the failure reason and failing step are legible without reading
raw logs, then retry and confirm a second attempt is recorded against the same ticket while the
first attempt's record remains readable.

**Acceptance Scenarios**:

1. **Given** a step that failed, **When** the user opens the ticket, **Then** the failing step is
   identified, a human-readable reason is shown, and the agent's output for that step is available.
2. **Given** a failed run, **When** the user retries, **Then** a new attempt is created on the same
   ticket, numbered after the previous one, using the same pipeline version and a fresh sandbox.
3. **Given** a failed run, **When** the user edits the ticket and retries, **Then** the new attempt
   uses the edited ticket text and the previous attempt's record remains intact.
4. **Given** a run whose cost has reached its cap, **When** the cap is exceeded, **Then** the work
   stops, the run fails identifying the cap as the cause, and the cost consumed is shown.
5. **Given** a pipeline with a shell step running the repository's tests, **When** that step reports
   failure, **Then** the run fails at that step with the command's output retained, and no preceding
   agent step is re-run automatically.
6. **Given** a running ticket, **When** the user cancels it, **Then** the current step is allowed to
   conclude, no further steps begin, and the sandbox is released.

---

### User Story 5 - Designing the interface before building it (Priority: P5)

A ticket asks for a new sign-in screen. Nobody tells the system this is interface work — it works
that out for itself while writing the specification, and says why. Because it is, the run produces
screens before any code is planned: an editable design source committed to the branch alongside one
exported image per screen. The pipeline pauses on those images. A reviewer looks at them next to the
acceptance criteria, knowing no code exists yet, and either approves so the build proceeds against
them, or asks for changes and gets revised screens. A later ticket that only touches a database
migration skips all of this, and the run says so rather than looking stalled.

**Why this priority**: Designing before building is what stops the system inventing an interface
nobody chose. It needs Stories 1–4 working first — there must be a pipeline, visibility, gates and
recovery before a stage is added to them — but it sits above the configuration stories because it
changes what the product produces rather than how it is tuned.

**Independent Test**: Run one ticket that changes the interface and one that does not through the
same pipeline. Verify the first produces a design source and images, pauses for review, and passes
those images to the steps that follow; verify the second records the design step as skipped with a
stated reason and still reaches an open merge request.

**Acceptance Scenarios**:

1. **Given** a ticket whose specification step has run, **When** that step finishes, **Then** the
   ticket carries a decision on whether it changes the interface together with a one-sentence
   reason, and that reason is visible to anyone reading the ticket.
2. **Given** a ticket classified as changing the interface, **When** the design step runs, **Then**
   it produces an editable design source committed to the branch and one exported image per screen.
3. **Given** a design step that produced no design source, or no image at all, **When** it finishes,
   **Then** the step fails, the run fails, and whatever it did produce is kept for inspection.
4. **Given** a ticket classified as not changing the interface, **When** the run reaches the design
   step, **Then** the step is recorded as skipped with its reason shown, the run does not fail, and
   it continues to the next step.
5. **Given** a specification step that produced no decision at all, **When** the run continues,
   **Then** the ticket is treated as not changing the interface, the run proceeds, and the missing
   decision is surfaced as a warning rather than failing the run.
6. **Given** a review gate following a design step, **When** a reviewer opens it, **Then** they see
   every screen as an image they can open full size, the ticket's acceptance criteria beside them,
   the reason the ticket was classified as interface work, and a statement that no code has been
   written yet.
7. **Given** a reviewer at that gate, **When** they request changes with feedback, **Then** the
   design step runs again and revises the existing design source rather than starting from nothing,
   and the run returns to the same gate with the new screens.
8. **Given** a run whose design step produced screens, **When** the planning and implementing steps
   run, **Then** those screens are available to them and the interface they build is expected to
   match them.
9. **Given** a completed run that produced screens, **When** the merge request is opened, **Then**
   the screens appear in its description and the committed design source is linked from it.

---

### User Story 6 - Composing the pipeline (Priority: P6)

A lead decides the standard pipeline is too loose for their repository. They open the pipeline,
drag the steps into the order they want, insert a review gate between planning and implementation,
add a shell step that runs the linter after implementation, and save. Existing runs are unaffected;
the next ticket picks up the new arrangement.

**Why this priority**: Different repositories deserve different amounts of oversight. This turns
the product from one fixed workflow into something a team can shape. It presupposes that the steps
themselves (Stories 1–3) already work.

**Independent Test**: Build a pipeline with a non-default step order including a review gate and a
shell step, save it, start a ticket on it, and confirm the run executes exactly those steps in
exactly that order — while a run started before the edit continues on the old arrangement.

**Acceptance Scenarios**:

1. **Given** the pipeline editor, **When** the user reorders steps or inserts a step between two
   existing ones, **Then** the new order is what saves.
2. **Given** a saved pipeline, **When** it is saved again after a change, **Then** its version
   advances and runs already in flight continue on the version they started with.
3. **Given** a pipeline with a shell step, **When** that step's command exits with a failure,
   **Then** the step fails, the run fails, and the command's output is retained.
4. **Given** a pipeline being saved, **When** its last code-producing step is missing, **Then** the
   save is refused and the reason is stated.
5. **Given** a pipeline used by several repositories, **When** the user opens it, **Then** how many
   repositories depend on it is visible before they change it.
6. **Given** a ticket being created, **When** the user chooses a pipeline, **Then** the steps that
   will run, with the agent and model behind each, are shown before they commit.

---

### User Story 7 - Configuring the agents and their skills (Priority: P7)

An engineer is unhappy with how the planning agent writes. Without asking an administrator, they
create their own planning agent, write its instructions, put it on a stronger model, restrict which
tools it may use, and attach a reusable house-style document so every agent referencing it follows
the same conventions. They swap it into their own pipeline. New runs use the new configuration;
nothing in flight changes, and nobody else's agents are touched.

**Why this priority**: This is the deepest layer of control and the one fewest users touch. Sensible
defaults must exist and work first, which is why it sits below composing pipelines.

**Independent Test**: Change an agent's instructions and permitted tools, attach a skill document,
start a run, and confirm from the run's output that the agent behaved according to the new
instructions and did not use a tool it was no longer permitted.

**Acceptance Scenarios**:

1. **Given** the agent editor, **When** the user changes instructions, model, permitted tools, or
   limits and saves, **Then** runs started afterwards use the new configuration and runs already in
   flight do not.
2. **Given** an agent whose instructions reference ticket or repository values, **When** a run
   starts, **Then** those references are replaced with that run's actual values.
3. **Given** an agent with a tool withheld, **When** it runs, **Then** it cannot take an action
   requiring that tool.
4. **Given** a shipped default agent that has been modified, **When** the user resets it, **Then**
   its original configuration is restored.
5. **Given** a skill document attached to an agent, **When** that agent runs, **Then** the document
   is available to it, and editing the document changes what later runs receive.
6. **Given** an agent or skill, **When** the user views it, **Then** how many pipelines and runs
   depend on it is visible before they change it.
7. **Given** an agent another user owns, **When** a user opens it, **Then** its owner is identified,
   they can read it and use it in their own pipeline, and they cannot change or delete it.

---

### User Story 8 - Setting up and governing the workspace (Priority: P8)

An administrator prepares the workspace for the team: they record the credentials the agents need,
point the system at the orchestration and sandbox services it depends on, confirm those
connections respond, set the ceiling on what a single run may cost and how long it may take, cap
how many runs may execute at once, and invite the team.

**Why this priority**: Necessary once per workspace and largely invisible afterwards. The limits it
sets are what make unattended agent execution financially safe, but a working default configuration
means the team is not blocked on it.

**Independent Test**: From an unconfigured workspace, complete setup, verify each dependency
connection test reports its true state, set a per-run cost ceiling and a concurrency cap, then
confirm a run stops at the ceiling and that a run beyond the cap waits and reports its position.

**Acceptance Scenarios**:

1. **Given** the settings area, **When** the administrator tests a dependency connection, **Then**
   the result distinguishes reachable and correctly authorized from unreachable or unauthorized.
2. **Given** a workspace cost ceiling, **When** a pipeline does not set its own, **Then** the
   workspace ceiling is what applies to the run.
3. **Given** a concurrency cap that is fully consumed, **When** another ticket is started, **Then**
   it waits and its position in the queue is visible to its author.
4. **Given** stored credentials, **When** any user views the settings area, **Then** no credential
   is readable back in full.
5. **Given** a member rather than an administrator, **When** they open the settings area, **Then**
   they cannot change workspace credentials, dependency connections, or cost ceilings.

---

### Edge Cases

- A repository's access token expires between ticket creation and the run starting: the run must
  not begin, the ticket must not silently sit in limbo, and the repository must show why.
- The orchestration service is unreachable at the moment a ticket is created: the ticket must
  remain queued, delivery must be retried with increasing delays, and the user must be told it has
  not started rather than shown a run that does not exist.
- The sandbox dies mid-step: the step is attempted once more from the last commit on the branch
  before the run is failed.
- The same completion notice arrives twice for one step: the second is ignored rather than
  producing a duplicate step record or advancing the run twice.
- Two approvers decide on the same gate simultaneously: exactly one decision takes effect and the
  other approver is told the gate has already been decided.
- An approver requests changes repeatedly: the loop is bounded by the run's cost and time ceilings
  rather than continuing indefinitely.
- Nobody approves a gate configured to wait indefinitely: the run stays paused, holds no sandbox
  it does not need, and continues to appear in the approval panel.
- A pipeline or agent is edited while a run using it is in flight: the run's behaviour is unchanged.
- A retry runs against a branch that already carries commits from the previous attempt: the branch
  is brought back to a known state rather than accumulating both attempts' work.
- The repository's default branch changes between attempts: the merge request targets the current
  default branch, not the one recorded earlier.
- An agent produces the required document but leaves it empty: treated as a missing document.
- The branch pushes successfully but opening the merge request fails: the pushed branch is not
  lost, and the run reports that the code exists but the merge request does not.
- A ticket is created against a repository that is later disconnected: the run does not continue
  against a repository the workspace no longer has access to.
- The user cancels while an agent is mid-step: the step concludes or is stopped, and no further
  step begins.
- An agent attempts to read a credential from its environment and write it into a document it
  produces: credentials must not survive into artifacts, logs, or the merge request description.
- A pipeline contains no verification step: the run can reach an open merge request with nothing but
  the implementing agent's own judgement behind it, and the author must be able to see that before
  starting the ticket rather than discovering it in review.
- A member sets their own agent's cost or time limit above the workspace ceiling: the workspace
  ceiling prevails and the member is told which limit actually applies.
- A user leaves the workspace while pipelines, agents or skills they own are still in use: those
  configurations must keep working for the runs and repositories depending on them, and must remain
  changeable by an administrator.
- A ticket really does change the interface but the specification step records no decision: the run
  proceeds with design skipped, and the warning is the only signal, so a reviewer can receive code
  for an interface nobody designed. The warning must therefore be visible on the run and not only
  in the step's output.
- A design step is placed before the step that classifies the ticket: refused when the pipeline is
  saved, so it is never discovered at run time.
- A reviewer rejects the screens repeatedly: the loop is bounded by the run's cost and time
  ceilings, as any other change-request loop is.
- A run is retried after a previous attempt already produced a design: the existing design source is
  revised rather than redrawn, so a reviewer's earlier accepted work is not silently discarded.
- The design service becomes unreachable part-way through a design step: treated as a failed step
  like any other engine failure, with whatever was produced retained.

## Requirements *(mandatory)*

### Functional Requirements

#### Workspace, identity and access

- **FR-001**: System MUST allow a person to sign in with a GitLab account, a GitHub account, or an
  email address and password.
- **FR-002**: System MUST create a user record in the workspace on that person's first successful
  sign-in, without requiring any repository to be connected first.
- **FR-003**: System MUST distinguish two roles, administrator and member, and record which role
  each user holds.
- **FR-004**: System MUST restrict changing workspace credentials, dependency connections, cost
  ceilings, and membership to administrators.
- **FR-005**: System MUST allow administrators to invite users to the workspace and to change a
  user's role.
- **FR-005a**: System MUST let administrators record the design service connection, its default
  model and its export settings, and MUST let them test that connection, and MUST require it only
  where a pipeline contains a design step.
- **FR-006**: System MUST allow any member to create pipelines, agents and skills, and to change and
  delete their own, without administrator involvement. The scope of what a member may change is set
  by FR-006c; this requirement governs only that no administrator need be involved.
- **FR-006a**: System MUST record an owner for every pipeline, agent and skill a user creates, and
  MUST allow that owner to change or delete it at will.
- **FR-006b**: System MUST make the shipped default agents and default pipelines available to every
  user in the workspace.
- **FR-006c**: System MUST allow any user to read a pipeline, agent or skill another user owns and
  to use it in their own work, while restricting changing and deleting it to its owner and to
  administrators.
- **FR-006d**: System MUST show who owns a pipeline, agent or skill wherever it can be selected or
  edited.

#### Repositories

- **FR-007**: Users MUST be able to connect a git repository by choosing whether it is hosted on
  GitLab or GitHub, giving its address, supplying an access credential, and choosing which pipeline
  new tickets on it use by default.
- **FR-008**: System MUST verify, before saving a connection, that the supplied credential can read
  the repository, create branches on it, and open merge requests against it.
- **FR-009**: System MUST name the specific missing permission when that verification fails, rather
  than reporting a generic failure.
- **FR-010**: System MUST state the credential permissions a provider requires at the point the
  credential is entered.
- **FR-011**: System MUST store repository credentials such that no user can read them back in full
  after saving.
- **FR-012**: System MUST show, for each connected repository, its provider, its default branch, its
  default pipeline, how many tickets on it are running and how many are done, and whether its
  connection is currently usable.
- **FR-013**: System MUST prevent new runs from starting on a repository whose credential is no
  longer valid, and MUST show that state on the repository.
- **FR-014**: Users MUST be able to replace a repository's credential and to disconnect a repository.
- **FR-014a**: System MUST support repositories hosted on GitLab.com and on GitHub.com, and MUST
  offer no other provider choice in this version.
- **FR-014b**: System MUST refuse, with a stated reason, an attempt to connect a repository that is
  not hosted on one of those two services.

#### Tickets

- **FR-015**: Users MUST be able to create a ticket that names one repository, carries a title, a
  free-text description, and any number of acceptance criteria.
- **FR-016**: System MUST require a repository and a title, and MUST allow the description and
  acceptance criteria to be empty.
- **FR-017**: System MUST allow a ticket to be saved without starting it, and started later.
- **FR-018**: System MUST allow the ticket's author to choose which pipeline runs, defaulting to the
  repository's default pipeline.
- **FR-019**: System MUST show, before the ticket is started, every step that will run with the
  agent and model behind each, and an estimate of what the run will cost and how long it will take.
- **FR-019a**: System MUST distinguish, in that list, the steps that always run from those that are
  conditional, and MUST state each condition in words.
- **FR-020**: System MUST tie every ticket to exactly one repository and allow at most one run of a
  ticket to be active at a time.
- **FR-021**: System MUST assign each ticket a stable human-readable identifier and derive its
  branch name from that identifier and its title.
- **FR-022**: System MUST reflect a ticket's state as one of: not started, waiting to start,
  running, waiting for approval, done, failed, or cancelled.
- **FR-023**: Users MUST be able to view all tickets across repositories, filter them by
  repository, pipeline and author, and see them grouped by state as well as in a flat list.
- **FR-023a**: System MUST show on each ticket, without opening it, whichever of the following
  applies: the step currently running and its position in the pipeline, the gate awaiting approval,
  the merge request that was opened, or the reason it failed.

#### Pipelines

- **FR-024**: System MUST represent a pipeline as an ordered list of steps held as data that users
  edit, with no step order fixed by the execution machinery.
- **FR-025**: System MUST support five kinds of step: an agent step, a design step, a human review
  gate, a shell command, and a notification.
- **FR-026**: Users MUST be able to reorder steps, insert a step between any two existing steps,
  and remove a step.
- **FR-027**: System MUST advance a pipeline's version on every save, and MUST leave runs already
  in flight executing the version they started with.
- **FR-028**: System MUST refuse to save a pipeline that contains no code-producing step, while
  allowing verification, review gates and notifications to follow that step.
- **FR-029**: System MUST treat opening the merge request as implicit and always last, not as a step
  a user can move or remove.
- **FR-030**: System MUST show how many repositories use a pipeline.
- **FR-031**: Users MUST be able to duplicate a pipeline.
- **FR-032**: System MUST allow each agent step to declare the documents it is required to produce,
  and each review gate to declare who may approve it, how long it waits, and what happens when
  that time expires.
- **FR-032a**: System MUST let every step carry a condition deciding whether it runs, defaulting to
  running always.
- **FR-032b**: System MUST offer as conditions: always, only when the ticket changes the interface,
  and only when it does not.
- **FR-032c**: System MUST evaluate a step's condition when the run reaches that step, against what
  the run has established by then.
- **FR-032d**: System MUST refuse to save a pipeline carrying a condition at a point where the fact
  it depends on has not yet been established, and MUST state which step and which fact.
- **FR-032e**: System MUST refuse to save a pipeline whose design step precedes the step that
  decides whether the ticket changes the interface.
- **FR-032f**: System MUST mark a conditional step as conditional wherever a pipeline is shown, and
  state its condition in words rather than as a code.

#### Agents and skills

- **FR-033**: System MUST ship working default agents covering specification, interface design,
  planning, task breakdown, and implementation, such that a workspace can produce a merge request
  without any agent being configured.
- **FR-034**: System MUST ship at least three default pipelines offering different amounts of human
  oversight.
- **FR-034a**: System MUST NOT put a verification command in any shipped default pipeline, because
  that command is repository-specific, and MUST make plain — in the pipeline editor and before a
  ticket is started — when a pipeline contains no verification step and therefore nothing beyond
  the implementing agent's own work checks the result.
- **FR-035**: Users MUST be able to create additional agents and edit existing ones.
- **FR-036**: System MUST allow each agent's instructions, model, permitted tools, attached skills,
  and per-step cost, time and turn limits to be configured independently.
- **FR-036a**: System MUST offer, for an agent that runs on the design service rather than the
  coding agent engine, that service's own choice of models, and MUST omit the tool permissions,
  which do not apply to it.
- **FR-036b**: System MUST identify, wherever agents are listed, which engine each one runs on.
- **FR-037**: System MUST substitute the ticket's and repository's actual values wherever an agent's
  instructions reference them.
- **FR-038**: System MUST make the feedback from a change request available to the agent that runs
  again because of it.
- **FR-039**: System MUST prevent an agent from taking an action requiring a tool it has not been
  permitted.
- **FR-040**: System MUST allow a modified default agent to be restored to its shipped
  configuration.
- **FR-041**: System MUST apply agent changes only to runs started afterwards.
- **FR-042**: Users MUST be able to create, edit and delete named skill documents and attach them to
  any number of agents.
- **FR-043**: System MUST record a description on each skill stating when an agent should apply it,
  and MUST make that description available to agents holding the skill.
- **FR-043a**: System MUST show, for each agent and each skill, how many pipelines and runs depend
  on it.

#### Running a pipeline

- **FR-044**: System MUST resolve, at the moment a run starts, the pipeline and every agent, skill
  and limit it references into a single fixed description of the work, and MUST NOT consult that
  configuration again during the run.
- **FR-045**: System MUST create a run record for each attempt, numbered in sequence on its ticket.
- **FR-046**: System MUST execute each run in an isolated sandbox that is created for that run and
  released when it ends.
- **FR-047**: System MUST NOT reuse a sandbox between runs.
- **FR-048**: System MUST place a clone of the repository in the sandbox on a new branch derived
  from the ticket, taken from the repository's current default branch.
- **FR-049**: System MUST execute the pipeline's steps strictly in order, one at a time.
- **FR-050**: System MUST pass work between steps as files in the repository workspace, so that each
  step reads what earlier steps wrote.
- **FR-051**: System MUST verify after each agent step that every document the step was required to
  produce exists and is not empty, and MUST fail the step otherwise.
- **FR-052**: System MUST record for each step its outcome, when it started and finished, how long
  it took, what it cost, and a summary of what it did.
- **FR-053**: System MUST retain the full output of every step for later reading.
- **FR-054**: System MUST retain each version of every document a step produces, including versions
  created by a human editing it at a review gate.
- **FR-055**: System MUST stop the run at the first failed step and MUST NOT open a merge request
  for a failed run.
- **FR-055a**: System MUST treat verification as an explicit pipeline step rather than a stage of
  its own: a pipeline author who wants the repository's tests, linters or build run adds a shell
  step carrying that command.
- **FR-055b**: System MUST NOT infer, detect or run any verification command a pipeline does not
  specify, and MUST NOT hold a repository-level test command of its own.
- **FR-055c**: System MUST fail the step, and with it the run, when a shell step's command reports
  failure, and MUST retain that command's full output.
- **FR-055d**: System MUST NOT re-run a preceding agent step automatically because a shell step
  failed; recovery from a failed verification is a retry (FR-088) or a human decision at a review
  gate the author placed after it (FR-060).

#### Designing the interface

- **FR-099**: The step that writes the specification MUST also decide whether the ticket changes the
  interface, and MUST record a one-sentence reason for that decision.
- **FR-100**: System MUST store that decision and its reason on the ticket, and MUST show the reason
  wherever the decision changes what runs.
- **FR-101**: System MUST NOT ask the person creating a ticket to declare whether it changes the
  interface.
- **FR-102**: System MUST treat a ticket as not changing the interface when the specification step
  produces no usable decision, MUST let the run continue, and MUST surface the missing decision as a
  warning on the run rather than failing it.
- **FR-103**: A design step MUST produce an editable design source committed to the run's branch and
  one exported image per screen.
- **FR-104**: System MUST fail a design step that produced no design source, or that exported no
  image at all, and MUST retain whatever it did produce for inspection.
- **FR-105**: System MUST commit the design source to the branch, so that a design travels with the
  code it describes and a later ticket can revise it rather than redraw it.
- **FR-106**: System MUST revise the existing design source, rather than start from an empty one,
  whenever a design step runs again — whether from a change request or from a retry of the run.
- **FR-107**: System MUST stream a design step's output to anyone viewing the ticket as it runs, and
  MUST show what command produced it, on the same terms as any other step.
- **FR-108**: System MUST count a design step's cost against the same run budget and the same
  ceilings as every other step.
- **FR-109**: System MUST make the screens a design step produced available to the planning and
  implementing steps that follow it.
- **FR-110**: System MUST record a step whose condition was not met as skipped, stating the
  condition that was not met.
- **FR-111**: A skipped step MUST NOT fail its run; the run MUST continue at the next step.
- **FR-112**: System MUST treat skipped as a terminal outcome for that step alone, and MUST
  distinguish it from done, failed, and not yet run wherever step outcomes appear.

#### Human review gates

- **FR-056**: System MUST pause a run when it reaches a review gate and hold it until a decision is
  recorded or the gate's waiting time expires.
- **FR-057**: System MUST set both the run and its ticket to "waiting for approval" while paused.
- **FR-058**: System MUST notify the gate's approvers when a run reaches it.
- **FR-059**: System MUST surface every run awaiting approval on the dashboard as its most
  prominent call to action, and in the tickets view grouped by that state.
- **FR-060**: System MUST offer an approver exactly four decisions: approve and continue, edit a
  produced document and continue, request changes with written feedback, or cancel the run.
- **FR-061**: System MUST continue at the next step on approval, and MUST run the preceding agent
  step again with the feedback and return to the same gate on a change request.
- **FR-061a**: System MUST re-run the design step with the feedback, and return to the same gate
  with the revised screens, when changes are requested at a gate that follows a design step.
- **FR-062**: System MUST carry a document edited at a gate into every subsequent step as the
  version they read.
- **FR-063**: System MUST record for every decision who made it, what they decided, any feedback
  they wrote, and when.
- **FR-064**: System MUST restrict deciding to the gate's configured approvers — anyone in the
  workspace, the ticket's author, or a named list — while allowing anyone in the workspace to read
  the ticket and its documents.
- **FR-064a**: System MUST accept exactly one decision per gate and MUST tell a second decider that
  the gate is already decided.
- **FR-064b**: System MUST honour the gate's expiry behaviour — wait indefinitely, continue
  automatically, or fail the run — and MUST record when a run continued or failed for that reason.
- **FR-064c**: System MUST show, at a gate, every document and every screen produced so far, and a
  chronological record of everything that has happened on the run.
- **FR-064d**: System MUST show, at a gate following a design step, every screen as an image
  openable at full size, the ticket's acceptance criteria beside them, the reason the ticket was
  classified as interface work, and a statement that no code has been written yet.
- **FR-064e**: System MUST offer, at such a gate, a link that opens the committed design source in
  the design service.

#### Delivering the merge request

- **FR-065**: System MUST push the run's branch to the repository and open a merge request from it
  into the repository's current default branch.
- **FR-066**: System MUST title the merge request with the ticket's title.
- **FR-067**: System MUST include in the merge request description the ticket's description, its
  acceptance criteria as a checklist, the specification and plan the agents produced, what the run
  cost and how long it took, and a link back to the ticket.
- **FR-067a**: System MUST embed the screens in the merge request description, above the summary of
  the change, and MUST link the committed design source below them, whenever the run produced any.
- **FR-068**: System MUST label the merge request so that work produced by the system, and the
  pipeline that produced it, are identifiable on the provider.
- **FR-068a**: System MUST additionally label a merge request whose ticket was classified as
  interface work, so that this is identifiable on the provider.
- **FR-069**: System MUST store the merge request's address on the ticket and show it wherever the
  ticket appears.
- **FR-070**: System MUST NOT merge the merge request; merging remains a human action on the
  provider.
- **FR-070a**: System MUST mark the ticket done, record the run's final cost, and add the outcome to
  the activity feed once the merge request is open.

#### Visibility

- **FR-071**: System MUST show on the dashboard how many repositories are connected, how many
  tickets are running, how many await approval, and how many merge requests were opened in the
  current week.
- **FR-072**: System MUST list every active run on the dashboard with its ticket, repository,
  progress through the pipeline, and status.
- **FR-073**: System MUST show a feed of recent events across the workspace, covering at least
  merge requests merged, runs completed, runs failed, gates reached, and tickets created.
- **FR-074**: System MUST update the dashboard and any open ticket as a run progresses, without the
  user reloading.
- **FR-075**: System MUST show, for a run, each step's state, duration and cost, and the total spent
  against the run's ceiling.
- **FR-075a**: System MUST show a skipped step in that list, marked as skipped and carrying its
  reason, rather than omitting it.
- **FR-076**: System MUST stream the output of the executing step to anyone viewing the ticket, and
  MUST show what command produced it.
- **FR-077**: System MUST let every document a run produced, every screen it produced, the commits
  on its branch, and its merge request be opened within the application, showing screens as images
  in a gallery that opens each at full size and everything else as text or a link.
- **FR-078**: System MUST show, for a run, which pipeline and version it used, which attempt it is,
  and a reference that identifies the execution in the orchestration service.

#### Limits, safety and secrets

- **FR-079**: System MUST enforce a ceiling on what a single run may cost and how long it may take,
  taken from the pipeline or, failing that, the workspace.
- **FR-079a**: System MUST cap any pipeline-level or agent-level cost or time limit at the
  workspace ceiling, so that a limit a member sets cannot raise what a run may consume beyond what
  an administrator allowed.
- **FR-080**: System MUST enforce each agent's own cost, time and turn limits within a step.
- **FR-081**: System MUST stop the work and fail the run when a ceiling is reached, and MUST state
  the ceiling as the reason.
- **FR-082**: System MUST enforce a workspace limit on how many runs execute at once, and MUST hold
  further runs in a queue showing each author their position.
- **FR-083**: System MUST supply credentials to a run without writing them into the repository
  workspace, and MUST NOT persist them in the orchestration service.
- **FR-083a**: System MUST supply the design service credential only to runs whose pipeline
  contains a design step.
- **FR-083b**: System MUST detect a missing or rejected design service credential when such a run
  starts, and MUST fail the design step immediately with a message naming where that credential is
  configured.
- **FR-084**: System MUST exclude credentials from step output, retained documents, retained
  screens, and merge request descriptions.
- **FR-085**: System MUST allow administrators to constrain a sandbox's processing power, memory and
  wall-clock lifetime, and MUST state which of those the configured execution host enforces and
  which it cannot — so a setting that does nothing is visible as such before a run depends on it.

  **Amended 2026-09-11 on three counts** (002 FR-011a, FR-012, research D7; constitution 2.0.0 Sync
  Impact Report follow-up 2). This requirement previously also covered "whether it may reach the
  network while code is being written", and that half is withdrawn:

  1. **Its scope named a step that does not exist.** "While code is being written" pointed at an
     *implement* step, and no declared step type matches one — a pipeline is `agent`, `design`,
     `shell`, `checkpoint` and `notification`. The restriction had no well-defined moment to apply
     at.
  2. **Its substance is not enforceable on a host with no per-host filtering.** 002 T006 measured
     that the managed execution host's allow and deny lists govern only traffic routed through its
     own proxy, not sockets a process opens for itself — and an agent step runs arbitrary code,
     which opens its own. A model-driven step is also itself a call to a model service, so a sandbox
     with no reach cannot run one at all.
  3. **What replaces it is disclosure, not silence.** The setting is presented as unavailable on a
     host that cannot honour it, naming the host as the reason, rather than accepted and ignored
     (002 FR-011a). A switch that saves, reads as "off", and does nothing is worse than no switch:
     an administrator turns it off, believes the sandbox is sealed, and is wrong in exactly the
     direction that matters.

  The stored setting itself is kept, because whether an administrator *asked* for the restriction is
  worth recording and it is honoured on a host that can enforce it — which the locally administered
  host does, via `--network none`.
- **FR-086**: System MUST release a run's sandbox when the run ends, and MUST allow administrators
  to have failed runs' sandboxes retained for a bounded period for diagnosis.

#### Failure and recovery

- **FR-087**: System MUST show, for a failed run, which step failed and why, in language that does
  not require reading raw output.
- **FR-088**: Users MUST be able to retry a failed or cancelled ticket, creating a further attempt
  on the same ticket with the same pipeline version and a fresh sandbox.
- **FR-089**: Users MUST be able to edit a ticket and retry it in one action.
- **FR-090**: System MUST retain every previous attempt's record, output and documents when a new
  attempt is created.
- **FR-091**: System MUST bring the run's branch back to a known state when an attempt begins on a
  branch a previous attempt already wrote to.
- **FR-092**: System MUST hold the implementing agent responsible for leaving the repository's
  tests passing within its own step, using the tools it has been permitted, rather than relying on
  any verification stage of the system's own.
- **FR-093**: System MUST attempt a step once more in a new sandbox, resuming from the last commit
  on the branch, when the sandbox or its host becomes unavailable mid-step.
- **FR-094**: System MUST keep a ticket queued and retry delivery with increasing delays when the
  orchestration service cannot be reached as the run starts, and MUST show the user that the run
  has not begun.
- **FR-095**: System MUST ignore a repeated report of an outcome it has already recorded, so that a
  duplicate does not create a second step record or advance the run twice.
- **FR-096**: Users MUST be able to pause a running ticket, which MUST let the current step conclude
  and MUST prevent any further step from beginning.
- **FR-097**: Users MUST be able to cancel a run at any point, which MUST release its sandbox and
  leave the branch produced so far intact.
- **FR-098**: System MUST report, when a branch was pushed but the merge request could not be
  opened, that the code exists and the merge request does not, without discarding the pushed branch.

### Key Entities

- **Workspace**: One team's container for everything below. Holds the team's members, the
  credentials agents run with, the connections to the services that execute runs, and the ceilings
  on cost, time and concurrency.
- **User**: A person who signs in. Has a name, an email address, an avatar and a role of
  administrator or member.
- **Repository**: A connected git repository. Knows its provider, its address, its default branch,
  which pipeline its tickets use by default, a reference to its stored credential, and whether that
  credential currently works.
- **Ticket**: One unit of requested work on one repository. Carries a title, a description,
  acceptance criteria, the pipeline and pipeline version pinned when it started, its state, its
  branch name, its current run, whether it changes the interface together with the reason for that
  decision, and the merge request it produced.
- **Pipeline**: A named, versioned, ordered list of steps that turns a ticket into a merge request.
  Belongs to the workspace, records the user who owns it, and may be used by many repositories.
- **Step**: One item in a pipeline. Is an agent step, a design step, a human review gate, a shell
  command, or a notification. Carries the condition under which it runs, and the settings its kind
  needs — which agent, which documents or screens it must produce, who may approve, how long to
  wait, which command to run, or where to notify.
- **Agent**: A configured persona that does one kind of work. Carries instructions, a model, the
  tools it is permitted, the skills attached to it, and its own cost, time and turn limits. Either
  one of the shipped defaults, available to everyone, or one a user created and owns.
- **Skill**: A named, reusable instruction document with a description saying when to apply it.
  Records the user who owns it, and may be attached to any number of agents.
- **Run**: One attempt at executing a pipeline for a ticket. Carries its attempt number, the fixed
  description of the work resolved at the start, its state, which step it is on, references to the
  execution and sandbox behind it, its cost, and when it started and finished.
- **Step Result**: What happened on one step of one run: its outcome, its timings, its cost, a
  summary, and references to its output and the documents it produced.
- **Artifact**: A versioned thing a run produced, belonging to a run and a step. Each is one of: a
  document, the editable design source, one exported screen image, the list of commits on the
  branch, or the merge request. Screen images are the only kind shown as pictures; the rest are text
  or links.
- **Screen**: One exported image from a design step, carrying the name of the screen it depicts.
  The unit the application shows in a gallery and the merge request embeds.
- **Approval**: One decision at one review gate: who decided, what they decided, any feedback they
  wrote, and when.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A new user, starting from a fresh workspace and without consulting documentation, can
  go from signing in to an open merge request on a small change in under 15 minutes of their own
  attention.
- **SC-002**: At least 70% of tickets whose acceptance criteria are complete and unambiguous reach
  an open merge request on the first attempt, with no human editing of the produced code.
- **SC-003**: A person viewing a running ticket can state which step is executing, what has been
  spent, and what the last agent produced, without leaving the page or asking anyone.
- **SC-004**: The state a user sees for a run is never more than 5 seconds behind the run's actual
  state.
- **SC-005**: An approver reaching a review gate from a notification can reach a decision in under
  2 minutes, with every document they need to read available without navigating away.
- **SC-006**: No run's cost exceeds its configured ceiling by more than 5%, measured across every
  run in a month.
- **SC-007**: The configured number of runs execute concurrently without any run taking more than
  20% longer than it would alone; runs beyond that number wait and are told their position.
- **SC-008**: At least 95% of failed runs present a reason a user can act on without reading raw
  step output.
- **SC-009**: Retrying a failed ticket takes no more than two interactions, and every previous
  attempt remains readable afterwards.
- **SC-010**: Editing a pipeline, an agent, or a skill changes the behaviour of zero runs already in
  flight.
- **SC-011**: No credential appears in any step's retained output, any produced document, or any
  merge request description, verified by scanning every artifact of every run in a period.
- **SC-012**: Every run holds an isolated sandbox that is released within 5 minutes of the run
  ending, except where an administrator has chosen to retain failed runs' sandboxes.
- **SC-013**: A team can express their required amount of human oversight — from none to a gate
  between every step — without anyone changing the system's own configuration or code.
- **SC-014**: Every completed run's merge request contains enough context that a reviewer who never
  saw the ticket can judge the change from the merge request alone.
- **SC-015**: A member can change how an agent behaves and have that change take effect on their
  next run without any administrator action.
- **SC-016**: Before starting a ticket, a user can tell whether the pipeline they chose verifies the
  result, without inspecting the pipeline's individual steps.
- **SC-017**: For at least 90% of tickets that change the interface, a reviewer can judge the
  proposed screens against the acceptance criteria before any code exists.
- **SC-018**: A ticket that does not change the interface spends nothing on design, and its run
  shows the design step as skipped with a reason rather than as missing or stalled.
- **SC-019**: A reviewer at a design gate can reach a decision from the screens shown, without
  opening the design source or the repository.

## Assumptions

These were chosen as reasonable defaults where the source material did not specify, and are
recorded here so they can be challenged rather than discovered later.

- **One workspace per deployment.** Multi-tenant hosting of many independent teams is out of scope,
  as the source specification states.
- **Architectural constraints are already decided.** The source specification fixes that an external
  workflow orchestrator executes pipelines and waits at gates, that each run occupies a
  container-based sandbox, that agent steps are invocations of the Claude command-line tool, and
  that design steps are invocations of the pen.dev command-line tool — two distinct engines behind
  one step vocabulary. These are treated as given constraints on the solution rather than as
  requirements of this feature, and this specification deliberately describes behaviour instead of
  restating them.
- **Humans merge.** The system opens merge requests and never merges them; code review happens on
  the git provider as the team already does it.
- **Change-request loops are bounded by the run's ceilings**, not by a fixed number of rounds, so a
  reviewer is never blocked by a round limit but a run can never loop indefinitely.
- **Default pipelines cover the common cases.** Three are shipped, differing only in how much human
  oversight they impose, and all end in code being produced.
- **Notification reaches people in the application and by email**, with other destinations available
  only where a pipeline includes a notification step configured for them.
- **Cost and duration estimates shown before a run starts are estimates**, derived from comparable
  past runs, and are not commitments.
- **Run output and produced documents are retained for 90 days**, after which output may be
  discarded while the record of what happened, what it cost, and which merge request resulted is
  kept indefinitely.
- **The interface targets a desktop browser.** Layouts optimised for small screens are out of scope
  for this version, though the approval decision is expected to be usable on a phone.
- **The interface is English-only** for this version.
- **Verification is opt-in and the pipeline author owns it.** The system runs no checks of its own
  and never infers a repository's test command. Where a pipeline includes a shell step running the
  repository's tests, that suite is the definition of "working"; where it does not, the only
  assurance is what the implementing agent did within its own step. A consequence worth naming: a
  shipped default pipeline cannot verify anything until an author adds a command to it.
- **Any member may grant their own agents broad tool access.** This follows from the chosen
  permission model rather than being an oversight. Three things bound it: ownership confines a
  change to that member's own agents, workspace cost and time ceilings cannot be raised from below
  (FR-079a), and administrators keep sole control of credentials, dependency connections and
  sandbox constraints (FR-004, FR-085).

### Divergences from the source product specification

This specification now tracks the conditional design stage as `main` describes it. Four
divergences remain — three from the answers to this feature's open questions rather than from the
design stage, and one found while building. Those documents should be updated to match, or this
specification revisited.

- **No verification stage of the system's own.** Source §5.2 step 4 has the system running the
  repository's test command before opening the merge request, and §10 lists "Tests fail at Verify"
  as a failure mode. Verification is now a shell step a pipeline author adds (FR-055a–FR-055d), so
  neither that stage nor that failure mode exists any more, and the implementing agent carries the
  responsibility instead (FR-092).
- **No self-hosted provider.** Design artboard 03 offers "Self-hosted Git" as one of three provider
  choices. Only GitLab.com and GitHub.com are in scope (FR-014a–FR-014b), so that choice comes off
  the artboard.
- **Pipelines, agents and skills have owners.** The source data model scopes them to the workspace
  with no owner. They now record one (FR-006a): any member may create and change their own without
  an administrator, and only the owner or an administrator may change a given one (FR-006c).
- **A screen needs JavaScript to render, though its forms do not need it to submit.**
  `contracts/ui-data.md` claims a `form` mutation works without JavaScript. The mutation does; the
  screen carrying it does not. In SvelteKit 2.70.3 a component that reads a remote `query` renders
  only its pending state on the server — the resolved data is embedded for hydration but not used
  in the server-rendered markup — so with scripting off a person never reaches the buttons. Measured
  on the approval checkpoint screen: scripting on renders the gate and four decision buttons,
  scripting off renders "Loading…". This is a limit of the experimental API, not of the
  application's shape, so the forms stay forms and the claim is narrowed rather than the design
  changed.

### Dependencies

- Access to the Claude models the agents are configured to use, credentialed at the workspace level.
- A git provider account per repository whose credential can read the repository, push branches, and
  open merge requests.
- A reachable workflow orchestration service capable of pausing a run for an unbounded period while
  a gate awaits a human decision.
- A reachable container host able to run the configured number of sandboxes concurrently, each
  carrying git, the Claude command-line tool, the design tooling, and the repository's own language
  toolchain.
- A reachable design service, credentialed at the workspace level, able to produce screens from a
  written description and export them as images. Required only where a pipeline contains a design
  step.

### Out of Scope

- The hosting model, the deployment topology, and the technology the application itself is built in.
- Billing, subscriptions, and usage-based pricing.
- Multi-tenant operation for independent teams.
- Merging merge requests, resolving merge conflicts, and responding to review comments on the
  provider.
- Any ticket spanning more than one repository.
- More than one run of the same ticket at the same time.
- Importing tickets from an existing issue tracker.
- Editing the orchestration workflow itself from within the application.
- Layouts optimised for small screens. The interface's own language is no longer out of scope: it
  is Mongolian, because `design.pen` is, and the words live in one catalogue per language
  (`apps/web/src/lib/i18n`) rather than in each component. What stays in English stays on purpose —
  command-line output, repository and branch names, model identifiers, file paths, URLs, and the
  product's name. Choosing a language per PERSON is still out of scope: the language belongs to the
  deployment.
- Self-hosted and enterprise-hosted git servers — including GitLab Self-Managed and GitHub
  Enterprise Server — and any provider other than GitLab.com and GitHub.com.
- Inferring, detecting or storing a repository's build, test or lint commands.
- A verification stage belonging to the system; verification exists only as a step an author adds.
- Editing screens by hand inside the application; screens are produced by the design step and
  changed only by running it again.
- Conditions other than whether the ticket changes the interface.
