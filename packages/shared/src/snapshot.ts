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
    /**
     * What a restricted step may reach beyond the model service, the design
     * service and the run's git provider (002 FR-012a). Resolved when the run
     * starts and never consulted again, like every other ceiling here.
     *
     * Optional because a snapshot written before this field existed has none.
     * An absent list means an EMPTY one — total isolation — rather than an
     * invented default, because inventing entries for a run whose workspace
     * never chose them is the reverse of pinning (002 FR-012c).
     */
    permitted_hosts?: string[];
  };
  agents: SnapshotAgent[];
  callback_url: string;
  resume_secret: string;
}

export const DEFAULT_CONDITION: StepCondition = 'always';
