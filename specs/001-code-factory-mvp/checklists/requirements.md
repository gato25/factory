# Specification Quality Checklist: Code Factory MVP

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-09-10
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
