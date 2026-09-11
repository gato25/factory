# Contract: Runner ⇄ Step Engines

Three step types execute something; one internal interface covers all three, which is what lets the
orchestrator, the cost ledger and the run view treat them alike (FR-025, FR-108).

```ts
interface StepEngine {
  run(step: Step, ws: Workspace, ctx: StepContext): Promise<StepOutcome>
}
// ctx: { ticket, repo, run, feedback?, hasUi?, onLog(chunk) }
// StepOutcome: { status, costUsd, durationS, sessionId?, summary, outputs[], classification? }
```

## `claude_cli` — agent steps

Invokes the Claude Code CLI headlessly in `/work`, with JSON output so cost, session and turn counts
come back structured. The step's prompt names the files to read and the files to produce; the agent's
own configuration supplies the system prompt, model, permitted tools and turn ceiling.

Models (exact identifiers, no date suffixes):

| Default agent | Model |
| --- | --- |
| Spec | `claude-sonnet-5` |
| Plan | `claude-opus-5` |
| Tasks | `claude-sonnet-5` |
| Implement | `claude-opus-5` |

`claude-haiku-4-5` is available for custom agents. A tool the agent has not been permitted must not
be reachable (FR-039).

**The specification step additionally classifies the ticket.** Its instructions require it to end
its document with a machine-readable decision block. The Runner parses that block and returns
`classification: { has_ui, rationale }`. If the block is missing or unparseable, the Runner returns
no classification, and the app treats the ticket as not changing the interface, continues the run,
and records the warning as a field on the run (FR-102) — never silently.

**The implementing step is responsible for leaving the repository's tests passing** within its own
step, using the tools it has been permitted (FR-092). There is no verification stage of the
system's own.

## `design_cli` — design steps

Invokes the pen.dev CLI in `/work`. Writes an editable design source at the step's configured path
and exports one image per screen at the configured scale into the export directory.

- On a repeat — a change request from a gate, or a retry of the run — the existing design source is
  passed back in so the tool **revises** it rather than starting from an empty canvas
  (FR-106). This is what keeps a reviewer's earlier accepted work from being silently discarded.
- Cost comes from the tool's own reported usage and counts against the same run ceilings as any
  other step (FR-108).
- Output is streamed as log chunks exactly as an agent step's is (FR-107).
- The step fails if the design source is absent or no image was exported (FR-104).
- Tool permissions do not apply to this engine and are not offered for its agents (FR-036a).

Both the design source and the exported images are committed to the run's branch, so the design
travels with the code and a later ticket can revise it (FR-105).

## `shell` — shell steps

Runs the step's fixed command in the container. A non-zero exit fails the step, and with it the run;
the command's full output is retained (FR-055c). No preceding agent step is re-run automatically
(FR-055d) — recovery is a retry, or a human decision at a gate the author placed after it.

This is the only mechanism for verification. The system never infers or supplies a command the
pipeline did not specify (FR-055b), and no shipped default pipeline carries one, because the command
is repository-specific (FR-034a).

## Common to every engine

| Obligation | Requirement |
| --- | --- |
| Stream output as it is produced, naming the command | FR-076, FR-107 |
| Redact credentials at ingest, not at display | FR-084, SC-011 |
| Report cost from the engine's own usage | FR-108, SC-006 |
| Kill the process at a ceiling and name the ceiling as the reason | FR-081 |
| Every declared output file must exist and be non-empty | FR-051 |
| Retain partial output on failure | FR-104 |
