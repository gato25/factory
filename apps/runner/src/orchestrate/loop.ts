import {
  applyStepResult,
  type Callback,
  decideStep,
  FactoryError,
  type PipelineSnapshot,
  type ResumeRequest,
  type RunFacts,
  type StepOutcome,
} from '@factory/shared';
import type { ContainerHost } from '../container/host';
import { buildEnvironment } from '../container/secrets';
import { type SandboxLimits, WORKDIR } from '../container/start';
import { log } from '../errors';
import {
  callbackSender,
  destroyRun,
  fetchCredentials,
  type RunStore,
  runStep,
  startRun,
  verifyAndPush,
} from '../runs';
import { composeMergeRequest, openMergeRequest } from './merge-request';
import type { LoopState, StateStore } from './state';

/**
 * The orchestrator: one run driven from its snapshot to its merge request.
 *
 * This used to be a workflow in a separate service, and the service was where
 * most of what went wrong went wrong. The logic was never there — it is
 * `decideStep` and `applyStepResult` in `packages/shared`, typed and tested,
 * and was hand-copied into that workflow. Here it is called.
 *
 * What the loop does, and only this (contracts/orchestrator.md §2, Principle
 * III): decide the next step from its condition; branch on its type; run it
 * through the same functions the routes expose; report every event to the
 * application through the same callbacks it always received; wait at a
 * checkpoint or a pause until the application says to go on; push, open the
 * merge request, and release the sandbox. It does not know what a
 * specification is.
 *
 * Every change of position is written to `states` before the next thing
 * happens, so a runner that restarts picks each run up where it was. That is
 * the whole answer to "the run is stuck": there is no execution to die, only
 * a position to resume from.
 */

export interface OrchestratorDeps {
  host: ContainerHost;
  store: RunStore;
  states: StateStore;
  /** For callbacks, the application and the providers; a test hands in a fake. */
  fetch?: (url: string, init?: RequestInit) => Promise<Response>;
  /** This service's address as the application reaches it, for resume addresses. */
  publicBaseUrl: string;
  /** How long a checkpoint's or pause's absence of callbacks may be retried, for tests. */
  sleep?: (ms: number) => Promise<void>;
}

export interface ResumePoint {
  index: number;
  facts?: RunFacts;
  spent_usd?: number;
}

export type ExecuteInput = {
  snapshot: PipelineSnapshot & { resume?: ResumePoint };
  sandbox: SandboxLimits;
};

/**
 * A callback without its envelope's run and attempt, which the loop adds.
 * Distributed over the union, because `Omit` on a union keeps only the
 * members' common fields and would lose every event's own.
 */
type LoopCallback = Callback extends infer C
  ? C extends Callback
    ? Omit<C, 'run_id' | 'attempt'>
    : never
  : never;

/** Steps a person's decision at a checkpoint can send the run back to (FR-061). */
const RE_RUNNABLE = new Set(['agent', 'design', 'shell']);

export class Orchestrator {
  private readonly driving = new Set<string>();
  private readonly doFetch: (url: string, init?: RequestInit) => Promise<Response>;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly deps: OrchestratorDeps) {
    this.doFetch = deps.fetch ?? fetch;
    this.sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  /**
   * Accepts a run and starts driving it, or picks a known run up again.
   *
   * Idempotent on the run: a second execute for a run that is being driven
   * changes nothing, which is what a caller that retries needs. A run that is
   * waiting is left waiting, unless the caller hands a resume point, which is
   * a person saying where to continue from.
   */
  async execute(input: ExecuteInput): Promise<{ accepted: boolean; phase: LoopState['phase'] }> {
    const { resume, ...snapshot } = input.snapshot;
    const runId = snapshot.run_id;
    let state = await this.deps.states.get(runId);
    const now = new Date().toISOString();

    if (!state) {
      state = {
        runId,
        snapshot,
        sandbox: input.sandbox,
        index: 0,
        facts: {},
        spentUsd: 0,
        designScreens: [],
        returningTo: null,
        feedback: null,
        paused: false,
        phase: 'starting',
        startedAt: now,
        updatedAt: now,
      };
    } else if (
      state.phase === 'finished' ||
      state.phase === 'failed' ||
      state.phase === 'cancelled'
    ) {
      return { accepted: false, phase: state.phase };
    }

    if (resume) {
      // A person's word on where the run stands, from the application's
      // own records: the first step neither done nor skipped, what is known,
      // what was spent. It replaces this service's position, which is the
      // point — this is how a run whose state was lost is picked up.
      state.index = Math.max(0, Math.floor(resume.index));
      state.facts = resume.facts ?? state.facts;
      state.spentUsd = resume.spent_usd ?? state.spentUsd;
      state.returningTo = null;
      state.paused = false;
      state.waitingAt = undefined;
      state.phase = state.containerId ? 'stepping' : 'starting';
    } else if (state.phase === 'waiting_approval' || state.phase === 'paused') {
      return { accepted: false, phase: state.phase };
    }

    await this.save(state);
    void this.drive(runId);
    return { accepted: true, phase: state.phase };
  }

  /**
   * The application's answer to a wait: a decision at a checkpoint (FR-060,
   * FR-061) or a pause withdrawn (FR-096).
   */
  async resume(runId: string, body: Partial<ResumeRequest> & { paused?: boolean }): Promise<void> {
    const state = await this.deps.states.get(runId);
    if (!state) throw new FactoryError('not_found', 'that run is not one this service is driving');

    if (state.phase === 'paused') {
      state.paused = false;
      state.phase = 'stepping';
      await this.save(state);
      void this.drive(runId);
      return;
    }

    if (state.phase !== 'waiting_approval') {
      throw new FactoryError('conflict', `this run is ${state.phase}, not waiting for a decision`);
    }
    const at = state.waitingAt ?? state.index;
    switch (body.decision) {
      case 'cancelled': {
        state.phase = 'cancelled';
        await this.save(state);
        await this.post(state, { event: 'cancelled', step_index: at });
        await destroyRun(this.deps.host, this.deps.store, runId, { outcome: 'cancelled' }).catch(
          () => {},
        );
        await this.deps.states.delete(runId);
        return;
      }
      case 'changes_requested': {
        // The preceding step that can be re-run, with the reviewer's words,
        // then back to this same checkpoint (FR-061).
        let back = at - 1;
        while (back >= 0 && !RE_RUNNABLE.has(state.snapshot.pipeline.steps[back]?.type ?? '')) {
          back -= 1;
        }
        if (back >= 0) {
          state.index = back;
          state.returningTo = at;
          state.feedback = body.feedback?.trim() || null;
        } else {
          state.index = at + 1;
        }
        break;
      }
      case 'approved':
      case 'edited':
      default:
        // `edited` means the document was rewritten in place, so the following
        // steps read the new version by reading the workspace (FR-062). A
        // body with no decision at all is treated as approval, which is what
        // a gate that timed out with `continue` sends.
        state.index = at + 1;
    }
    state.waitingAt = undefined;
    state.phase = 'stepping';
    await this.save(state);
    void this.drive(runId);
  }

  /**
   * The application released this run's sandbox on purpose (a cancel).
   * Whatever the loop is doing stops meaning anything; it must not rebuild a
   * sandbox the application just asked to be rid of.
   */
  async cancel(runId: string): Promise<void> {
    const state = await this.deps.states.get(runId);
    if (!state) return;
    state.phase = 'cancelled';
    await this.save(state);
    await this.deps.states.delete(runId);
  }

  async state(runId: string): Promise<LoopState | undefined> {
    return this.deps.states.get(runId);
  }

  /**
   * After a restart: every run that was in flight is driven again from its
   * recorded position; every run that was waiting keeps waiting. Its sandbox
   * is adopted where the host still has it, and rebuilt where it does not.
   */
  async recover(): Promise<{ resumed: string[]; waiting: string[] }> {
    const resumed: string[] = [];
    const waiting: string[] = [];
    for (const state of await this.deps.states.all()) {
      if (state.phase === 'waiting_approval' || state.phase === 'paused') {
        waiting.push(state.runId);
        continue;
      }
      if (state.phase === 'finished' || state.phase === 'failed' || state.phase === 'cancelled') {
        await this.deps.states.delete(state.runId);
        continue;
      }
      resumed.push(state.runId);
      void this.drive(state.runId);
    }
    return { resumed, waiting };
  }

  // --- the loop --------------------------------------------------------------

  private async drive(runId: string): Promise<void> {
    if (this.driving.has(runId)) return;
    this.driving.add(runId);
    let state = await this.deps.states.get(runId);
    try {
      if (!state) return;
      state = await this.ensureSandbox(state);
      if (!state) return;

      while (true) {
        const fresh = await this.deps.states.get(runId);
        if (!fresh || fresh.phase === 'cancelled') return;
        state = fresh;

        if (state.paused) {
          state.phase = 'paused';
          state.waitingAt = state.index;
          await this.save(state);
          await this.post(state, {
            event: 'paused',
            step_index: state.index,
            resume_url: this.resumeUrl(runId),
          });
          return;
        }

        const decision = decideStep(state.snapshot.pipeline.steps, state.index, state.facts);
        if (decision.action === 'finish') {
          await this.finish(state);
          return;
        }
        if (decision.action === 'skip') {
          const reply = await this.post(state, {
            event: 'step_skipped',
            step_index: decision.index,
            condition_not_met: decision.conditionNotMet,
          });
          this.advance(state, reply.paused);
          await this.save(state);
          continue;
        }

        const step = decision.step;
        if (step.type === 'checkpoint') {
          state.phase = 'waiting_approval';
          state.waitingAt = decision.index;
          await this.save(state);
          await this.post(state, {
            event: 'waiting_approval',
            step_index: decision.index,
            resume_url: this.resumeUrl(runId),
            // The rule itself lives in the snapshot the application already
            // holds; the list here is the named people, when there are any.
            approvers: Array.isArray(step.approvers) ? step.approvers : [],
          });
          return;
        }
        if (step.type === 'notify') {
          // Not sent yet, and said so rather than silently skipped: the step
          // is recorded as done with a summary a person can read.
          await this.post(state, { event: 'step_started', step_index: decision.index });
          const reply = await this.post(state, {
            event: 'step_finished',
            step_index: decision.index,
            status: 'done',
            duration_s: 0,
            cost_usd: '0.0000',
            summary: 'Notifications are not sent yet; nothing was sent.',
            artifacts: [],
          });
          this.advance(state, reply.paused);
          await this.save(state);
          continue;
        }

        // agent, design, shell — the runner's own step, through the same
        // function the route exposes; it posts step_started, the log and the
        // classification itself.
        const outcome = await runStep(
          this.deps.host,
          this.deps.store,
          runId,
          decision.index,
          {
            step,
            feedback: state.feedback ?? undefined,
            has_ui: state.facts.hasUi,
            spent_so_far_usd: state.spentUsd.toFixed(4),
            design_screens: state.designScreens.length ? state.designScreens : undefined,
          },
          callbackSender(state.snapshot, this.doFetch),
        );
        const reply = await this.post(state, {
          event: 'step_finished',
          step_index: decision.index,
          status: outcome.status,
          duration_s: outcome.durationS,
          cost_usd: outcome.costUsd,
          engine_session_id: outcome.sessionId,
          summary: outcome.summary ?? outcome.error?.detail,
          artifacts: outcome.outputs,
        });

        state.facts = applyStepResult(state.facts, outcome);
        state.spentUsd = round(state.spentUsd + Number(outcome.costUsd));
        state.designScreens = [
          ...state.designScreens,
          ...outcome.outputs.filter((o) => o.kind === 'screen').map((o) => o.path),
        ];

        if (outcome.status === 'failed') {
          await this.fail(
            state,
            decision.index,
            outcome.error?.reason ?? 'command_failed',
            outcome.error?.detail ?? outcome.summary ?? 'the step failed',
          );
          return;
        }
        // A ceiling reached is a failure, checked after every step (FR-081).
        const ceiling = Number(state.snapshot.limits.cost_ceiling_usd);
        if (state.spentUsd > ceiling) {
          await this.fail(
            state,
            decision.index,
            'budget_exceeded',
            `the run reached its ceiling of $${ceiling.toFixed(4)}`,
          );
          return;
        }
        this.advance(state, reply.paused);
        await this.save(state);
      }
    } catch (error) {
      const current = await this.deps.states.get(runId);
      // A run cancelled while a step was executing: its sandbox went away on
      // purpose, and there is nobody to tell.
      if (!current || current.phase === 'cancelled') return;
      const reason = error instanceof FactoryError ? error.reason : 'command_failed';
      const detail = error instanceof Error ? error.message : String(error);
      await this.fail(current, current.index, reason, detail);
    } finally {
      this.driving.delete(runId);
    }
  }

  /**
   * The run's sandbox: the one it has, the one it had before a restart, or a
   * new one. Credentials come from the application each time this service
   * needs them and holds none (FR-083).
   */
  private async ensureSandbox(state: LoopState): Promise<LoopState | undefined> {
    const { host, store } = this.deps;
    const record = await store.get(state.runId);
    if (record?.containerId && record.credentials) return state;

    const credentials = await fetchCredentials(state.snapshot, this.doFetch);

    if (state.containerId && !record?.containerId) {
      // After a restart: the host may still have the sandbox. Adopted where it
      // does, so the work in it is kept; rebuilt where it does not.
      const spec = {
        image: state.sandbox.image,
        cpu: state.sandbox.cpu,
        memoryMb: state.sandbox.memoryMb,
        wallClockMinutes: state.sandbox.wallClockMinutes,
        network: true,
        env: buildEnvironment(state.snapshot, credentials),
        workdir: WORKDIR,
      };
      const adopted = await (host.adopt
        ? host.adopt(state.containerId, spec).then(
            () => true,
            () => false,
          )
        : Promise.resolve(true));
      if (adopted) {
        await store.set(state.runId, {
          snapshot: state.snapshot,
          sandbox: state.sandbox,
          credentials,
          containerId: state.containerId,
          outcome: 'running',
        });
        log.info('adopted a run’s sandbox after a restart', {
          run_id: state.runId,
          container_id: state.containerId,
        });
        state.phase = 'stepping';
        await this.save(state);
        return state;
      }
      log.warn('a run’s sandbox is gone after a restart; a fresh one is built', {
        run_id: state.runId,
      });
    }

    if (record?.containerId) {
      await store.set(state.runId, { ...record, credentials });
      return state;
    }

    const started = await startRun(host, store, {
      snapshot: state.snapshot,
      credentials,
      sandbox: state.sandbox,
    });
    state.containerId = started.container_id;
    state.phase = 'stepping';
    await this.save(state);
    await this.post(state, {
      event: 'started',
      step_index: 0,
      container_id: started.container_id,
    });
    return state;
  }

  private advance(state: LoopState, paused: boolean): void {
    if (state.returningTo !== null) {
      // The re-run a change request asked for has finished: back to the
      // checkpoint, with the feedback spent (FR-061).
      state.index = state.returningTo;
      state.returningTo = null;
      state.feedback = null;
    } else {
      state.index += 1;
    }
    state.paused = paused;
  }

  private async finish(state: LoopState): Promise<void> {
    const { host, store } = this.deps;
    state.phase = 'finishing';
    await this.save(state);

    const pushed = await verifyAndPush(host, store, state.runId);
    if (!pushed.pushed) {
      await this.fail(state, state.index, 'command_failed', `${pushed.reason}: ${pushed.detail}`);
      return;
    }
    const record = await store.get(state.runId);
    const gitToken = record?.credentials?.gitToken;
    if (!gitToken) {
      await this.fail(
        state,
        state.index,
        'credential_missing',
        'no git token to open the merge request with',
      );
      return;
    }
    let url: string;
    try {
      const content = await composeMergeRequest(state.snapshot, this.doFetch);
      url = (await openMergeRequest(state.snapshot, gitToken, content, this.doFetch)).url;
    } catch (error) {
      // FR-098: the branch is pushed and the code is safe; the failure says so.
      await this.fail(
        state,
        state.index,
        'command_failed',
        error instanceof Error ? error.message : String(error),
      );
      return;
    }
    await this.post(state, { event: 'mr_opened', step_index: state.index, merge_request_url: url });
    await this.post(state, {
      event: 'done',
      step_index: state.index,
      merge_request_url: url,
      cost_usd: state.spentUsd.toFixed(4),
    });
    await destroyRun(host, store, state.runId, { outcome: 'done' }).catch((error) =>
      log.warn('could not release the sandbox of a finished run', {
        run_id: state.runId,
        detail: error instanceof Error ? error.message : String(error),
      }),
    );
    state.phase = 'finished';
    await this.save(state);
    await this.deps.states.delete(state.runId);
  }

  private async fail(
    state: LoopState,
    stepIndex: number,
    reason: string,
    detail: string,
  ): Promise<void> {
    state.phase = 'failed';
    await this.save(state).catch(() => {});
    log.error('run failed', { run_id: state.runId, step_index: stepIndex, reason, detail });
    await this.post(state, { event: 'failed', step_index: stepIndex, reason, detail }).catch(
      (error) =>
        log.error('could not report the failure to the application', {
          run_id: state.runId,
          detail: error instanceof Error ? error.message : String(error),
        }),
    );
    await destroyRun(this.deps.host, this.deps.store, state.runId, { outcome: 'failed' }).catch(
      () => {},
    );
    await this.deps.states.delete(state.runId);
  }

  // --- talking to the application ---------------------------------------------

  private resumeUrl(runId: string): string {
    return `${this.deps.publicBaseUrl.replace(/\/+$/, '')}/runs/${runId}/resume`;
  }

  private async save(state: LoopState): Promise<void> {
    state.updatedAt = new Date().toISOString();
    await this.deps.states.set(state);
  }

  /**
   * A callback the loop depends on, with its reply. Retried a few times with
   * increasing delays, because the application being briefly unreachable
   * must not fail a run that is otherwise fine; then given up on, which is
   * a failure of the run — the application has to know what happened.
   */
  private async post(state: LoopState, callback: LoopCallback): Promise<{ paused: boolean }> {
    const body = {
      run_id: state.runId,
      attempt: state.snapshot.attempt,
      ...callback,
    } as Callback;
    let lastError = '';
    for (const delayMs of [0, 1_000, 3_000, 8_000]) {
      if (delayMs) await this.sleep(delayMs);
      try {
        const response = await this.doFetch(state.snapshot.callback_url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${state.snapshot.resume_secret}`,
          },
          body: JSON.stringify(body),
        });
        if (response.ok) {
          const reply = (await response.json().catch(() => ({}))) as { paused?: boolean };
          return { paused: reply.paused === true };
        }
        const text = await response.text().catch(() => '');
        lastError = `the application answered ${response.status} to ${callback.event}: ${text.slice(0, 300)}`;
        // A refusal will not change by asking again.
        if (response.status >= 400 && response.status < 500) break;
      } catch (error) {
        lastError = `the application could not be reached for ${callback.event}: ${
          error instanceof Error ? error.message : String(error)
        }`;
      }
    }
    throw new FactoryError('app_unreachable', lastError);
  }
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

export type { StepOutcome };
