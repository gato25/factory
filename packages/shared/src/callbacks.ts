/** The twelve events in contracts/orchestrator.md §3. */
export type CallbackEvent =
  | 'started'
  | 'step_started'
  | 'step_finished'
  | 'step_skipped'
  | 'ticket_classified'
  | 'waiting_approval'
  | 'paused'
  | 'log_chunk'
  | 'mr_opened'
  | 'done'
  | 'failed'
  | 'cancelled';

export const CALLBACK_EVENTS: readonly CallbackEvent[] = [
  'started',
  'step_started',
  'step_finished',
  'step_skipped',
  'ticket_classified',
  'waiting_approval',
  'paused',
  'log_chunk',
  'mr_opened',
  'done',
  'failed',
  'cancelled',
] as const;

/** Every callback carries these; the pair (run_id, step_index) is the
 *  idempotency key — a repeat is a no-op (FR-095). */
export interface CallbackEnvelope {
  run_id: string;
  attempt: number;
  step_index: number;
  event: CallbackEvent;
}

export interface ArtifactRef {
  kind: 'document' | 'design_file' | 'screen' | 'commits' | 'merge_request';
  path: string;
  screen_name?: string;
  version: number;
}

export type CallbackPayload =
  | { event: 'started'; container_id: string }
  | { event: 'step_started' }
  | {
      event: 'step_finished';
      status: 'done' | 'failed';
      duration_s: number;
      cost_usd: string;
      engine_session_id?: string;
      summary?: string;
      artifacts: ArtifactRef[];
    }
  | { event: 'step_skipped'; condition_not_met: string }
  | { event: 'ticket_classified'; has_ui: boolean; rationale: string }
  | { event: 'waiting_approval'; resume_url: string; approvers: string[] }
  /** A pause was asked for; the step concluded and nothing further began. */
  | { event: 'paused'; resume_url: string }
  | { event: 'log_chunk'; seq: number; stream: 'stdout' | 'stderr'; text: string }
  | { event: 'mr_opened'; merge_request_url: string }
  | { event: 'done'; merge_request_url: string; cost_usd: string }
  | { event: 'failed'; step_index: number; reason: string; detail?: string }
  | { event: 'cancelled' };

export type Callback = CallbackEnvelope & CallbackPayload;

/** The four decisions a human may record at a gate (FR-060). */
export type GateDecision = 'approved' | 'changes_requested' | 'edited' | 'cancelled';

export interface ResumeRequest {
  decision: GateDecision;
  feedback?: string;
  edited_paths?: string[];
}
