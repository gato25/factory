import {
  applyStepResult,
  type Callback,
  createRedactor,
  decideStep,
  FactoryError,
  type PipelineSnapshot,
  type ResumeRequest,
  type RunFacts,
  type StepOutcome,
} from '@factory/shared';
import type { ContainerHost } from '../container/host';
import { withinWorkspace } from '../container/paths';
import { isSandboxLoss } from '../container/recover';
import { buildEnvironment, secretValues } from '../container/secrets';
import { type SandboxLimits, WORKDIR } from '../container/start';
import { log } from '../errors';
import { readOutputBytes, readOutputContents } from '../outputs/contents';
import {
  CALLBACK_TIMEOUT_MS,
  callbackSender,
  destroyRun,
  fetchCredentials,
  type RunStore,
  runStep,
  startRun,
  verifyAndPush,
} from '../runs';
import { composeMergeRequest, findOpenMergeRequest, openMergeRequest } from './merge-request';
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
  /** How hard to try to deliver a callback the loop depends on; a test shortens it. */
  callbackDelivery?: Partial<CallbackDelivery>;
  /**
   * Whether the sandbox host is answering, asked when a sandbox is lost.
   *
   * Absent, a lost sandbox is the run's own misfortune and fails it. Present,
   * a sandbox lost while the host is not answering is the host's fault, and
   * the run waits for the host instead — see `awaitHost`. The Docker host
   * supplies this; the process host does not, because a directory on this
   * machine has no daemon to be waiting for.
   */
  probeHost?: () => Promise<{ reachable: boolean; detail: string }>;
  /** How long a run waits for its host to answer again; a test shortens it. */
  hostWait?: Partial<HostWait>;
}

/**
 * How long a run whose sandbox host stopped answering waits for it.
 *
 * A daemon restart is seconds; a daemon upgrade is a minute or two. Five
 * minutes covers both with room, and a host that is still not answering
 * after that is an outage the run should not paper over: it fails, saying
 * so, and the work committed to the branch is still there.
 */
export interface HostWait {
  budgetMs: number;
  pollMs: number;
}

export const HOST_WAIT: HostWait = { budgetMs: 5 * 60_000, pollMs: 10_000 };

type HostOutage =
  | { kind: 'not_an_outage' }
  | { kind: 'recovered' }
  | { kind: 'released' }
  | { kind: 'still_down'; detail: string };

/**
 * How a callback the loop depends on is delivered when the application does
 * not answer at once.
 *
 * The numbers describe an application that is being restarted, not one that
 * is gone: attempts a second apart at first, then a minute apart, for a
 * quarter of an hour in all. That is long enough for any deploy and short
 * enough that a run whose application has genuinely vanished still fails in
 * the same hour, with the sandbox's own lifetime ceiling underneath it.
 */
export interface CallbackDelivery {
  /** How long one request may take before it is abandoned and tried again. */
  timeoutMs: number;
  /** How long, in total, delivery keeps being attempted before the run fails. */
  budgetMs: number;
  /** The first pause between attempts; each following one doubles, up to `maxDelayMs`. */
  firstDelayMs: number;
  maxDelayMs: number;
}

export const CALLBACK_DELIVERY: CallbackDelivery = {
  timeoutMs: CALLBACK_TIMEOUT_MS,
  budgetMs: 15 * 60_000,
  firstDelayMs: 1_000,
  maxDelayMs: 60_000,
};

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
  /** Set by `shutdown`: nothing further begins, and what is in flight is left where it is. */
  private stopping = false;
  private readonly doFetch: (url: string, init?: RequestInit) => Promise<Response>;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly delivery: CallbackDelivery;
  private readonly hostWait: HostWait;

  constructor(private readonly deps: OrchestratorDeps) {
    this.doFetch = deps.fetch ?? fetch;
    this.sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.delivery = { ...CALLBACK_DELIVERY, ...deps.callbackDelivery };
    this.hostWait = { ...HOST_WAIT, ...deps.hostWait };
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
    if (this.stopping) {
      throw new FactoryError(
        'conflict',
        'the execution service is shutting down; ask again shortly',
        {
          status: 503,
        },
      );
    }
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
        state.pending = {
          callback: this.envelope(state, { event: 'cancelled', step_index: at }),
          since: new Date().toISOString(),
          after: { outcome: 'terminal', destroy: 'cancelled' },
        };
        await this.save(state);
        await this.settleTerminal(state);
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
        // What the person wrote goes into the workspace, which is what the
        // steps after this gate read (FR-062). Recorded in the application as
        // a new version already; without this the workspace kept the agent's
        // version and the edit changed nothing that followed.
        await this.applyEdits(state, body.edited_documents);
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
   * Writes a person's edited documents into the run's workspace.
   *
   * Failure here is not silent and not fatal either: the run continues, and
   * the log names the document the next step will not have seen. Losing an
   * edit quietly is the thing worth avoiding; refusing to continue a run over
   * one is worse than saying so.
   */
  private async applyEdits(
    state: LoopState,
    documents: Record<string, string> | undefined,
  ): Promise<void> {
    if (!documents) return;
    const record = await this.deps.store.get(state.runId);
    const containerId = record?.containerId ?? state.containerId;
    if (!containerId) return;
    for (const [path, content] of Object.entries(documents)) {
      // Named by the reviewer's request, so held inside the workspace before
      // it is joined onto it (`paths.ts`). Refused, as a 400, before any of
      // the edits is written.
      const inside = withinWorkspace(path, 'edited document');
      try {
        await this.deps.host.writeFile(containerId, `${WORKDIR}/${inside}`, content);
        log.info('an edited document was written into the workspace', {
          run_id: state.runId,
          path,
        });
      } catch (error) {
        log.error('an edited document could not be written into the workspace', {
          run_id: state.runId,
          path,
          detail: error instanceof Error ? error.message : String(error),
        });
      }
    }
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

  /** Whether `shutdown` has begun, for the routes that must refuse new work. */
  get isStopping(): boolean {
    return this.stopping;
  }

  /**
   * Stops driving, cleanly, ahead of the process ending.
   *
   * The process used to end with whatever SIGTERM found: a run accepted a
   * moment earlier was lost, a delivery being retried started again from
   * its first attempt, and — worst — every step in flight left its agent
   * working headless in its sandbox, because the runner's death killed the
   * `docker exec` client and not the agent, for however long the restart
   * took. Now: nothing further begins (`execute` answers 503, and the
   * application retries later); each loop returns at its next turn, leaving
   * its position written down; the agents still working are stopped, so
   * that nothing spends money nobody is recording; and the outcome of a step
   * that finishes during this is DISCARDED rather than acted on, because the
   * step runs again after the restart anyway and a half-handled outcome is
   * worse than a repeated step.
   *
   * Waits for the loops to return, up to `graceMs`. A loop that is inside a
   * long `docker exec` cannot return sooner than the exec does; killing the
   * agent inside is what makes the exec return.
   */
  async shutdown(graceMs = 10_000): Promise<{ inFlight: string[]; quiesced: string[] }> {
    this.stopping = true;
    const inFlight = [...this.driving];
    const quiesced: string[] = [];
    for (const runId of inFlight) {
      const record = await this.deps.store.get(runId);
      const state = await this.deps.states.get(runId);
      const containerId = record?.containerId ?? state?.containerId;
      if (!containerId || !this.deps.host.quiesce) continue;
      try {
        const { stopped } = await this.deps.host.quiesce(containerId);
        if (stopped > 0) quiesced.push(runId);
      } catch (error) {
        log.warn('could not stop what was running in a sandbox at shutdown', {
          run_id: runId,
          container_id: containerId,
          detail: error instanceof Error ? error.message : String(error),
        });
      }
    }
    const deadline = Date.now() + graceMs;
    while (this.driving.size > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (this.driving.size > 0) {
      log.warn('shutting down with loops still in flight; their positions are written down', {
        runs: [...this.driving],
      });
    }
    return { inFlight, quiesced };
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
      if (state.phase === 'failed' || state.phase === 'cancelled') {
        // Ended, but not finished ending: the callback was being delivered,
        // or the sandbox released, when the last process stopped.
        if (state.pending?.after.outcome === 'terminal') {
          resumed.push(state.runId);
          void this.settleTerminal(state);
        } else {
          await this.deps.states.delete(state.runId);
        }
        continue;
      }
      if (state.phase === 'finished') {
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
    try {
      for (;;) {
        try {
          await this.driveOnce(runId);
          return;
        } catch (error) {
          // Shutting down: whatever failed, failed because of that, and the
          // run's position on disk is where the restart picks it up.
          if (this.stopping) return;
          const current = await this.deps.states.get(runId);
          // A run cancelled while a step was executing: its sandbox went away
          // on purpose, and there is nobody to tell.
          if (!current || current.phase === 'cancelled') return;
          if (isSandboxLoss(error)) {
            // A sandbox lost because its host stopped answering is the host's
            // fault, not the run's: the run waits for the host, and goes on
            // in a replacement once it answers.
            const outage = await this.awaitHost(current);
            if (outage.kind === 'recovered') continue;
            if (outage.kind === 'released') return;
            if (outage.kind === 'still_down') {
              await this.fail(
                current,
                current.index,
                'sandbox_lost',
                `${Orchestrator.evidence(error)}\n${outage.detail}`,
              );
              return;
            }
          }
          const reason = error instanceof FactoryError ? error.reason : 'command_failed';
          await this.fail(current, current.index, reason, Orchestrator.evidence(error));
          return;
        }
      }
    } finally {
      this.driving.delete(runId);
    }
  }

  /**
   * When a sandbox is lost: whether its host is the reason, and if so a wait
   * for the host rather than a failure of the run.
   *
   * A Docker daemon that restarts takes every container with it unless it
   * was configured to keep them, so a step running at that moment loses its
   * sandbox. That used to fail the run at once — the replacement could not
   * be created either, because the same daemon was still coming up — with a
   * message about the sandbox for a fault in the machine. Now the run asks
   * the host, and if the host is the problem, waits for it: polls, for up to
   * `hostWait.budgetMs`, and continues when it answers. A host still silent
   * after that fails the run, saying that it was the host.
   */
  private async awaitHost(state: LoopState): Promise<HostOutage> {
    const probe = this.deps.probeHost;
    if (!probe) return { kind: 'not_an_outage' };
    const ask = () =>
      probe().catch((error) => ({
        reachable: false,
        detail: error instanceof Error ? error.message : String(error),
      }));
    const first = await ask();
    if (first.reachable) return { kind: 'not_an_outage' };

    const { budgetMs, pollMs } = this.hostWait;
    log.warn('the container host is not answering; the run waits for it', {
      run_id: state.runId,
      step_index: state.index,
      detail: first.detail,
      for_up_to_ms: budgetMs,
    });
    let waited = 0;
    let detail = first.detail;
    while (waited < budgetMs) {
      const pause = Math.min(pollMs, budgetMs - waited);
      await this.sleep(pause);
      waited += pause;
      if (this.stopping) return { kind: 'released' };
      // Released or cancelled while waiting: nobody wants the run any more.
      if (!(await this.deps.states.get(state.runId))) return { kind: 'released' };
      const again = await ask();
      detail = again.detail;
      if (again.reachable) {
        log.info('the container host is answering again; the run goes on', {
          run_id: state.runId,
          step_index: state.index,
          waited_ms: waited,
        });
        return { kind: 'recovered' };
      }
    }
    return {
      kind: 'still_down',
      detail: `The container host did not answer for ${Math.round(budgetMs / 60_000)} minutes: ${detail}`,
    };
  }

  /** One pass at driving the run, until it finishes, waits, or throws. */
  private async driveOnce(runId: string): Promise<void> {
    let state = await this.deps.states.get(runId);
    if (!state) return;
    if (state.pending) {
      // After a restart, with a step's outcome still to deliver: the
      // application is told FIRST, before anything that would ask it for
      // something else. If it is down — which is the usual reason there is
      // an outcome waiting — fetching credentials for the sandbox would
      // fail the run before the delivery ever got its chance.
      if ((await this.settle(state)) === 'stopped') return;
      state = (await this.deps.states.get(runId)) ?? state;
    }
    state = await this.ensureSandbox(state);
    if (!state) return;

    while (true) {
      if (this.stopping) return;
      const fresh = await this.deps.states.get(runId);
      if (!fresh || fresh.phase === 'cancelled') return;
      state = fresh;

      if (state.pending) {
        // A step just finished, or a restart found its outcome unsent: the
        // application is told, and what follows follows from its reply.
        if ((await this.settle(state)) === 'stopped') return;
        continue;
      }

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
      // A step that concluded because shutdown stopped its agent did not
      // conclude: its outcome is not the step's, and the step runs again
      // after the restart from the position already written down.
      if (this.stopping) return;
      // Nor did one whose run was cancelled while it ran: the state file is
      // gone, and writing this loop's copy back would resurrect the run —
      // as it did, reporting a cancelled run failed a minute after the
      // person had cancelled it.
      await this.assertWanted(state);

      /**
       * The sandbox the step actually ran in, which is not always the one
       * this state names: a step whose sandbox was lost runs again in a
       * replacement, and the run store is what knows. Taken from there, and
       * written back, so a restart adopts the sandbox that holds the work
       * rather than the one that went away.
       */
      const record = await this.deps.store.get(runId);
      if (record?.containerId) state.containerId = record.containerId;

      // The documents the step wrote, so the application stores what is in
      // them and not merely that they exist (FR-054).
      const contents =
        record?.containerId && record.credentials
          ? await readOutputContents(
              this.deps.host,
              record.containerId,
              WORKDIR,
              outcome.outputs,
              createRedactor(secretValues(record.credentials)),
            )
          : {};

      // And the screens it exported, for the same reason: a design step's
      // whole output is a picture, and a row naming one is not a picture.
      const images = record?.containerId
        ? await readOutputBytes(this.deps.host, record.containerId, WORKDIR, outcome.outputs)
        : {};

      state.facts = applyStepResult(state.facts, outcome);
      state.spentUsd = round(state.spentUsd + Number(outcome.costUsd));
      state.designScreens = [
        ...state.designScreens,
        ...outcome.outputs.filter((o) => o.kind === 'screen').map((o) => o.path),
      ];

      // The outcome is written down BEFORE it is sent, and delivered by the
      // next turn of the loop — the same turn a restarted runner takes. So
      // an application that cannot be reached right now costs the run a
      // wait, and a runner that dies during that wait costs it nothing: the
      // step is not run again, its recorded outcome is sent again (FR-095
      // makes the repeat harmless).
      state.pending = {
        callback: this.envelope(state, {
          event: 'step_finished',
          step_index: decision.index,
          status: outcome.status,
          duration_s: outcome.durationS,
          cost_usd: outcome.costUsd,
          engine_session_id: outcome.sessionId,
          summary: outcome.summary ?? outcome.error?.detail,
          artifacts: outcome.outputs,
          artifact_contents: contents,
          artifact_bytes: images,
        }),
        since: new Date().toISOString(),
        after:
          outcome.status === 'failed'
            ? {
                outcome: 'failed',
                reason: outcome.error?.reason ?? 'command_failed',
                detail: outcome.error?.detail ?? outcome.summary ?? 'the step failed',
              }
            : { outcome: 'done' },
      };
      await this.save(state);
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

    // A sandbox this run had before this process started: named by the
    // state file, or by a record that survived on disk without its
    // credentials (which is what a record looks like after a restart).
    // Either way the host may still have it — adopted where it does, so
    // the work in it is kept; rebuilt where it does not.
    const known = state.containerId ?? record?.containerId;
    if (known && !record?.credentials) {
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
        ? host.adopt(known, spec).then(
            () => true,
            () => false,
          )
        : Promise.resolve(true));
      if (adopted) {
        // The last runner's death killed its `docker exec`, not the agent
        // inside: whatever that was doing is still doing it. It stops here,
        // before this runner starts the step again beside it.
        const quiet = await host.quiesce?.(known).catch((error) => {
          log.warn('could not stop what was running in an adopted sandbox', {
            run_id: state.runId,
            container_id: known,
            detail: error instanceof Error ? error.message : String(error),
          });
          return { stopped: 0 };
        });
        if (quiet && quiet.stopped > 0) {
          log.warn(
            'stopped processes still running in an adopted sandbox from before the restart',
            {
              run_id: state.runId,
              container_id: known,
              stopped: quiet.stopped,
              consequence:
                'the step they belonged to runs again from its start; their work is not recorded',
            },
          );
        }
        await store.set(state.runId, {
          snapshot: state.snapshot,
          sandbox: state.sandbox,
          credentials,
          containerId: known,
          outcome: 'running',
        });
        log.info('adopted a run’s sandbox after a restart', {
          run_id: state.runId,
          container_id: known,
        });
        state.containerId = known;
        state.phase = 'stepping';
        await this.save(state);
        return state;
      }
      log.warn('a run’s sandbox is gone after a restart; a fresh one is built', {
        run_id: state.runId,
      });
    }

    const started = await startRun(
      host,
      store,
      {
        snapshot: state.snapshot,
        credentials,
        sandbox: state.sandbox,
      },
      // Past the first step means this run has already produced work and
      // pushed it, so the new workspace takes the branch rather than
      // starting it over. A run that waited at its checkpoint overnight,
      // lost its sandbox and was continued landed here, cloned the default
      // branch, and the step after the gate found no specification and no
      // plan — the same failure as before anything was pushed at all.
      { resuming: state.index > 0 },
    );
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

  /**
   * Delivers a step's recorded outcome and does what follows from it: the
   * run fails as the step did, fails at a ceiling it has now reached
   * (FR-081), or advances — paused if the application's reply asks for it.
   *
   * One path for both cases that reach it, the step that has just finished
   * and the restart that found an outcome unsent, so neither can drift from
   * the other.
   */
  private async settle(state: LoopState): Promise<'continued' | 'stopped'> {
    const pending = state.pending;
    if (!pending) return 'continued';
    if (pending.after.outcome === 'terminal') {
      await this.settleTerminal(state);
      return 'stopped';
    }
    const reply = await this.deliver(state, pending.callback);
    state.pending = undefined;
    if (pending.after.outcome === 'failed') {
      await this.fail(
        state,
        pending.callback.step_index,
        pending.after.reason,
        pending.after.detail,
      );
      return 'stopped';
    }
    // A ceiling reached is a failure, checked after every step (FR-081).
    const ceiling = Number(state.snapshot.limits.cost_ceiling_usd);
    if (state.spentUsd > ceiling) {
      await this.fail(
        state,
        pending.callback.step_index,
        'budget_exceeded',
        `the run reached its ceiling of $${ceiling.toFixed(4)}`,
      );
      return 'stopped';
    }
    this.advance(state, reply.paused);
    await this.save(state);
    return 'continued';
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
    await this.saveDriving(state);

    // Already opened, by this process or the one before it: nothing to push
    // or ask the provider for again, only to tell the application.
    let url = state.mergeRequestUrl;
    if (!url) {
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
      try {
        const content = await composeMergeRequest(state.snapshot, this.doFetch);
        // The provider is asked first whether it already has one: a restart
        // between opening and writing the address down, or an earlier
        // attempt whose answer was lost, has already opened it.
        url =
          (await findOpenMergeRequest(state.snapshot, gitToken, content, this.doFetch)) ??
          (
            await openMergeRequest(state.snapshot, gitToken, content, this.doFetch, {
              sleep: this.sleep,
            })
          ).url;
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
      state.mergeRequestUrl = url;
      await this.saveDriving(state);
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

  /**
   * Everything a failure knows about itself, in one string.
   *
   * A `FactoryError` carries the sentence a person reads AND the evidence
   * for it — the stderr of the command that failed. Only the sentence was
   * reported, and the evidence existed nowhere else: not in the step's log,
   * which a start failure never opens, not in the step's row, not in this
   * service's own output, which logs the message too.
   *
   * So three runs in a row failed at `Could not clone <url>.` with nothing
   * to say whether the token was refused, the branch was missing, or the
   * transfer broke — the one line of git's output that distinguishes them
   * having been thrown away here.
   */
  private static evidence(error: unknown): string {
    if (error instanceof FactoryError) {
      return error.detail ? `${error.message}\n${error.detail}` : error.message;
    }
    return error instanceof Error ? error.message : String(error);
  }

  private async fail(
    state: LoopState,
    stepIndex: number,
    reason: string,
    detail: string,
  ): Promise<void> {
    // A run released or cancelled while its step ran has nobody to tell and
    // nothing to release; writing 'failed' over it would bring it back.
    const current = await this.deps.states.get(state.runId);
    if (!current || current.phase === 'cancelled') return;
    log.error('run failed', { run_id: state.runId, step_index: stepIndex, reason, detail });
    state.phase = 'failed';
    // Written down BEFORE anything is sent or released, so a restart in the
    // middle of either finishes the job instead of deleting a state marked
    // failed with its sandbox still running.
    state.pending = {
      callback: this.envelope(state, { event: 'failed', step_index: stepIndex, reason, detail }),
      since: new Date().toISOString(),
      after: { outcome: 'terminal', destroy: 'failed' },
    };
    await this.save(state).catch((error) =>
      log.error('could not write the failure down', {
        run_id: state.runId,
        detail: error instanceof Error ? error.message : String(error),
      }),
    );
    await this.settleTerminal(state);
  }

  /**
   * Ends a run whose end is written down: tells the application, releases
   * the sandbox, forgets the run — each attempted whatever the one before
   * did, because a sandbox must not outlive a failure the application could
   * not be told about, and a state file must not outlive its sandbox.
   */
  private async settleTerminal(state: LoopState): Promise<void> {
    const pending = state.pending;
    if (pending?.after.outcome === 'terminal') {
      const destroy = pending.after.destroy;
      const reason = (pending.callback as { reason?: string }).reason;
      await this.deliver(
        state,
        pending.callback,
        // A run that failed BECAUSE the application could not be reached has
        // already spent the whole delivery budget finding that out. One more
        // attempt, in case it is back; not another quarter of an hour.
        reason === 'app_unreachable' ? { budgetMs: 0 } : undefined,
      ).catch((error) => {
        // Interrupted by shutdown: the end is written down, and the restart
        // delivers it — nothing is released or forgotten here, or the
        // application would never learn how the run ended.
        if (this.stopping) throw error;
        log.error('could not report the failure to the application', {
          run_id: state.runId,
          event: pending.callback.event,
          detail: error instanceof Error ? error.message : String(error),
        });
      });
      await destroyRun(this.deps.host, this.deps.store, state.runId, { outcome: destroy }).catch(
        (error) =>
          log.warn('could not release the sandbox of a run that ended', {
            run_id: state.runId,
            outcome: destroy,
            detail: error instanceof Error ? error.message : String(error),
          }),
      );
    }
    await this.deps.states.delete(state.runId);
  }

  /**
   * Throws when the run this loop is driving is no longer wanted — its state
   * file gone, or marked cancelled by a route — so the loop's next write
   * cannot bring it back. `drive()`'s catch treats that as the silent end it
   * is.
   */
  private async assertWanted(state: LoopState): Promise<void> {
    const current = await this.deps.states.get(state.runId);
    if (!current || current.phase === 'cancelled') {
      throw new FactoryError('conflict', 'the run was released while it was being driven');
    }
  }

  /** `save`, for the loop's own writes: refused when the run was released meanwhile. */
  private async saveDriving(state: LoopState): Promise<void> {
    await this.assertWanted(state);
    await this.save(state);
  }

  // --- talking to the application ---------------------------------------------

  private resumeUrl(runId: string): string {
    return `${this.deps.publicBaseUrl.replace(/\/+$/, '')}/runs/${runId}/resume`;
  }

  private async save(state: LoopState): Promise<void> {
    state.updatedAt = new Date().toISOString();
    await this.deps.states.set(state);
  }

  private envelope(state: LoopState, callback: LoopCallback): Callback {
    return { run_id: state.runId, attempt: state.snapshot.attempt, ...callback } as Callback;
  }

  private async post(
    state: LoopState,
    callback: LoopCallback,
    options?: Partial<CallbackDelivery>,
  ): Promise<{ paused: boolean }> {
    return this.deliver(state, this.envelope(state, callback), options);
  }

  /**
   * A callback the loop depends on, with its reply.
   *
   * Retried for as long as the delivery budget allows, with pauses that
   * double up to a minute, because the application being unreachable for a
   * while must not fail a run that is otherwise fine — and "a while" is a
   * deploy, not a hiccup. The schedule this replaces gave up after twelve
   * seconds, which is less than a restart of the application takes, so a
   * step that finished during one had its work thrown away. Each request
   * has a timeout of its own, so a connection that hangs is tried again
   * rather than waited on for the rest of the run. Then given up on, which
   * is a failure of the run — the application has to know what happened.
   *
   * The budget is counted in time slept rather than read from a clock, so
   * that a test which makes sleeping instant sees the same attempts a
   * deployment would.
   *
   * Delivery stops early when the run's state is gone: the run was released
   * or cancelled while this was being retried, and there is nobody to tell.
   */
  private async deliver(
    state: LoopState,
    body: Callback,
    options?: Partial<CallbackDelivery>,
  ): Promise<{ paused: boolean }> {
    const { timeoutMs, budgetMs, firstDelayMs, maxDelayMs } = { ...this.delivery, ...options };
    let lastError = '';
    let waited = 0;
    let delay = firstDelayMs;
    for (let attempt = 1; ; attempt += 1) {
      try {
        const response = await this.doFetch(state.snapshot.callback_url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${state.snapshot.resume_secret}`,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (response.ok) {
          const reply = (await response.json().catch(() => ({}))) as { paused?: boolean };
          return { paused: reply.paused === true };
        }
        const text = await response.text().catch(() => '');
        lastError = `the application answered ${response.status} to ${body.event}: ${text.slice(0, 300)}`;
        // A refusal will not change by asking again. A 408 or a 429 is not a
        // refusal: it asks for exactly that.
        if (
          response.status >= 400 &&
          response.status < 500 &&
          response.status !== 408 &&
          response.status !== 429
        ) {
          break;
        }
      } catch (error) {
        lastError = `the application could not be reached for ${body.event}: ${
          error instanceof Error ? error.message : String(error)
        }`;
      }
      if (waited >= budgetMs) break;
      const pause = Math.min(delay, maxDelayMs, budgetMs - waited);
      log.warn('a callback could not be delivered; it will be tried again', {
        run_id: state.runId,
        event: body.event,
        step_index: body.step_index,
        attempt,
        detail: lastError,
        next_attempt_in_ms: pause,
      });
      await this.sleep(pause);
      waited += pause;
      delay = Math.min(delay * 2, maxDelayMs);
      // Shutting down: the outcome is written down, and the restart delivers it.
      if (this.stopping) {
        throw new FactoryError('app_unreachable', `${lastError}; delivery interrupted by shutdown`);
      }
      if (!(await this.deps.states.get(state.runId))) {
        throw new FactoryError(
          'app_unreachable',
          `${lastError}; the run was released before it could be delivered`,
        );
      }
    }
    throw new FactoryError('app_unreachable', lastError);
  }
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

export type { StepOutcome };
