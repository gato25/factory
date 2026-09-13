<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import ArtifactViewer from '$components/ArtifactViewer.svelte';
  import Icon from '$components/Icon.svelte';
  import LaunchPanel from '$components/LaunchPanel.svelte';
  import LiveLog from '$components/LiveLog.svelte';
  import RequirementFiles from '$components/RequirementFiles.svelte';
  import RunDetails from '$components/RunDetails.svelte';
  import StepTracker from '$components/StepTracker.svelte';
  import TicketHead from '$components/TicketHead.svelte';
  import { subscribeToRun } from '$lib/events/subscribe';
  import {
    cancel,
    editRetry,
    failure,
    pause,
    retry,
    unpause
  } from '$lib/remote/run-actions.remote';
  import { log, run, runForTicket } from '$lib/remote/runs.remote';

  /**
   * Screen 06 — Ticket Run, built to `design.pen`: a crumb, the title with
   * where the run is, a meta row carrying the branch, the author, how long
   * it has been going and what it has cost, then the horizontal tracker, and
   * below it the live log beside a 360px column of artifacts and details.
   */

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
    queued: { label: 'Queued', tone: '' },
    running: { label: 'Running', tone: 'live' },
    waiting_approval: { label: 'Waiting for approval', tone: 'warn' },
    opening_mr: { label: 'Opening merge request', tone: 'live' },
    done: { label: 'Done', tone: 'ok' },
    failed: { label: 'Failed', tone: 'bad' },
    cancelled: { label: 'Cancelled', tone: '' }
  };
</script>

{#if view.error}
  <p class="card failure" role="alert">{(view.error as Error).message}</p>
{:else if !view.ready}
  <p class="card">Loading the run…</p>
{:else}
  {@const loaded = view.current}
  {#if !loaded}
    <p class="card">This ticket has not been started yet.</p>
  {:else}
      {@const status = STATUS[loaded.run.status] ?? { label: loaded.run.status, tone: '' }}
      {@const step = loaded.steps[selected ?? loaded.run.currentStepIndex ?? 0]}
      {@const inFlight = ['queued', 'running', 'waiting_approval', 'opening_mr'].includes(
        loaded.run.status
      )}
      {@const retryable = loaded.run.status === 'failed' || loaded.run.status === 'cancelled'}

      <TicketHead
        {ticketId}
        repositoryName={loaded.repository.name}
        reference={loaded.ticket.reference}
        title={loaded.ticket.title}
        branchName={loaded.ticket.branchName}
        createdByName={loaded.ticket.createdByName}
        startedAt={loaded.run.startedAt}
        costUsd={loaded.run.costUsd}
        status={{
          label:
            loaded.run.status === 'running' && step
              ? `${status.label} · ${step.label}`
              : status.label,
          tone: status.tone,
        }}
      >
        {#snippet actions()}
          {#if connection !== 'live' && loaded.run.status === 'running'}
            <span class="reconnecting" title="Reconnecting to the live stream">
              {connection === 'retrying' ? 'reconnecting…' : 'connecting…'}
            </span>
          {/if}
          {#if loaded.run.status === 'waiting_approval'}
            <a class="review" href="/tickets/{ticketId}/approve">
              <Icon name="hand" size={16} />
              <span>Review</span>
            </a>
          {/if}

          <!-- Pause lets the current step conclude (FR-096); cancel releases
               the sandbox and leaves the branch alone (FR-097). -->
          {#if inFlight}
            {#if loaded.run.pauseRequestedAt}
              <button
                type="button"
                class="secondary"
                disabled={working}
                onclick={() => act(() => unpause(loaded.run.id))}
              >
                <Icon name="play" size={16} />
                <span>Continue</span>
              </button>
            {:else}
              <button
                type="button"
                class="secondary"
                disabled={working}
                onclick={() => act(() => pause(loaded.run.id), { announce: false })}
              >
                <Icon name="pause" size={16} />
                <span>Pause</span>
              </button>
            {/if}
            <button
              type="button"
              class="secondary"
              disabled={working}
              onclick={() => act(() => cancel(loaded.run.id))}
            >
              <Icon name="circle-x" size={16} />
              <span>Cancel run</span>
            </button>
          {:else if retryable}
            <button
              type="button"
              class="primary"
              disabled={working}
              onclick={() => act(() => retry(ticketId))}
            >
              <Icon name="rotate-ccw" size={16} />
              <span>Retry</span>
            </button>
            <button
              type="button"
              class="secondary"
              disabled={working}
              onclick={() => startEditing(loaded)}
            >
              <Icon name="pencil" size={16} />
              <span>Edit &amp; retry</span>
            </button>
          {/if}
        {/snippet}
      </TicketHead>

      {#if notice}
        <p class="card notice" role="status">{notice}</p>
      {/if}

      {#if loaded.run.pauseRequestedAt && inFlight}
        <p class="card notice" role="status">
          Pausing. The step running now will finish, and nothing further will start.
        </p>
      {/if}

      <!--
        Which step failed and why, in language that does not require reading
        raw output (FR-087, SC-008). The engine's own words are below it, for
        whoever wants them, rather than instead of it.
      -->
      {#if failed?.ready && failed.current}
        {@const f = failed.current}
        <section class="card failure" role="alert">
          <h2>
            {#if f.stepLabel}{f.stepLabel} — step {(f.stepIndex ?? 0) + 1}{:else}This run{/if}
            did not finish
          </h2>
          <p>{f.what}</p>
          <p class="next">{f.next}</p>
          {#if f.stoppedByACeiling}
            <p class="small muted">Spent ${f.spentUsd} of a ${f.ceilingUsd} ceiling.</p>
          {/if}
          {#if f.produced.length > 0}
            <p class="small muted">
              A retry starts again from the ticket, but what this attempt produced is still
              readable: {f.produced.map((d) => d.path).join(', ')}.
            </p>
          {/if}
          {#if f.detail}
            <details>
              <summary class="small">What the step itself reported</summary>
              <pre>{f.detail}</pre>
            </details>
          {/if}
        </section>
      {:else if loaded.run.failureReason}
        <p class="card failure" role="alert">{loaded.run.failureReason}</p>
      {/if}

      <!-- Editing and retrying is ONE action, not an edit then a retry (FR-089) -->
      {#if editing}
        <section class="card editor">
          <h2>Edit and retry</h2>
          <label>
            <span class="small muted">Title</span>
            <input bind:value={draftTitle} />
          </label>
          <label>
            <span class="small muted">Description</span>
            <textarea bind:value={draftDescription} rows="4"></textarea>
          </label>
          <label>
            <span class="small muted">Acceptance criteria, one per line</span>
            <textarea bind:value={draftCriteria} rows="4"></textarea>
          </label>
          <div class="row">
            <button type="button" onclick={() => (editing = false)}>Discard</button>
            <button
              type="button"
              class="primary"
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
              Save &amp; retry
            </button>
          </div>
        </section>
      {/if}

      <!-- The tracker spans the width; the log and the column sit under it,
           as the artboard lays them out. -->
      <StepTracker
        steps={loaded.steps}
        run={loaded.run}
        selected={selected ?? loaded.run.currentStepIndex ?? 0}
        onSelect={(index) => (selected = index)}
        onRetry={retryable ? () => act(() => retry(ticketId)) : undefined}
        retrying={working}
      />

      <div class="lower">
        {#if step}
          <LiveLog
            runId={loaded.run.id}
            {step}
            live={loaded.run.status === 'running' && step.state === 'running'}
          />
        {/if}
        <div class="right">
          <ArtifactViewer
            artifacts={loaded.artifacts}
            mergeRequestUrl={loaded.ticket.mergeRequestUrl}
            branchName={loaded.ticket.branchName}
          />
          <!-- The branch, running (003). Under the artifacts because the
               merge request is what a reviewer reads first, and this is what
               they press to see whether it works. -->
          <LaunchPanel
            ticketId={loaded.ticket.id}
            status={loaded.ticket.status}
            branchName={loaded.ticket.branchName}
            hasUi={loaded.ticket.hasUi}
          />
          <RequirementFiles ticketId={loaded.ticket.id} hasRun={true} />
          <RunDetails view={loaded} />
        </div>
      </div>
  {/if}
{/if}

<style>
  /* The buttons the head takes as a snippet, styled here because this is
     where they live. */
  .review,
  button.secondary,
  button.primary {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 10px 16px;
    border-radius: var(--r-sm);
    font: inherit;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    text-decoration: none;
  }
  .secondary {
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text);
  }
  .secondary :global(svg) {
    color: var(--text-2);
  }
  .secondary:hover:not(:disabled) {
    border-color: var(--accent);
  }
  button.primary,
  .review {
    border: 1px solid var(--accent);
    background: var(--accent);
    color: var(--text-inv);
    font-weight: 600;
  }
  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .reconnecting {
    font-size: 12px;
    color: var(--text-3);
  }

  /* The log fills; the column beside it is the artboard's 360px. */
  .lower {
    display: flex;
    align-items: stretch;
    gap: 24px;
    margin-top: 16px;
  }
  .right {
    display: flex;
    flex-direction: column;
    gap: 16px;
    width: 360px;
    flex: none;
  }

  .notice {
    border-left: 3px solid var(--accent);
    margin: 0 0 16px;
    padding: 12px 16px;
  }
  .failure {
    border-left: 3px solid var(--danger);
    margin: 0 0 16px;
  }
  .failure h2 {
    margin: 0 0 6px;
    font-size: 15px;
  }
  .failure p {
    margin: 0 0 6px;
  }
  .failure .next {
    color: var(--text-2);
  }
  .failure details {
    margin-top: 8px;
  }
  .failure summary {
    cursor: pointer;
    color: var(--text-3);
  }
  .failure pre {
    margin: 8px 0 0;
    padding: 10px;
    background: var(--surface-2);
    border-radius: var(--r-sm);
    font: 12px/1.6 var(--font-mono);
    white-space: pre-wrap;
    max-height: 240px;
    overflow: auto;
  }

  .editor {
    margin-bottom: 16px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .editor h2 {
    margin: 0;
    font-size: 15px;
  }
  .editor label {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .editor input,
  .editor textarea {
    padding: 9px 12px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    font: inherit;
    width: 100%;
    resize: vertical;
  }
  .editor button {
    padding: 9px 14px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: var(--surface);
    font: inherit;
    cursor: pointer;
  }
  .editor button.primary {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--text-inv);
    font-weight: 600;
  }
  .row {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
  }

  @media (max-width: 1100px) {
    .lower {
      flex-direction: column;
    }
    .right {
      width: auto;
    }
  }
</style>
