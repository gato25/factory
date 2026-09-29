<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import ArtifactViewer from '$components/ArtifactViewer.svelte';
  import { m } from '$lib/i18n';
  import Icon from '$components/Icon.svelte';
  import LaunchPanel from '$components/LaunchPanel.svelte';
  import LiveLog from '$components/LiveLog.svelte';
  import QueuePosition from '$components/QueuePosition.svelte';
  import RequirementFiles from '$components/RequirementFiles.svelte';
  import RunDetails from '$components/RunDetails.svelte';
  import StepTracker from '$components/StepTracker.svelte';
  import TicketBrief from '$components/TicketBrief.svelte';
  import TicketHead from '$components/TicketHead.svelte';
  import { pipelineName, stepName, stepTitle } from '$lib/default-names';
  import { subscribeToRun } from '$lib/events/subscribe';
  import {
    cancel,
    continueFrom,
    editRetry,
    failure,
    pause,
    retry,
    unpause
  } from '$lib/remote/run-actions.remote';
  import { repositories } from '$lib/remote/repositories.remote';
  import { log, position, run, runForTicket } from '$lib/remote/runs.remote';
  import { start, ticket } from '$lib/remote/tickets.remote';

  /**
   * Screen 06 — Ticket Run, built to artboard 06 (specs/004-bento-redesign
   * FR-020): the live log in its tabs, at the full height of the page, and
   * beside it the side column — one head tile, where the ticket is, its
   * state, how long and how many tokens, the actions, with the run's own step
   * track running down it — and what the ticket asked under it. What the run
   * produced is the Artifacts tab; the run's details are a tab of their own,
   * with no orchestration link: there is no orchestration service any more.
   */

  const TABS = [
    { id: 'output', label: m.run.tabOutput },
    { id: 'artifacts', label: m.run.tabArtifacts },
    { id: 'launch', label: m.run.tabLaunch },
    { id: 'requirements', label: m.run.tabRequirements },
    { id: 'details', label: m.run.tabDetails },
  ] as const;
  let tab = $state<(typeof TABS)[number]['id']>('output');

  const ticketId = $derived(page.params.id as string);
  /** Reactive: `.current` updates on refresh, whereas `{#await}` would not. */
  const view = $derived(runForTicket(ticketId));
  let selected = $state<number | null>(null);
  let connection = $state<'connecting' | 'live' | 'retrying'>('connecting');
  /** What the last control said, whether it worked or not. */
  let notice = $state<string | null>(null);
  let working = $state(false);
  let editing = $state(false);
  let draftTitle = $state('');
  let draftDescription = $state('');
  let draftCriteria = $state('');

  const failed = $derived(
    view.ready && view.current ? failure(view.current.run.id) : null
  );

  /**
   * A ticket with no run yet — one saved as a draft. It has no run to show, so
   * the page shows the ticket: what was asked, the documents, and a way to
   * start it. Read only when there is no run, and from the same query the
   * board uses.
   */
  const draft = $derived(view.ready && !view.current ? ticket(ticketId) : null);
  const repos = $derived(view.ready && !view.current ? repositories() : null);

  async function startDraft() {
    working = true;
    notice = null;
    try {
      const started = await start(ticketId);
      if (!started.ok) {
        // Refused, in words: it stays a draft, and says why.
        notice = started.message;
        return;
      }
      // Queued, and the execution service did not take it at once: the
      // ticket now has a run and the page shows it, with this beside it.
      notice = started.message;
      await runForTicket(ticketId).refresh();
    } catch (error) {
      notice = m.run.startFailed(error instanceof Error ? error.message : String(error));
    } finally {
      working = false;
    }
  }

  /**
   * SC-009 — retrying takes at most two interactions. Retry is one; editing
   * and retrying is one action, so opening the editor and submitting it is
   * two. Nothing here asks a person to re-create the ticket.
   */
  async function act(
    work: () => Promise<{ ok: boolean; message: string }>,
    options: { announce?: boolean } = {}
  ) {
    working = true;
    try {
      const result = await work();
      // Some outcomes are visible on the page as a lasting state. Saying the
      // same thing twice reads as two events rather than one.
      notice = options.announce === false ? null : result.message;
      await runForTicket(ticketId).refresh();
    } finally {
      working = false;
    }
  }

  function startEditing(loaded: {
    ticket: { title: string; description: string | null; acceptanceCriteria: string[] };
  }) {
    draftTitle = loaded.ticket.title;
    draftDescription = loaded.ticket.description ?? '';
    draftCriteria = loaded.ticket.acceptanceCriteria.join('\n');
    editing = true;
  }

  /**
   * A query cannot push, so the push arrives over the stream and the refresh
   * is what the interface reacts to (FR-074). The staleness budget is five
   * seconds; the transport spends about ten milliseconds of it (SC-004).
   */
  onMount(() => {
    let stop = () => {};
    void runForTicket(ticketId).then((loaded) => {
      if (!loaded) return;
      stop = subscribeToRun({
        target: loaded.run.id,
        onStateChange: (state) => {
          connection = state;
        },
        onEvent: (event) => {
          void runForTicket(ticketId).refresh();
          if (event.event === 'log_chunk' || event.event === 'log_available') {
            void log({ runId: loaded.run.id, stepIndex: event.stepIndex }).refresh();
          }
          if (event.event === 'run_changed' || event.event === 'finished') {
            void run(loaded.run.id).refresh();
          }
        }
      });
    });
    return () => stop();
  });

  const STATUS: Record<string, { label: string; tone: string }> = {
    queued: { label: m.run.statusQueued, tone: '' },
    running: { label: m.run.statusRunning, tone: 'run' },
    waiting_approval: { label: m.run.statusWaitingApproval, tone: 'wait' },
    opening_mr: { label: m.run.statusOpeningMr, tone: 'run' },
    done: { label: m.run.statusDone, tone: 'done' },
    failed: { label: m.run.statusFailed, tone: 'fail' },
    cancelled: { label: m.run.statusCancelled, tone: '' }
  };

  const nameOfStep = stepTitle;
</script>

{#if view.error}
  <p class="tile failure" role="alert">{(view.error as Error).message}</p>
{:else if !view.ready}
  <p class="tile">{m.run.loading}</p>
{:else}
  {@const loaded = view.current}
  {#if !loaded}
    {#if draft?.ready && draft.current}
      {@const t = draft.current}
      <!-- The run page's two columns: what was asked and its documents, and
           the head, with Start, in the side column. -->
      <div class="lower draft">
        <div class="main">
          {#if notice}
            <p class="tile notice" role="status">{notice}</p>
          {/if}
          <p class="tile notice" data-draft-note>{m.run.draftNote}</p>
          <TicketBrief
            {ticketId}
            description={t.description}
            criteria={t.acceptanceCriteria}
          />
          <RequirementFiles {ticketId} hasRun={false} />
        </div>

        <aside class="side">
          <TicketHead
            {ticketId}
            repositoryName={repos?.ready ? (repos.current.find((r) => r.id === t.repositoryId)?.name ?? '') : ''}
            reference={t.reference}
            title={t.title}
            branchName={t.branchName}
            createdByName={null}
            tokens={0}
            variant="run"
            stats={false}
            status={{ label: m.ticketCard.readyToStart, tone: 'queue' }}
          >
            {#snippet actions()}
              <button type="button" class="btn" disabled={working} onclick={startDraft}>
                <Icon name="play" size={14} />
                {working ? m.run.starting : m.run.startTicket}
              </button>
            {/snippet}
          </TicketHead>
        </aside>
      </div>
    {:else}
      <p class="tile">{m.run.notStarted}</p>
    {/if}
  {:else}
    {@const status = STATUS[loaded.run.status] ?? { label: loaded.run.status, tone: '' }}
    {@const step = loaded.steps[selected ?? loaded.run.currentStepIndex ?? 0]}
    {@const current = loaded.steps[loaded.run.currentStepIndex ?? -1]}
    {@const inFlight = ['queued', 'running', 'waiting_approval', 'opening_mr'].includes(
      loaded.run.status
    )}
    {@const retryable = loaded.run.status === 'failed' || loaded.run.status === 'cancelled'}

    <div class="lower">
      <div class="main">
        {#if notice}
          <p class="tile notice" role="status">{notice}</p>
        {/if}

        {#if loaded.run.status === 'queued'}
          {@const place = position(loaded.run.id)}
          {#if place.ready && place.current !== null}
            <div class="tile notice"><QueuePosition position={place.current} /></div>
          {/if}
        {/if}

        <!-- FR-102: a run whose ticket was never classified says so on the run itself. -->
        {#if loaded.ticket.classificationMissing}
          <p class="tile tile--danger notice warn" role="status">{m.runDetails.classificationMissing}</p>
        {/if}

        {#if loaded.run.pauseRequestedAt && inFlight}
          <p class="tile notice" role="status">{m.notice.pausing}</p>
        {/if}

        <!--
          Which step failed and why, in language that does not require reading
          raw output (FR-087, SC-008). The engine's own words are below it, for
          whoever wants them, rather than instead of it.
        -->
        {#if failed?.ready && failed.current}
          {@const f = failed.current}
          <section class="tile tile--danger failure" role="alert">
            <h2>
              {f.stepLabel
                ? m.run.stepDidNotFinish(stepName(f.stepLabel), (f.stepIndex ?? 0) + 1)
                : m.run.runDidNotFinish}
            </h2>
            <p>{f.what}</p>
            <p class="next">{f.next}</p>
            {#if f.stoppedByACeiling}
              <p class="small-note">{m.run.spentOfCeiling(f.spentUsd, f.ceilingUsd)}</p>
            {/if}
            {#if f.produced.length > 0}
              <p class="small-note">{m.run.producedStillReadable(f.produced.map((d) => d.path).join(', '))}</p>
            {/if}
            {#if f.detail}
              <details>
                <summary>{m.run.whatTheStepReported}</summary>
                <pre>{f.detail}</pre>
              </details>
            {/if}
          </section>
        {:else if loaded.run.failureReason}
          <p class="tile tile--danger failure" role="alert">{loaded.run.failureReason}</p>
        {/if}

        <!-- Editing and retrying is ONE action, not an edit then a retry (FR-089) -->
        {#if editing}
          <section class="tile editor">
            <h2>{m.run.editAndRetry}</h2>
            <label class="field">
              <span class="label">{m.run.title}</span>
              <input bind:value={draftTitle} />
            </label>
            <label class="field">
              <span class="label">{m.run.description}</span>
              <textarea bind:value={draftDescription} rows="4"></textarea>
            </label>
            <label class="field">
              <span class="label">{m.run.acceptanceOnePerLine}</span>
              <textarea bind:value={draftCriteria} rows="4"></textarea>
            </label>
            <div class="row">
              <button type="button" class="btn btn--secondary" onclick={() => (editing = false)}
                >{m.run.discard}</button
              >
              <button
                type="button"
                class="btn"
                disabled={working}
                onclick={async () => {
                  await act(() =>
                    editRetry({
                      ticketId,
                      title: draftTitle,
                      description: draftDescription,
                      acceptanceCriteria: draftCriteria
                    })
                  );
                  editing = false;
                }}
              >
                {m.run.saveAndRetry}
              </button>
            </div>
          </section>
        {/if}

        <div class="run-tabs" role="tablist" aria-label={m.run.runView}>
          {#each TABS as t (t.id)}
            {@const n = t.id === 'artifacts' ? loaded.artifacts.length : 0}
            <button
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              class:on={tab === t.id}
              onclick={() => (tab = t.id)}
            >
              {t.label}{#if n > 0}<span class="n">{n}</span>{/if}
            </button>
          {/each}
        </div>

        <!-- One panel, filling the shell. Only its own body scrolls. -->
        <div class="panel" role="tabpanel">
          {#if tab === 'output'}
            {#if step}
              <LiveLog
                runId={loaded.run.id}
                {step}
                live={loaded.run.status === 'running' && step.state === 'running'}
              />
            {/if}
          {:else}
            <div class="scroll">
              {#if tab === 'artifacts'}
                <ArtifactViewer
                  artifacts={loaded.artifacts}
                  mergeRequestUrl={loaded.ticket.mergeRequestUrl}
                  branchName={loaded.ticket.branchName}
                  runId={loaded.run.id}
                />
              {:else if tab === 'launch'}
                <LaunchPanel
                  ticketId={loaded.ticket.id}
                  status={loaded.ticket.status}
                  branchName={loaded.ticket.branchName}
                  hasUi={loaded.ticket.hasUi}
                />
              {:else if tab === 'requirements'}
                <RequirementFiles ticketId={loaded.ticket.id} hasRun={true} />
              {:else}
                <RunDetails view={loaded} />
              {/if}
            </div>
          {/if}
        </div>
      </div>

      <aside class="side">
        <TicketHead
          {ticketId}
          repositoryName={loaded.repository.name}
          reference={loaded.ticket.reference}
          title={loaded.ticket.title}
          branchName={loaded.ticket.branchName}
          createdByName={loaded.ticket.createdByName}
          startedAt={loaded.run.startedAt}
          tokens={loaded.run.tokens.total}
          elapsedS={loaded.steps.reduce((total, s) => total + (s.durationS ?? 0), 0)}
          pipeline={m.ticketHead.pipeline(pipelineName(loaded.pipeline.name), loaded.steps.length + 1)}
          variant="run"
          status={{
            label:
              loaded.run.status === 'running' && current
                ? m.run.statusAtStep(status.label, nameOfStep(current))
                : status.label,
            tone: status.tone,
          }}
        >
          {#snippet actions()}
            {#if connection !== 'live' && loaded.run.status === 'running'}
              <span class="reconnecting" title={m.run.reconnectingTitle}>
                {connection === 'retrying' ? m.run.reconnecting : m.run.connecting}
              </span>
            {/if}
            {#if loaded.run.status === 'waiting_approval'}
              <a class="btn btn--amber" href="/tickets/{ticketId}/approve">
                <Icon name="hand" size={14} />
                {m.run.review}
              </a>
            {/if}

            <!-- Pause lets the current step conclude (FR-096); cancel releases
                 the sandbox and leaves the branch alone (FR-097). -->
            {#if inFlight}
              {#if loaded.run.pauseRequestedAt}
                <button
                  type="button"
                  class="btn btn--secondary"
                  disabled={working}
                  onclick={() => act(() => unpause(loaded.run.id))}
                >
                  <Icon name="play" size={14} />
                  {m.run.continue}
                </button>
              {:else}
                <button
                  type="button"
                  class="btn btn--secondary"
                  disabled={working}
                  onclick={() => act(() => pause(loaded.run.id), { announce: false })}
                >
                  <Icon name="pause" size={14} />
                  {m.run.pause}
                </button>
              {/if}
              <!-- A run nothing is driving any more picks up at its first
                   unfinished step, keeping what finished and what it cost. A
                   person decides it is stuck; the application cannot see an
                   execution die. -->
              {#if !loaded.run.pauseRequestedAt && (loaded.run.status === 'queued' || loaded.run.status === 'running')}
                <button
                  type="button"
                  class="btn btn--secondary"
                  disabled={working}
                  title={m.run.continueRunTitle}
                  onclick={() => act(() => continueFrom(loaded.run.id))}
                >
                  <Icon name="rotate-ccw" size={14} />
                  {m.run.continueRun}
                </button>
              {/if}
              <button
                type="button"
                class="btn btn--danger-soft"
                disabled={working}
                onclick={() => act(() => cancel(loaded.run.id))}
              >
                <Icon name="circle-x" size={14} />
                {m.run.cancelRun}
              </button>
            {:else if retryable}
              <!--
                Offered before Retry, and only for a failed run, because it is
                almost always the cheaper of the two. Retry starts again from the
                ticket and pays for every finished step a second time; this picks
                up at the step that failed and keeps what the run already produced
                and spent. A cancelled run is not offered it: somebody stopped
                that one on purpose.
              -->
              {#if loaded.run.status === 'failed'}
                <button
                  type="button"
                  class="btn"
                  disabled={working}
                  title={m.run.continueFromFailedTitle}
                  onclick={() => act(() => continueFrom(loaded.run.id))}
                >
                  <Icon name="play" size={14} />
                  {m.run.continueFromFailed}
                </button>
              {/if}
              <button
                type="button"
                class={loaded.run.status === 'failed' ? 'btn btn--secondary' : 'btn'}
                disabled={working}
                onclick={() => act(() => retry(ticketId))}
              >
                <Icon name="rotate-ccw" size={14} />
                {m.run.retry}
              </button>
              <button
                type="button"
                class="btn btn--secondary"
                disabled={working}
                onclick={() => startEditing(loaded)}
              >
                <Icon name="pencil" size={14} />
                {m.run.editAndRetry}
              </button>
            {/if}
          {/snippet}

          <StepTracker
            steps={loaded.steps}
            run={loaded.run}
            mergeRequestUrl={loaded.ticket.mergeRequestUrl}
            classification={loaded.ticket.hasUi !== null && loaded.ticket.uiRationale
              ? `${loaded.ticket.hasUi ? m.runDetails.changesInterface : m.runDetails.noInterfaceChange} — ${loaded.ticket.uiRationale}`
              : null}
            selected={selected ?? loaded.run.currentStepIndex ?? 0}
            onSelect={(index) => {
              selected = index;
              tab = 'output';
            }}
          />
        </TicketHead>

        <!-- What the run was asked, under where it stands. -->
        <TicketBrief
          ticketId={loaded.ticket.id}
          description={loaded.ticket.description}
          criteria={loaded.ticket.acceptanceCriteria}
          onOpenDocuments={() => (tab = 'requirements')}
        />
      </aside>
    </div>
  {/if}
{/if}

<style>
  .reconnecting {
    align-self: center;
    font-size: var(--type-caption);
    color: var(--text-3);
  }
  /* The design's Cancel: a red word on a red tint, lighter than the filled
     danger button a destructive confirmation would use. */
  :global(.btn.btn--danger-soft) {
    padding: 10px 14px;
    color: var(--danger-text);
    background: var(--danger-soft);
    box-shadow: none;
  }
  :global(.btn.btn--amber) {
    color: var(--on-amber);
    background: linear-gradient(180deg, var(--amber), #d9a200);
    box-shadow: 0 4px 10px #d9a2004d;
  }

  .notice {
    margin: 0;
    padding: 14px 20px;
  }
  /* Needing attention, so red (FR-005). */
  .notice.warn {
    color: var(--danger-text);
  }
  .failure {
    margin: 0;
    color: var(--danger-text);
  }
  .failure h2,
  .editor h2 {
    margin: 0 0 8px;
    font-size: 18px;
    font-weight: 600;
  }
  .failure p {
    margin: 0 0 6px;
    color: var(--text);
  }
  .failure .next {
    color: var(--text-2);
  }
  .small-note {
    font-size: var(--type-caption);
  }
  .failure details {
    margin-top: 8px;
  }
  .failure summary {
    cursor: pointer;
    color: var(--text-2);
  }
  .failure pre {
    max-height: 240px;
    margin: 8px 0 0;
    padding: 12px;
    overflow: auto;
    border-radius: 12px;
    font: 12px/1.6 var(--font-mono);
    white-space: pre-wrap;
    color: var(--code-text);
    background: var(--code-bg);
  }

  .editor {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .row {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
  }

  /*
   * One shell under the top bar, filling the window (the frame's 20px above
   * the bar, the bar's 57, the 20 between and the 28 below): the log at the
   * full height beside the side column, and the only things that scroll are
   * the body the reader is actually reading and the side column when it
   * holds more than fits. `min-height` is the floor at which letting the
   * window scroll beats crushing the log; the panel's is the floor under
   * which a long failure or the edit form pushes the page rather than the
   * log.
   */
  .lower {
    display: flex;
    align-items: stretch;
    gap: 20px;
    height: calc(100vh - 125px);
    min-height: 560px;
  }
  .main {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 12px;
    min-width: 0;
    min-height: 0;
  }
  .panel {
    display: flex;
    flex: 1;
    min-height: 320px;
  }
  /* Every tab but the log is an ordinary tile that scrolls as a whole. */
  .scroll {
    flex: 1;
    min-width: 0;
    overflow-y: auto;
  }
  /*
   * The head's column, 400px of tile. It scrolls when the head, a long
   * pipeline and what was asked are taller than the window; the padding is
   * room for the tiles' shadows, which the scroll would otherwise cut.
   */
  .side {
    display: flex;
    flex: none;
    flex-direction: column;
    gap: 12px;
    width: 420px;
    margin: 0 -10px;
    padding: 0 10px 36px;
    overflow-y: auto;
    scrollbar-width: thin;
  }
  /* A ticket not yet started has no log: its columns are as tall as they are. */
  .lower.draft {
    align-items: flex-start;
    height: auto;
    min-height: 0;
  }
  .lower.draft .side {
    overflow: visible;
  }

  /* The design's tabs: an accent track, the current tab raised in white. */
  .run-tabs {
    display: flex;
    align-self: flex-start;
    gap: 4px;
    padding: 4px;
    border-radius: 14px;
    background: var(--accent-soft);
  }
  .run-tabs button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 8px 14px;
    border: 0;
    border-radius: 10px;
    font: 500 var(--type-body) / 1.2 var(--font);
    color: var(--text-2);
    background: none;
    cursor: pointer;
  }
  .run-tabs button:hover {
    color: var(--text);
  }
  .run-tabs button.on {
    font-weight: 700;
    color: var(--text);
    background: var(--surface);
    box-shadow: 0 2px 6px var(--shadow-depth);
  }
  .run-tabs .n {
    padding: 1px 7px;
    border-radius: var(--r-pill);
    font-family: var(--font-head);
    font-size: var(--type-caption);
    font-weight: 700;
    color: var(--accent-text);
    background: var(--accent-soft);
  }
  .run-tabs button.on .n {
    background: var(--accent-soft);
  }

  @media (max-width: 1100px) {
    .lower,
    .lower.draft {
      flex-direction: column;
      align-items: stretch;
      height: auto;
      min-height: 0;
    }
    .panel {
      min-height: 70vh;
    }
    /* Stacked, the head comes first: it says what the log below is of. */
    .side {
      order: -1;
      width: auto;
      margin: 0;
      padding: 0;
      overflow: visible;
    }
  }
</style>
