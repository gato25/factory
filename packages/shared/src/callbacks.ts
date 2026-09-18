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
      /**
       * The text of the documents named in `artifacts`, by path.
       *
       * `artifacts` alone is a manifest, and a manifest is what the
       * application stored: a row per document with nothing in it, so a
       * checkpoint had nothing to review and a merge request would have
       * opened with an empty Specification. The execution service is the only
       * component that can reach the workspace, so it sends the text with the
       * outcome.
       *
       * Documents only — a screen or a design source is binary and is not
       * carried here. Redacted where it is read, never where it is shown
       * (Principle V, FR-084). Absent from a step that produced no document,
       * and from a run started before this field existed.
       */
      artifact_contents?: Record<string, string>;
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
  /**
   * What the person wrote, by path, for each of `edited_paths`.
   *
   * The paths alone were sent and the execution service could do nothing with
   * them: the edit became a new artifact version in the application's
   * database while the workspace kept the agent's version, and the next step
   * reads the workspace — so an edit at a gate changed nothing about the code
   * that followed it. FR-062 says the steps after a gate read the edited
   * version, and this is what carries it to where they read.
   */
  edited_documents?: Record<string, string>;
}
