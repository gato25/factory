# Feature Specification: Run a ticket's branch on a real port

**Feature Branch**: `003-launch-branch`

**Created**: 2026-09-13

**Status**: Accepted

**Last revised**: 2026-09-14 — after the card was rendered at the design's width and reviewed.
FR-018 and FR-019, two acceptance scenarios and three edge cases were added; one edge case lost an
implementation detail. The review is recorded in [checklists/requirements.md](./checklists/requirements.md).

**Input**: User description: "I want to run projects — clicking a Start button, then it starts on a real port. If it has a UI, show the live page; if not, a Postman-like thing."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See the implementation running (Priority: P1)

A run has finished and a merge request is open. Before reviewing the diff, the person presses
**Run it** on the ticket. The project on that branch starts in a fresh sandbox on a port only this
machine can reach. When the ticket changes the interface, the running page appears on the ticket
itself; when it does not, a request console appears instead, where a request can be composed and
sent and the response read. Pressing **Stop** ends it; walking away ends it too.

**Why this priority**: A merge request is a diff. Whether the change *works* is a different
question, and today the only way to answer it is to check the branch out by hand. This is the
feature the pipeline was missing between "implemented" and "reviewed".

**Independent Test**: With a connected repository whose branch holds a Node project with a `dev`
script, press Run it on a finished ticket; within two minutes the ticket shows an address that
answers HTTP; press Stop and the address stops answering.

**Acceptance Scenarios**:

1. **Given** a ticket whose run has finished and whose branch was pushed, **When** Run it is
   pressed, **Then** the ticket shows "Starting…" with the project's own output as it installs and
   starts, and then a reachable address.
2. **Given** a running launch on a ticket the specification step classified as changing the
   interface, **When** the ticket is viewed, **Then** the running page is shown on the ticket, with
   a way to open it in its own tab.
3. **Given** a running launch on a ticket classified as not changing the interface, **When** the
   ticket is viewed, **Then** a request console is shown: method, path, headers and body in;
   status, time, headers and body out.
4. **Given** a running launch, **When** Stop is pressed, **Then** the container is destroyed, the
   address stops answering, and the ticket says so.
5. **Given** a running launch nobody has looked at for the idle period, **When** the period
   passes, **Then** it is stopped without anybody pressing anything, and the ticket says why.
6. **Given** a running launch, **When** a full address is typed where the console expects a path,
   **Then** it is refused with a message saying to type a path, and nothing is sent.
7. **Given** a running launch whose answer is larger than the console shows, **When** the request
   is sent, **Then** the first part is shown with a note that it was cut short, and the rest is
   not read.

---

### User Story 2 - Tell a repository how it starts (Priority: P2)

The first Run it on a repository guesses the command from what the project says about itself.
When the guess is wrong, or when the project is something the guess cannot know, the person sets
the command and port once on the repository, and every later launch uses that.

**Why this priority**: A wrong guess must cost one edit, not a failed start every time. Without the
override, the feature works only for projects the guesser already understands.

**Independent Test**: Set a start command and port on a repository, press Run it on one of its
tickets, and observe that command in the launch's record and its output.

**Acceptance Scenarios**:

1. **Given** a repository with no start command set, **When** a launch begins, **Then** the command
   is detected from the workspace and the ticket names where the guess came from.
2. **Given** a repository with a start command set, **When** a launch begins, **Then** that command
   runs and no detection happens.
3. **Given** a workspace the guesser cannot read — no `dev` or `start` script, or a project in a
   language the sandbox image cannot run — **When** a launch begins, **Then** it fails at once,
   names the reason in the project's own terms, and points at where to set a command.

---

### Edge Cases

- A ticket whose run has not finished, or whose branch was never pushed, cannot be launched; the
  button says why rather than being absent.
- A project whose server binds `localhost` inside the container is unreachable from outside it
  however faithfully the port is published. Every detected command carries the flag its framework
  needs to bind every interface, and the generic command says in a note what the project must do.
- Installing dependencies can take minutes. The launch reports "Starting…" immediately and streams
  the project's own output; it does not hold a request open for the duration.
- The project starts and then exits — a crash on boot. The launch fails with the output rather
  than waiting the full start period for an address that will never answer.
- The project starts but never listens on the port it was told. After the start period the launch
  fails and says which port it waited on.
- Two Run its on one ticket: the second is refused while the first is not stopped. One ticket, at
  most one live launch, enforced where launches are recorded rather than by the button.
- The execution service restarts and forgets a launch it was running. The next look reports it
  stopped and names the restart, rather than showing a running launch that no longer exists.
- The ticket's column is narrow. The console shows the launch's address once, on the card, and
  its request line holds method, path and Send, so the path stays typeable.
- The card makes the ticket's right-hand column taller than the log beside it. The log keeps its
  own height rather than stretching to match, and stays in view while the column scrolls.
- The launch's container reaches the sandbox lifetime ceiling while still "running": the next look
  at it reports it stopped and says the lifetime is why.
- Only text answers are shown in the console; a binary body is described by size and type, not
  rendered.
- The execution service cannot be reached: the launch fails naming the execution service, not the
  project.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A person MUST be able to start a ticket's pushed branch running from the ticket, and
  stop it from the same place.
- **FR-002**: A launch MUST run in a fresh sandbox of its own, never in a run's sandbox and never
  reused, and MUST be destroyed when stopped.
- **FR-003**: Start MUST be available only once the ticket's run has finished successfully and its
  branch exists; otherwise the control MUST say what is missing.
- **FR-004**: When the repository has no start command set, the launch MUST detect one from the
  project's own files and MUST name where the guess came from.
- **FR-005**: A repository MAY carry a start command and a port; when set, they MUST be used and
  detection MUST NOT run.
- **FR-006**: A launch's port MUST be reachable only from the machine the execution service runs
  on; it MUST NOT be published on every interface.
- **FR-007**: A launch MUST report a distinguishable state at every moment: starting, running with
  an address, failed with a reason, or stopped with a reason.
- **FR-008**: While starting, the project's own output MUST be visible on the ticket as it is
  produced.
- **FR-009**: A launch whose project exits before listening MUST fail with that output, not wait
  for the start period to elapse.
- **FR-010**: A launch that does not answer on its port within the start period MUST fail naming
  the port waited on.
- **FR-011**: A launch nobody has looked at for the idle period MUST be stopped automatically, and
  the ticket MUST say that idleness is why.
- **FR-012**: A launch MUST inherit the workspace's sandbox lifetime ceiling as a hard cap,
  enforced by the execution host, so that nothing that forgets a launch can leave it running.
- **FR-013**: When the ticket is classified as changing the interface, the running page MUST be
  shown on the ticket; otherwise a request console MUST be shown. A person MUST be able to switch
  between the two regardless of the classification.
- **FR-014**: The request console MUST send the composed request from the application, not from
  the browser, so a project that sets no cross-origin headers can still be exercised.
- **FR-015**: A ticket MUST have at most one live launch at a time.
- **FR-016**: Detection MUST refuse, with the project's own shape named, when the workspace says
  nothing this can run: no start script, a Dockerfile, or a language the sandbox image lacks.
- **FR-017**: The repository credential MUST reach the launch's sandbox as environment, never
  written into its workspace, exactly as it reaches a run.
- **FR-018**: The request console MUST send only to the launch's own address. A path that is a
  full address MUST be refused before anything is sent, so the console cannot be turned into a way
  of reaching anything else from the application.
- **FR-019**: The console MUST show at most a bounded amount of a response body, MUST say when it
  has cut one short, and MUST stop reading beyond that amount, so a project that answers without
  end cannot exhaust the application.

### Key Entities

- **Launch**: one attempt to run one ticket's branch. Belongs to a ticket and a repository; knows
  the branch, the command that actually ran, its state, its address while running, why it ended,
  who started it and when it stopped.
- **Repository run settings**: an optional command and port on a repository, overriding detection.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For a Node project with a `dev` script, a launch reaches a reachable address within
  two minutes of pressing Run it on a warm image, with no configuration.
- **SC-002**: Every failed launch names a cause a person can act on — a missing script, a language
  the sandbox lacks, a port nothing listened on, a crash's own output — never "failed".
- **SC-003**: Pressing Stop, or idleness, releases the container within one minute; no launch
  outlives the sandbox lifetime ceiling.
- **SC-004**: A request sent from the console to a running API returns its status, headers and
  body on the ticket without the project needing any cross-origin configuration.

## Assumptions

- Launches are for the person at the machine the execution service runs on; that is where the
  port is bound. Reaching a launch from another machine is out of scope.
- The shipped sandbox image runs Node projects. Python, Go, Rust and Dockerfile-based projects are
  recognised so the refusal can name them, and are out of scope to run.
- Detection understands `package.json` and the common dev servers' address flags. Anything else is
  the repository setting's job.
- The idle period is 30 minutes and the start period is two minutes; both are constants until
  somebody needs otherwise.
- A launch runs the branch as pushed. It does not run a checkpoint's uncommitted workspace; that is
  a later feature.
- The console shows up to 256 KB of a response body and waits up to 15 seconds for an answer;
  both are constants until somebody needs otherwise.
- The address a browser opens is the execution service's host name from Settings together with
  the launch's port. The person's browser is assumed to reach that name, which is true when both
  run on one machine.
