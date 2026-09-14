# Specification Quality Checklist: Run a ticket's branch on a real port

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-09-14
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

## Notes

**Reviewed 2026-09-14, in one pass, after the implementation had shipped (`e26a0e3`) and the
card had been rendered at the design's 1440 px width and corrected (`c36c1d3`).** This feature was
specified and built in one sitting, so the checklist is late by the constitution's phase order and
says so rather than pretending otherwise. Pass count 16/16 after two gaps were closed in the spec:

- **Two behaviours were in code and tests with no requirement to trace to.** The console refused
  a full address typed as a path, and read a response body only up to a cap. Both are security
  properties — the first keeps the application from being used as a way of reaching arbitrary
  addresses, the second keeps a project that answers without end from exhausting it — and
  Principle I says code without a requirement is drift. FR-018 and FR-019 were added, with
  scenarios 6 and 7 under User Story 1.
- **One edge case carried an implementation detail.** "Enforced in the database rather than by the
  button" named where the rule lives. It now says "where launches are recorded".

Three edge cases were added from what the rendering showed: the execution service forgetting a
launch after a restart, the console's request line in a narrow column, and the log beside the
card keeping its own height. Each was a user-visible behaviour the code had taken a position on
without the spec saying which.

Observations recorded rather than treated as failures:

- **FR-014 says "cross-origin headers".** The term is the browser rule the requirement exists
  because of; restating it without the term ("a project that did not plan to be called from a
  page") loses what makes it testable. Kept.
- **FR-016 and the Assumptions name `package.json`, `Dockerfile`, Node, Python, Go and Rust.**
  These are shapes of the *project being run*, not of this system; the requirement is that the
  refusal names the project's own shape. The constitution permits technology names in Assumptions.
  Kept.
- **FR-017 says "as environment".** It restates a guarantee of `specs/001-code-factory-mvp`
  (the credential never written to the workspace) and is covered by that feature's existing tests.

**Coverage.** Every requirement has a scenario or an edge case:

| Requirement | Covered by |
|---|---|
| FR-001, FR-008 | US1 scenario 1; FR-001 also scenario 4 |
| FR-002 | US1 scenario 4; contract obligation |
| FR-003 | Edge case: a ticket whose run has not finished |
| FR-004 | US2 scenario 1 |
| FR-005 | US2 scenario 2 |
| FR-006 | US1 narrative and Independent Test ("a port only this machine can reach"); contract obligation |
| FR-007 | US1 scenarios 1, 4, 5; edge cases: restart, lifetime ceiling |
| FR-009 | Edge case: starts and then exits |
| FR-010 | Edge case: never listens on the port |
| FR-011 | US1 scenario 5 |
| FR-012 | Edge case: lifetime ceiling while "running" |
| FR-013 | US1 scenarios 2, 3 |
| FR-014 | US1 scenario 3; SC-004 |
| FR-015 | Edge case: two Run its on one ticket |
| FR-016 | US2 scenario 3 |
| FR-017 | Contract obligation; 001's credential tests |
| FR-018 | US1 scenario 6 |
| FR-019 | US1 scenario 7 |

**Known and not closed**: the feature has not been run against a real container daemon
([tasks.md](../tasks.md) T013), so SC-001's two minutes and SC-003's one minute are targets, not
measurements. The execution service's lifecycle is proven against a fake host and a fake readiness
check, which is what the suite can do without a daemon.

Items marked incomplete require spec updates before `/speckit-clarify` or `/speckit-plan`.
