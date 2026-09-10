/**
 * The resolved snapshot. Field names are snake_case because this crosses
 * service boundaries and must match the payloads in contracts/orchestrator.md
 * verbatim — the orchestrator and the Runner read it as sent.
 */

export type Role = 'admin' | 'member';

export type StepType = 'agent' | 'design' | 'checkpoint' | 'shell' | 'notify';

/** Every step carries a condition, defaulting to always running (FR-032a/b). */
export type StepCondition = 'always' | 'ticket_has_ui' | 'ticket_has_no_ui';

export type ApproverRule = 'anyone' | 'ticket_creator' | string[];
export type TimeoutBehaviour = 'wait' | 'continue' | 'fail';

export interface DesignStepConfig {
  source_path: string;
  export_dir: string;
  export_scale: number;
  screens?: string[];
}

export interface Step {
  type: StepType;
  condition: StepCondition;
  /** agent | design */
  agent_id?: string;
  output_files?: string[];
  design?: DesignStepConfig;
  /** checkpoint */
  approvers?: ApproverRule;
  timeout_hours?: number;
  on_timeout?: TimeoutBehaviour;
  /** shell */
  command?: string;
  /** notify */
  channel?: string;
  template?: string;
}

export interface SnapshotAgent {
  id: string;
  name: string;
  engine: 'claude_cli' | 'design_cli';
  model: string;
  system_prompt: string;
  allowed_tools: string[];
  skills: { name: string; description: string; content: string }[];
  limits: { max_cost_usd?: string; max_minutes?: number; max_turns?: number };
}

export interface PipelineSnapshot {
  run_id: string;
  attempt: number;
  ticket: {
    reference: string;
    title: string;
    description: string | null;
    acceptance_criteria: string[];
  };
  repo: {
    clone_url: string;
    default_branch: string;
    branch: string;
    provider: 'gitlab' | 'github';
    credential_ref: string;
  };
  pipeline: { id: string; version: number; name: string; steps: Step[] };
  /** Already resolved to least(agent, pipeline, workspace) — FR-079a. */
  limits: { cost_ceiling_usd: string; time_ceiling_minutes: number };
  agents: SnapshotAgent[];
  callback_url: string;
  resume_secret: string;
}

export const DEFAULT_CONDITION: StepCondition = 'always';

/** Terminal for the step alone; the run continues (FR-111). */
export const NON_TERMINAL_RUN_STATUSES = [
  'queued',
  'running',
  'waiting_approval',
  'opening_mr',
] as const;
