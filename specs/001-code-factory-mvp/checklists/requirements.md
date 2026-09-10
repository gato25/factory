# Specification Quality Checklist: Code Factory MVP

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-09-10 · **Last revised**: 2026-09-10 (design stage)
**Feature**: [spec.md](../spec.md)

**Review Ownership**: This checklist is a reviewer-owned requirements-quality review artifact. Mark an item `[x]` only when the reviewer determines the requirements-quality criterion is satisfied.
**Marker Semantics**: `[x]` means the criterion has been reviewed and satisfied for requirements quality. It does not mean implementation work is complete.

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Validation Findings

### Iteration 3 — 2026-09-10 · design stage absorbed, all items still pass

`main` gained a conditional design stage (`d5e5903`, `8e648b9`) after this spec was merged. The spec
was revised to cover it before planning, on the user's instruction.

**Seven statements that had become false, corrected**

| Requirement | Was | Now |
| --- | --- | --- |
| FR-025 | four kinds of step | five — a design step joins them |
| FR-033 | defaults cover spec, plan, tasks, implement | interface design included |
| FR-036 | one shape of agent configuration | FR-036a/b: the design engine offers its own models and no tool permissions |
| Assumptions | agent steps are Claude CLI invocations | two engines behind one step vocabulary |
| Artifact entity | document, commits, merge request | five kinds, plus a new **Screen** entity |
| FR-077 | documents, commits, MR readable | screens shown as images in a gallery |
| Input | artboards 00–13 | 00–14 |

**What was added**

- **A new user story at P5** — designing the interface before building it, with 9 acceptance
  scenarios covering classification, production, skipping, review and hand-off. Stories 5–7 moved
  down to 6–8; priorities remain P1–P8 with no gaps or duplicates.
- **Conditional steps** (FR-032a–FR-032f): every step carries a condition, evaluated when reached;
  a condition depending on a fact not yet established is refused at save time, as is a design step
  placed before the classifying step.
- **A "Designing the interface" section** (FR-099–FR-112): the classification and its reason, the
  design source and exported screens, output validation, revision rather than redraw, cost counted
  against the same ceilings, hand-off to later steps, and `skipped` as a terminal non-failing
  outcome distinguished from done, failed and not-yet-run.
- **Extensions where the stage touches existing behaviour**: the design review gate (FR-064c–e),
  change requests re-running the design step (FR-061a), screens embedded in the merge request and
  the interface label (FR-067a, FR-068a), conditional steps shown before starting and skipped steps
  shown in the run (FR-019a, FR-075a), and the design credential supplied only to runs that need it
  (FR-083a/b, FR-005a).
- **Six edge cases and three success criteria** (SC-017–SC-019).

**One risk recorded rather than smoothed over.** A ticket that really does change the interface but
whose specification step records no decision proceeds with design skipped — a warning is the only
signal. FR-102 keeps the upstream behaviour (defaulting to "no interface change" avoids wasting a
design step on a migration), and the matching edge case requires the warning to be visible on the
run itself, not buried in step output.

**Verification**: 0 clarification markers · 148 functional requirements, all unique · every FR
cross-reference resolves · 8 stories at P1–P8 · 51 acceptance scenarios · 23 edge cases ·
13 key entities · 19 success criteria · `pen.dev` named only in Assumptions, as a given constraint.

### Iteration 2 — 2026-09-10 · all items pass

The two items that failed in iteration 1 are now satisfied. The user resolved all three open
questions, and the answers were written into the spec together with their knock-on effects.

**Answers applied**

| # | Question | Answer | Requirements |
| --- | --- | --- | --- |
| 1 | Who may configure pipelines, agents and skills | Any member, each owning their own | FR-006, FR-006a–FR-006d |
| 2 | Is a self-hosted git server in scope | No — GitLab.com and GitHub.com only | FR-007, FR-014a, FR-014b |
| 3 | How a repository's test command is established | It is not; verification is a shell step an author adds | FR-055a–FR-055d |

**Knock-on effects traced and resolved**

Answer 3 removed a stage the spec had been built around, so four dependent places were corrected
rather than left inconsistent:

- **FR-092** was "return the failing tests to the implementing agent and allow it a bounded number
  of further attempts". With no system-run verification there is nothing to feed that loop, so the
  implementing agent now carries responsibility for leaving the tests passing inside its own step,
  where it already holds the tools to run them.
- **FR-028** required a pipeline's *final* step to produce code. That contradicted User Story 5,
  which adds a linter step after implementation, and would have forbidden the very verification
  step answer 3 depends on. It now requires that a pipeline *contain* a code-producing step.
- **User Story 1's independent test** and **User Story 4, scenario 5** both asserted a system
  verification stage. Both were rewritten around an author-added shell step.
- **FR-034a** was added: shipped default pipelines cannot carry a repository-specific command, so
  the system must make plain when a chosen pipeline verifies nothing. **SC-016** makes that
  visible-before-starting property measurable.

Answer 1 carried one security consequence, which is recorded rather than quietly absorbed: a member
may grant their own agents broad tool access. Three bounds are stated in **Assumptions** — ownership
confines a change to that member's own agents (FR-006c), a member-set cost or time limit cannot
exceed the workspace ceiling (**FR-079a**, added for this), and administrators keep sole control of
credentials, dependency connections and sandbox constraints (FR-004, FR-085).

**Verification performed**

- No `[NEEDS CLARIFICATION]` markers remain.
- 116 functional requirements, all uniquely identified; every FR referenced from another
  requirement resolves to a requirement that exists (no dangling cross-references).
- A scan for technology names (n8n, Docker, Kubernetes, Postgres, Redis, React, Vue, TypeScript,
  GraphQL, SQL, webhooks, REST APIs) returns nothing anywhere in the spec.
- No residual reference to the removed verification stage survives.
- Coverage: 7 prioritised, independently testable user stories · 42 acceptance scenarios ·
  18 edge cases · 12 key entities · 16 measurable success criteria.

**Recorded divergences from the source material**

All three answers move this feature away from the root `spec.md` (v0.1) and `design.pen`. The spec
carries a *Divergences from the source product specification* section naming each, so the source
documents can be reconciled deliberately:

1. Source §5.2 step 4 and §10 describe a Verify stage and a "Tests fail at Verify" failure mode.
   Neither exists now.
2. Design artboard 03 offers "Self-hosted Git" as one of three providers. That choice comes off.
3. The source data model gives pipelines, agents and skills no owner. They now have one.

### Iteration 1 — 2026-09-10 · 14 of 16 passed

Failed on *No [NEEDS CLARIFICATION] markers remain* (three remained) and, consequently, on
*Requirements are testable and unambiguous* (FR-006, FR-014a and FR-055a were not yet unambiguous;
the other 103 were). The three were left marked rather than guessed because each changed scope or
carried a security consequence and the source material did not settle it. Resolved in iteration 2.

## Notes

- Items marked incomplete require spec updates before `/speckit-clarify` or `/speckit-plan`
- `/speckit-implement` reads checklist checkbox state as a gate and must not modify markers
- This file has a built-in lifecycle maintained by `/speckit-specify` and `/speckit-clarify`
- The spec's *Divergences* section is a live to-do against the root `spec.md` and `design.pen`
