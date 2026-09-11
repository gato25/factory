<!--
Sync Impact Report
==================
Version change: (none) → 1.0.0 — initial ratification

The prior file was the unmodified core template: 20 placeholder tokens, no content.
Nothing was removed, because nothing had been defined.

Principles defined (all new):
  I.   Spec-Driven Delivery (NON-NEGOTIABLE)
  II.  Tested Before Merge
  III. Pipelines Are Data
  IV.  Pinned Execution
  V.   Least Privilege and Secret Hygiene

Sections added:
  Architectural Invariants                  (template slot SECTION_2)
  Development Workflow and Quality Gates    (template slot SECTION_3)
  Governance                                (populated)

Provenance:
  Principles III, IV and the Architectural Invariants are derived from the nine core
  principles stated in the repository's product specification (root spec.md §1) — repo
  evidence, not invention.
  Principle I (binding spec-driven delivery) and Principle II (tests required before
  merge, author's choice of order) were decided by the product owner during this
  amendment; neither had evidence in the repository.
  Principle V is derived from the feature specification's secret-handling requirements
  and the plan's privilege split.

Ratification date: 2026-09-10 — the date of adoption, which coincides with the
repository's first commit.

Follow-up TODOs: none. No placeholder was intentionally deferred.

Out of scope for this amendment, flagged for the author:
  specs/001-code-factory-mvp/plan.md records "the constitution is not ratified" and
  treats its Constitution Check as not applicable. That statement is now stale. This
  command's scope is this file only, so the plan was left untouched.
-->

# Code Factory Constitution

## Core Principles

### I. Spec-Driven Delivery (NON-NEGOTIABLE)

Every change MUST trace to a numbered functional requirement in its feature's specification, or
to a decision recorded in that feature's plan. Behaviour that no requirement authorises MUST NOT
be built: amend the specification first, then build. Divergence between a specification and its
source material MUST be recorded explicitly in that specification, never left silent. Drift
between specification and code is a defect and MUST be tracked as one.

**Rationale**: the requirements are this project's only executable description of intent — there
is no legacy code to read instead. Drift has already happened once here, when a conditional design
stage entered the product while the feature specification still described a four-step pipeline. It
was caught only because the specification was treated as authoritative. Making that binding is
what keeps it working.

### II. Tested Before Merge

Every functional requirement MUST ship with tests that demonstrate it. The interfaces named in a
feature's `contracts/` MUST have contract tests. Behaviour spanning services MUST have integration
tests running against real dependencies, not fakes. Each user story's Independent Test MUST exist
as one end-to-end test. Nothing merges while tests for the requirements it claims are absent or
failing.

The order in which tests and implementation are written is the author's choice. Test-first is
encouraged and never required.

**Rationale**: this product's output is code written by agents, so our own tests are the only thing
that tells us the machinery producing it works. Mandating the order would double every task without
strengthening the guarantee that matters — that the requirement is demonstrated.

### III. Pipelines Are Data

A pipeline MUST be an ordered list of steps held as data and edited by users. No step order, no
step meaning, and no agent behaviour may be hard-coded in the orchestrator or the application. The
orchestrator MUST branch only on a step's declared type and condition. Adding a kind of step MUST
NOT require editing the orchestration workflow.

**Rationale**: stated in the product specification. It is what lets a team change how much human
oversight a repository gets without a deploy, and what keeps one generic workflow serving every
pipeline.

### IV. Pinned Execution

Configuration MUST be resolved into a single snapshot when a run starts, and MUST NOT be consulted
again for the life of that run. A saved pipeline version MUST be immutable. Editing a pipeline, an
agent or a skill MUST change the behaviour of zero runs in flight. A run MUST remain reproducible
after the configuration that produced it has moved on.

**Rationale**: any member may create and change their own agents without asking an administrator.
Without pinning, that freedom would silently corrupt other people's running work — so the freedom
and the pinning are the same decision.

### V. Least Privilege and Secret Hygiene

Only the component that owns run execution may hold rights on the container host; no
public-facing component may create containers. Credentials MUST be encrypted at rest, supplied to
a run as environment, never written into a repository workspace, and never persisted in the
orchestrator. Credentials MUST be redacted where output is ingested, not where it is displayed. No
credential may appear in any retained output, document, screen, or merge request description, and
none may be read back in full through any interface.

**Rationale**: agents execute code against customer repositories holding push rights. Redacting at
ingest rather than at display means a later change to a viewer cannot un-redact history that has
already been stored.

## Architectural Invariants

These follow from the product specification and hold across every feature. Changing any of them is
a MAJOR amendment.

- A ticket belongs to exactly one repository and has at most one active run.
- The application stores and renders; the orchestrator sequences and waits. Neither takes on the
  other's job.
- One fresh container per run: non-root, bounded in processing power, memory and lifetime,
  released when the run ends, never reused.
- Steps hand off through files in the run's workspace, so each step reads what earlier steps wrote.
- A step may carry a condition. A condition not met yields `skipped`, which is terminal for that
  step alone and never fails the run.
- Interface work is designed, and the design is reviewable, before any code is planned or written.
- The system opens merge requests and never merges them. Merging is a human act on the provider.
- Limits are enforced by cost and concurrency ceilings, never by counting tickets.
- Verification is a step a pipeline author adds. The system runs no checks of its own and never
  infers a repository's build, test or lint commands.
- Exactly two git providers exist: GitLab.com and GitHub.com.

## Development Workflow and Quality Gates

**Phase order.** `/speckit-specify` → `/speckit-clarify` → `/speckit-plan` → `/speckit-tasks` →
`/speckit-implement`. A phase MUST NOT begin before its predecessor's artifacts exist.

**Gates that block the next phase:**

- A feature's requirements checklist MUST pass before planning begins.
- Every requirement MUST be assigned to a delivery phase before tasks are generated. An orphaned
  requirement is a planning defect, not an oversight to be found later.
- Every requirement cross-reference MUST resolve. Citing an identifier that does not exist fails
  the gate.
- Open questions MUST be resolved or explicitly deferred with a stated reason. A specification
  carries at most three at a time.

**How requirements are written:**

- Requirements MUST describe observable behaviour. Technology names belong in Assumptions,
  Dependencies, or the plan — never in a requirement.
- Success criteria MUST be measurable and technology-agnostic.
- A requirement MUST be testable as written. One that is not MUST be reworded until it is.

**Structure and process:**

- Complexity beyond a single project MUST be justified in the plan's Complexity Tracking, naming
  the simpler alternative and why it was rejected.
- Work happens on a feature branch. A merged branch is finished and MUST NOT carry new work.
- A risk that is understood but accepted MUST be recorded where the decision lives, not omitted
  because it is inconvenient.

## Governance

This constitution supersedes other practices. Where it conflicts with a plan, a template, or a
habit, this document wins.

**Amendments** are proposed as a change to this file and MUST carry a Sync Impact Report stating
the version change, what moved, and the provenance of anything newly asserted.

**Versioning** follows semantic versioning over governance, not code:

- **MAJOR** — a principle or architectural invariant is removed or redefined.
- **MINOR** — a principle or section is added, or existing guidance is materially expanded.
- **PATCH** — clarification, wording, or a correction that changes no obligation.

**Compliance.** Every plan MUST carry a Constitution Check naming, for each principle, how it is
honoured or why it does not apply. A violation MUST be either fixed or justified in Complexity
Tracking; it MUST NOT be left unmentioned. A principle that cannot be checked MUST be reworded
until it can.

Runtime development guidance — stack, structure, interface contracts — lives in each feature's
`plan.md` and `contracts/`, not here. This file holds only what must not vary between features.

**Version**: 1.0.0 | **Ratified**: 2026-09-10 | **Last Amended**: 2026-09-10
