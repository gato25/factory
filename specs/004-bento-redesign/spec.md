# Feature Specification: Bento redesign of every screen

**Feature Branch**: `004-bento-redesign`

**Created**: 2026-09-28

**Status**: Draft

**Input**: User description: "Bento redesign of every application screen to the approved design in
design.pen (artboards 00–14 plus the UI kit pages "Kit · 00–12"). The frame changes from a white left
sidebar to a floating top navigation … Every screen is rebuilt in the bento visual language … the
tangerine palette … with text sizes suitable for a projector in a lit room … No behaviour of runs,
pipelines or approvals changes; the only new data are the three dashboard figures (first-attempt
rate, merge requests per day for 7 days, today's cost). The design-to-source fidelity check must be
brought up to date with the Mongolian copy."

## Context

The product is being presented to an audience on a projector, in a lit room, as the entry for an
internal award. The screens were redrawn in `design.pen` for that: every artboard 00–14 was rebuilt,
and a UI kit (pages `Kit · 00` to `Kit · 12`) now names every colour, size and component the screens
use. The screens that people actually use still show the previous design. This feature makes them
match the approved design, screen by screen, without changing what any screen *does* — with one
deliberate exception: the dashboard's first row of figures is replaced by three figures the
application has not shown before.

Two things drive the visual rules below and are not matters of taste. A projector roughly halves
contrast, so pale tints disappear, soft shadows vanish and small grey text becomes unreadable. And
the product's selling point is that a design drawn in the design service is built exactly by the
agents — so the screens that show design work (the design step, the design review) must make that
visible.

## Clarifications

### Session 2026-09-28

- Q: What should the dashboard's first-attempt figure count? → A: exactly what the existing
  first-attempt audit counts — tickets created in the last 30 days that have acceptance criteria and
  a known outcome; a success is a merge request reached on attempt 1 with no artifact of that attempt
  edited by a person.
- Q: The tinted tiles (the approval tile, the done and failed columns) are not lighter than the
  ground — how does FR-004 hold for them? → A: a tinted tile stands apart by its colour, measured as a
  colour difference of at least 10 (ΔE) from the ground; the 1.1:1 lightness rule is for neutral tiles.
- Q: White text on the bright accent, red, pen.dev-blue and green gradients measures 1.9–2.4:1, under
  FR-008 — how is it fixed? → A: the filled surfaces that carry white text (primary, danger and pen.dev
  buttons, numbered steps, the sign-in hero) take deeper versions of the same gradients, clearing 4.5:1;
  dots, bars, orbs and tints keep the bright tangerine. Text in a state's colour on its own tint uses a
  darker text variant of that colour.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See at a glance what the factory is doing and what needs me (Priority: P1)

A person opens the dashboard. Without scrolling they see every ticket that is moving, grouped by
what state it is in, each one showing how far through *its own* pipeline it is and, in words, what
is happening to it now. Beside that list they see what is waiting for their approval, how often runs
succeed on their first attempt, and how many merge requests were opened this week and what today
cost.

**Why this priority**: the dashboard is the first thing the audience sees and the page a team lives
on. It is also the only screen that gains new information.

**Independent Test**: With tickets in each state (running, waiting for approval, failed, queued,
recently finished) and a history of finished runs, open the dashboard; every ticket appears under
the right heading with a step bar of the right length, and the three figures match the run records.

**Acceptance Scenarios**:

1. **Given** tickets running, waiting for approval, failed, queued and recently finished, **When**
   the dashboard opens, **Then** they appear under four headings — in progress (running and waiting),
   needs attention (failed), queued, done — each heading with its count.
2. **Given** two running tickets whose pipelines have three and six steps, **When** the dashboard
   shows them, **Then** their step bars have three and six segments, the current step is marked, and
   each row states the step in words with how long it has been running.
3. **Given** tickets created in the last 30 days with acceptance criteria and a known outcome, some of
   which needed a second attempt and one whose first-attempt plan a person edited, **When** the
   dashboard opens, **Then** the first-attempt figure is the share of those tickets that reached a
   merge request on attempt 1 with no human edit, shown with the number of tickets it was computed
   from.
4. **Given** no ticket in the last 30 days with a known outcome, **When** the dashboard opens,
   **Then** the first-attempt figure says there is nothing to measure yet instead of showing 0%.
5. **Given** merge requests opened on several of the last seven days, **When** the dashboard opens,
   **Then** a bar per day shows how many, today is marked, the week's total is shown, and today's
   total cost is shown beside it.
6. **Given** a run that changes state while the dashboard is open, **When** its callback arrives,
   **Then** the list, the approvals and the figures update without a reload.
7. **Given** a workspace that is not yet set up, **When** the dashboard opens, **Then** it still says
   what is missing and where to fix it, above everything else.

---

### User Story 2 - Move around the product through the new frame (Priority: P1)

Every screen except sign-in opens with one floating top bar: the product mark, the six sections,
search, the one primary action to create a ticket, settings and the person's avatar. The section the
person is in is marked, including on pages inside it.

**Why this priority**: the frame is on every screen; until it exists no other screen can match its
artboard.

**Independent Test**: Visit one page of every section and one nested page (a ticket, an agent, a
pipeline); the right entry is marked each time, and every entry leads where it says.

**Acceptance Scenarios**:

1. **Given** any signed-in page, **When** it is shown, **Then** there is no left sidebar and the top
   bar holds the mark, Dashboard, Tickets, Repositories, Pipelines, Agents, Skills, search, the create
   action, settings and the avatar.
2. **Given** a ticket's run page, **When** it is shown, **Then** Tickets is marked as current.
3. **Given** the settings page, **When** it is shown, **Then** the settings entry is marked and no
   section is.
4. **Given** text typed into search and submitted, **When** the board opens, **Then** it is filtered
   by that text, as it is today.
5. **Given** keyboard-only use, **When** tabbing through the top bar, **Then** every entry is reachable
   in order and its focus is visible.

---

### User Story 3 - Read every screen on a projector in a lit room (Priority: P1)

The audience sits at the back of a lit room. They can read the text on every screen, tell tiles
apart from the page behind them, and tell what state something is in without having to distinguish
two similar colours.

**Why this priority**: the redesign exists for this presentation; a screen that cannot be read from
the room fails it regardless of how it looks up close.

**Independent Test**: Measure every screen: no text below the minimum size, every text colour meets
the contrast minimum on the surface it sits on, and every tile is distinguishable from the ground
without its shadow.

**Acceptance Scenarios**:

1. **Given** any screen, **When** its text is measured, **Then** nothing is smaller than 12px and
   primary content (titles of things, list rows, body copy) is at least 14px.
2. **Given** any text on any surface, **When** its contrast is measured, **Then** it is at least 4.5:1,
   or 3:1 for text of 20px and above.
3. **Given** any tile on the page ground, **When** shadows are ignored, **Then** the tile still stands
   apart from it — lighter if neutral, by its colour if tinted.
4. **Given** any state shown by colour, **When** the screen is viewed, **Then** the state is also
   written in words beside it.

---

### User Story 4 - Follow a ticket through its own pipeline everywhere (Priority: P2)

Pipelines differ: one repository uses a three-step quick fix, another an eight-step reviewed
pipeline. Wherever a ticket's progress is drawn — the dashboard, the board, the run page, the
creation form — it is drawn against that ticket's own pipeline, and the same colour always means the
same thing.

**Why this priority**: a fixed four- or six-segment bar misrepresents most pipelines; this was the
reason the previous dashboard concept was rejected.

**Independent Test**: Create tickets on pipelines of three, six and eight steps; each surface draws
three, six and eight segments, and a checkpoint step reads as waiting for a person, not as work.

**Acceptance Scenarios**:

1. **Given** a ticket on an eight-step pipeline waiting at its second checkpoint, **When** it appears
   on the board and the dashboard, **Then** its bar has eight segments and the current one is drawn in
   the approval colour with "waiting for your approval" in words.
2. **Given** a design step that was skipped because the ticket does not change the interface, **When**
   the run page shows the step track, **Then** that step is shown as skipped with its reason.
3. **Given** the creation form, **When** a pipeline is chosen, **Then** each choice shows its own step
   count and "what will happen" lists exactly that pipeline's steps, conditional ones marked as such.

---

### User Story 5 - Review design work before any code is written (Priority: P2)

When a ticket changes the interface, its design is drawn in the design service and a person reviews
the exported screens before planning continues. The review screen makes clear that this is design
work, shows every screen large, and offers the design source itself.

**Why this priority**: it is the product's selling point — a design that the agents then build
exactly — and the audience must be able to see it.

**Independent Test**: Reach the design checkpoint of a UI ticket; the page shows the checkpoint
banner, every exported screen, why the ticket was designed, the acceptance criteria and an action
that opens the committed design source.

**Acceptance Scenarios**:

1. **Given** a run waiting at a checkpoint after a design step, **When** the review opens, **Then** it
   states that no code has been written yet and offers approve, request changes and cancel, exactly as
   today.
2. **Given** the same review, **When** the person chooses to open the design source, **Then** the
   committed design file opens on the provider, as today.

---

### User Story 6 - Manage repositories, pipelines, agents, skills and settings in the new layout (Priority: P3)

Every management screen keeps what it does and gains the new layout: repositories as tiles, the
pipeline as colour-coded step cards, agents as tiles naming the engine they run on, skills and the
agent's instructions in a code surface, settings as a menu and sections. The settings section for
the orchestration service that no longer exists is replaced by the execution service's own.

**Why this priority**: these screens are used less often and are not the focus of the presentation,
but a product with half its screens in the old design would look unfinished.

**Independent Test**: Walk every action on screens 02, 03, 08–12 (connect, set how it starts,
reorder a step, edit an agent, edit a skill, test connections) and confirm each still works and each
screen matches its artboard.

**Acceptance Scenarios**:

1. **Given** a repository whose access token has expired, **When** repositories are listed, **Then**
   its tile is marked as needing attention and offers replacing the token directly.
2. **Given** the settings page, **When** it is shown, **Then** it has a section for the execution
   service (its address, a masked token, the callback address, a connection check) and none for an
   orchestration service.
3. **Given** the pipeline builder, **When** it shows a pipeline, **Then** agent steps, checkpoints,
   design steps, custom agents, shell and notify steps are told apart by colour and label.

---

### User Story 7 - Keep the design the source of truth (Priority: P3)

The copy on each screen is bound to its artboard by an automated check. The check describes the
Mongolian design as it now is, so a later change to either side that makes them disagree fails.

**Why this priority**: without it, the screens and the design drift apart again, which is exactly the
defect this feature removes.

**Independent Test**: Run the fidelity check; it passes. Change one fixed phrase on a screen only;
it fails and names the screen and phrase.

**Acceptance Scenarios**:

1. **Given** the implemented screens and the design, **When** the fidelity check runs, **Then** every
   fixed phrase of every screen is found in both.
2. **Given** a phrase removed from a screen but not from its artboard, **When** the check runs,
   **Then** it fails naming that screen and phrase.

### Edge Cases

- A ticket whose run has no pipeline snapshot yet (queued, never started): its bar is drawn from the
  pipeline it will use, with no step marked current.
- A pipeline changed after a ticket started: the ticket's bar follows the version its run pinned,
  not the current one.
- A long ticket title, repository or pipeline name: it wraps or truncates with the full text
  available on hover; it never overlaps the step bar or the status.
- Many tickets in one state: the dashboard shows the most relevant first and states how many more
  there are, with a link to the board.
- A day with no merge requests: its bar is drawn at zero height, not omitted.
- A run whose cost was not reported (killed before its engine reported usage): today's figure is
  labelled as the recorded cost and adds nothing for it; the run page keeps saying, as it already
  does, that its cost is missing.
- A run waiting for approval appears once in the approvals, however many people may approve it.
- A browser window narrower than the design: tiles stack rather than overflow, and no text falls
  below the minimum size.
- English catalogue selected: every new string has an English form; nothing shows a missing key.
- A deployment installed before its catalogue was Mongolian holds its defaults under their English
  names: they are still shown in Mongolian (FR-028), and installing defaults again matches them as
  before, so nothing is duplicated.

## Requirements *(mandatory)*

### Functional Requirements

**Frame**

- **FR-001**: Every signed-in screen MUST open with one top navigation bar containing the product
  mark, links to Dashboard, Tickets, Repositories, Pipelines, Agents and Skills, a search field, one
  primary action to create a ticket, an entry to settings and the signed-in person's avatar. There
  MUST be no left sidebar.
- **FR-002**: The navigation MUST mark the current section, including on pages nested under it, and
  MUST mark the settings entry on settings pages.
- **FR-003**: Search MUST keep its current behaviour: submitting it opens the tickets board filtered
  by the text.

**Visual language**

- **FR-004**: Content MUST be grouped into tiles that stand apart from the page ground even with
  shadows ignored: a neutral tile by being lighter (a contrast of at least 1.1:1 between tile and
  ground), a tinted tile — the approval tile, a board column for done or failed — by its colour (a
  colour difference ΔE of at least 10 from the ground).
- **FR-005**: Each colour MUST keep one meaning on every screen: the accent for work in progress and
  primary actions; golden yellow for waiting on a person's approval; green for finished or connected;
  red for failed or needing attention; blue for work done in the design service.
- **FR-006**: Every state shown by colour MUST also be stated in words next to it.

**Legibility**

- **FR-007**: No text on any screen MUST be smaller than 12px, and primary content — names of things,
  list rows, body text, form values — MUST be at least 14px.
- **FR-008**: Text MUST have a contrast of at least 4.5:1 against its surface, or 3:1 when it is 20px
  or larger.

**Dashboard (01)**

- **FR-009**: The dashboard MUST list current tickets under four headings with counts: in progress
  (running or waiting for approval), needs attention (failed), queued, and done (finished in the last
  7 days).
- **FR-010**: Each ticket in that list MUST show its title, reference, repository, pipeline name, a
  step bar with one segment per step of the pipeline its run pinned, its position as "current of
  total", and its state in words — with elapsed time while running.
- **FR-011**: The dashboard MUST show every run waiting for a person's approval, as it does today
  (001 FR-059), each with a direct action to review it.
- **FR-012**: The dashboard MUST show the first-attempt success rate, counted as the existing
  first-attempt audit counts it: of the tickets created in the last 30 days that have acceptance
  criteria and whose outcome is known (not queued, running or waiting), the share that reached a merge
  request on attempt 1 with no artifact of that attempt edited by a person — shown with the number of
  tickets counted. When no ticket qualifies, it MUST say there is nothing to measure yet.
- **FR-013**: The dashboard MUST show merge requests opened on each of the last 7 days, with today
  marked and the 7-day total, and today's total recorded cost.
- **FR-014**: The dashboard MUST update live as runs change, and MUST keep the notice that names what
  is missing when the workspace is not set up.

**Repositories (02, 03)**

- **FR-015**: Each repository MUST be shown as a tile with its name, path, provider, connection state
  in words, default branch, default pipeline, the latest ticket worked on and when, and its active and
  done ticket counts. Every existing repository action MUST remain reachable from the tile.
- **FR-016**: A repository whose token has expired MUST be marked as needing attention and MUST offer
  replacing the token from its tile.
- **FR-017**: Connecting a repository MUST keep its four numbered steps and behaviour, presented as a
  dialog over the repositories page.

**Tickets (04, 05, 06, 07, 14)**

- **FR-018**: The board MUST show five columns — queued, running, waiting approval, done, failed — each
  with a count; each card MUST show reference, creator, title, repository and pipeline, a step bar
  sized to the ticket's pipeline, and its state in words.
- **FR-019**: The creation form MUST show each pipeline choice with its number of steps, and "what will
  happen" MUST list the chosen pipeline's steps with each step's agent and engine, conditional steps
  marked with their condition.
- **FR-020**: The run page MUST show a step track of the run's own pipeline — done, running, upcoming or
  skipped with its reason, with durations — the live log, and the results produced. Run details
  (pipeline, attempt, environment, budget used of cap) MUST be available on the run page without an
  orchestration-service link.
- **FR-021**: The approval checkpoint and the design review MUST keep their actions and behaviour; the
  design review MUST state that it is design work, show every exported screen, the reason the ticket
  was designed and the acceptance criteria, and offer opening the committed design source.

**Management (08–12)**

- **FR-022**: The pipeline builder MUST distinguish agent, checkpoint, design, custom agent, shell and
  notify steps by colour and label, and keep reordering and inserting steps.
- **FR-023**: Agents MUST be shown as tiles naming the engine each runs on; the agent editor and the
  skill editor MUST keep their fields and actions.
- **FR-024**: Settings MUST present the execution service — its address, a masked credential, the
  callback address and a connection check — in place of the orchestration-service section, and keep
  the sandbox and design-service sections.

**Consistency and truth**

- **FR-025**: No behaviour of runs, pipelines, approvals, repositories, agents, skills, settings or
  sign-in may change; only presentation and the three dashboard figures of FR-012 and FR-013 are new.
- **FR-026**: Every new or changed piece of copy MUST exist in both the Mongolian and English
  catalogues.
- **FR-027**: The automated check binding each screen's fixed copy to its artboard MUST describe the
  current Mongolian design and pass.
- **FR-028**: The shipped default agents and pipelines MUST be shown under their names in the
  deployment's language wherever a name of theirs appears (the design's "Тодорхойлолт", "Стандарт"),
  and a running default step MUST be described by its own phrase ("Хөгжүүлж байна"). A name a person
  gave — a custom agent, a renamed default — is shown as given. Nothing stored is renamed.

### Key Entities

- **First-attempt rate (derived)**: over a 30-day window of ticket creation, the tickets with
  acceptance criteria and a known outcome, and those among them that reached a merge request on
  attempt 1 with no human-edited artifact. Computed from existing ticket, run and artifact records;
  nothing new is stored.
- **Merge requests per day (derived)**: for each of the last 7 days, the number of merge requests
  opened; computed from existing run records.
- **Today's cost (derived)**: the sum of the costs of the steps that finished today, across all runs,
  as recorded — an unreported cost contributes nothing.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 4 of 5 people shown the dashboard for the first time can say, within 5 seconds, which
  tickets need them.
- **SC-002**: 100% of text on every screen meets the size minimum of FR-007 and the contrast minimum
  of FR-008, verified by measurement.
- **SC-003**: Viewed through a projector in a lit room from 6 metres, 3 of 3 viewers can read every
  ticket title and state on the dashboard, the board and the run page.
- **SC-004**: The first-attempt figure on the dashboard equals the value the existing first-attempt
  audit reports for the same 30-day window when the audit is run without manual exclusions.
- **SC-005**: Every behaviour test that passed before this feature still passes, except tests that
  asserted visual elements this feature removes, each of which is replaced by a test of its successor.
- **SC-006**: The fidelity check passes with every screen covered, and fails when any one fixed phrase
  is removed from a screen alone.
- **SC-007**: A reviewer comparing each implemented screen with its artboard finds the same tiles in
  the same order, the same copy and the same colour meanings on all 14 screens.

## Assumptions

- `design.pen` is the source of truth for layout, copy and colour; the UI kit pages `Kit · 00`–`Kit · 12`
  and the colour tokens it names are what the stylesheet follows. The token layer is already mirrored
  into the application's stylesheet and checked by the existing token test.
- The heading face (Inter Tight) is self-hosted with the Cyrillic-extended subset, so Mongolian Ө and Ү
  render in it. The body face gains the same subset as part of this feature: Mongolian Ө, ө, Ү and ү
  appear in almost every label, and without it they render in a fallback face, which on a projector
  reads as broken type.
- Text sizes and text colours in `design.pen` are corrected where they fall below FR-007 or FR-008, so
  that the design and the screens agree; this is part of the feature, not a divergence. (Done: every
  one of the design's 2,097 texts is at least 12px and meets the contrast minimum on its surface.)
- "Today" and "the last 7 days" are counted in the server's time zone.
- The recent-activity feed and the four stat tiles leave the dashboard; the activity of a single run
  remains on its run page and approval page. Connected-repository counts remain on the repositories
  page.
- Artboard 13 (system architecture) and artboard 15 (agent-output reference) are design references,
  not screens; they are updated in the design only.
- The presentation targets a desktop browser at 1440px width; narrower windows must remain usable but
  are not styled beyond stacking.

## Divergence from the product specification

**Superseded requirements of 001.** Two requirements of `specs/001-code-factory-mvp/spec.md` describe
the dashboard this feature replaces, and are superseded by it; 001 is amended to point here:

- **001 FR-071** (four counts: repositories connected, tickets running, awaiting approval, merge
  requests this week) — the running and awaiting counts become the heading counts of FR-009 and the
  approvals of FR-011; merge requests this week become the 7-day chart and total of FR-013; the count
  of connected repositories moves to the repositories page, where FR-015 shows every repository.
- **001 FR-073** (a workspace-wide feed of recent events) — leaves the dashboard. Each run's own
  history remains on its run and approval pages, and finished work appears under "done" (FR-009).
  The clause of **001 FR-070a** that adds a finished run's outcome to that feed goes with it; the
  rest of FR-070a (mark the ticket done, record the final cost) is unchanged.

001 FR-072 (every active run with its progress) and FR-074 (live updates) are kept and refined by
FR-009, FR-010 and FR-014.

`spec.md` §4 (Screens) describes the previous design and must be amended as part of this feature, per
Constitution Principle I. The divergences are:

- The frame: a white left sidebar and a separate top bar become one floating top navigation bar.
- 01 Dashboard: the four stat tiles and the recent-activity feed are replaced by the grouped ticket
  list, the first-attempt figure and the 7-day merge-request chart with today's cost; the "four-segment
  progress bar" becomes a bar per ticket sized to its pipeline; "callbacks arrive from n8n" becomes
  callbacks from the execution service.
- 02 Repositories: a table becomes tiles, and the latest ticket worked on is added.
- 06 Ticket Run: "n8n execution id (deep link)" is removed; run details move into a tab.
- 12 Settings: the "Orchestration (n8n)" section becomes the execution-service section.
- 13 System Architecture: n8n is replaced by the execution service in the diagram description.
