import type { ArtifactRef } from './callbacks';
import type { Step } from './snapshot';

/**
 * One interface, three implementations (contracts/step-engines.md). This is
 * what lets the orchestrator, the cost ledger and the run view treat agent,
 * design and shell steps alike (FR-025, FR-108).
 */
export interface StepContext {
  ticket: { reference: string; title: string; description: string | null; acceptance: string[] };
  repo: { name: string; branch: string; default_branch: string };
  run: { id: string; attempt: number };
  /** Present after a change request (FR-038). */
  feedback?: string;
  /** Available after the specification step has classified the ticket. */
  hasUi?: boolean;
  onLog: (chunk: { seq: number; stream: 'stdout' | 'stderr'; text: string }) => void;
}

export interface StepOutcome {
  status: 'done' | 'failed';
  /** From the engine's own reported usage, never our own estimate (D6). */
  costUsd: string;
  durationS: number;
  sessionId?: string;
  summary?: string;
  outputs: ArtifactRef[];
  /** Specification step only (FR-099). */
  classification?: { has_ui: boolean; rationale: string };
  error?: { reason: string; detail?: string };
}

export interface Workspace {
  /** Absolute path to the run's working tree inside the sandbox. */
  root: string;
}

export interface StepEngine {
  readonly name: 'claude_cli' | 'design_cli' | 'shell';
  run(step: Step, workspace: Workspace, context: StepContext): Promise<StepOutcome>;
}
