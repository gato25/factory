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
    /**
     * Requirement documents attached to the ticket: NAMES AND SIZES ONLY.
     *
     * The content is deliberately not here. A snapshot is stored as one value
     * for the life of a run and rewritten on every step, and on the managed
     * execution host that value lives in Durable Object storage, which caps a
     * value at 128 KiB. Several megabytes of requirements inside it would
     * break that host outright and waste the local one.
     *
     * So this is a manifest, and the execution service fetches the content
     * once at start from the application — exactly as it already fetches
     * credentials, and for a related reason: the orchestration service should
     * carry neither.
     *
     * Optional because a run started before this field existed does not have
     * it, which is a real state of the database rather than something to
     * assert away.
     */
    requirement_files?: { name: string; bytes: number }[];
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
  /**
   * What the sandbox is allowed (FR-085), resolved from the workspace at
   * start and pinned here for the same reason the ceilings are: a limit
   * changed mid-run must not reshape a container that is already running.
   *
   * It travels in the snapshot because the snapshot is the only channel
   * between the application and the Runner — the Runner cannot read a
   * workspace setting, and without this it fell back to figures compiled
   * into it, so nothing an administrator set had any effect.
   *
   * Optional because a run started before this field existed does not have
   * it, and that is a real state of the database rather than something to
   * assert away. The Runner falls back to its own defaults and says so.
   */
  sandbox?: {
    image: string;
    cpu: number;
    memory_mb: number;
    wall_clock_minutes: number;
    network_during_implement: boolean;
  };
  agents: SnapshotAgent[];
  callback_url: string;
  resume_secret: string;
}

export const DEFAULT_CONDITION: StepCondition = 'always';
