<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import ArtifactViewer from '$components/ArtifactViewer.svelte';
  import LiveLog from '$components/LiveLog.svelte';
  import RunDetails from '$components/RunDetails.svelte';
  import StepTracker from '$components/StepTracker.svelte';
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

      <header class="card head">
        <div>
          <p class="small muted">
            <a href="/tickets">Tickets</a> / {loaded.repository.fullPath}
          </p>
          <h1>{loaded.ticket.reference} {loaded.ticket.title}</h1>
          <p class="small muted">
            <code>{loaded.ticket.branchName}</code>
            &middot; {loaded.ticket.createdByName ?? 'unknown'}
            &middot; attempt {loaded.run.attempt}
            &middot; ${loaded.run.costUsd} so far
          </p>
        </div>
        <div class="actions">
          <span class="badge {status.tone}">{status.label}</span>
          {#if connection !== 'live' && loaded.run.status === 'running'}
            <span class="badge small" title="Reconnecting to the live stream">
              {connection === 'retrying' ? 'reconnecting…' : 'connecting…'}
            </span>
          {/if}
          {#if loaded.run.status === 'waiting_approval'}
            <a class="review" href="/tickets/{ticketId}/approve">Review</a>
          {/if}

          <!-- Pause lets the current step conclude (FR-096); cancel releases
               the sandbox and leaves the branch alone (FR-097). -->
          {#if inFlight}
            {#if loaded.run.pauseRequestedAt}
              <button
                type="button"
                disabled={working}
                onclick={() => act(() => unpause(loaded.run.id))}>Continue</button
              >
            {:else}
              <button
                type="button"
                disabled={working}
                onclick={() => act(() => pause(loaded.run.id), { announce: false })}
                >Pause</button
              >
            {/if}
            <button
              type="button"
              class="danger"
              disabled={working}
              onclick={() => act(() => cancel(loaded.run.id))}>Cancel run</button
            >
          {:else if retryable}
            <button
              type="button"
              class="primary"
              disabled={working}
              onclick={() => act(() => retry(ticketId))}>Retry</button
            >
            <button type="button" disabled={working} onclick={() => startEditing(loaded)}>
              Edit &amp; retry
            </button>
          {/if}
        </div>
      </header>

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

      <div class="layout">
        <div class="column">
          <StepTracker
            steps={loaded.steps}
            run={loaded.run}
            selected={selected ?? loaded.run.currentStepIndex ?? 0}
            onSelect={(index) => (selected = index)}
            onRetry={retryable ? () => act(() => retry(ticketId)) : undefined}
            retrying={working}
          />
          {#if step}
            <LiveLog
              runId={loaded.run.id}
              {step}
              live={loaded.run.status === 'running' && step.state === 'running'}
            />
          {/if}
        </div>
        <div class="column">
          <RunDetails view={loaded} />
          <ArtifactViewer
            artifacts={loaded.artifacts}
            mergeRequestUrl={loaded.ticket.mergeRequestUrl}
          />
        </div>
      </div>
  {/if}
{/if}

<style>
  .head {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 16px;
    flex-wrap: wrap;
    margin-bottom: 16px;
  }
  .head p {
    margin: 0 0 4px;
  }
  h1 {
    margin: 0 0 4px;
    font-size: 20px;
  }
  code {
    background: var(--surface-2);
    padding: 1px 5px;
    border-radius: 4px;
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  button {
    padding: 7px 12px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: var(--surface);
    font: inherit;
    cursor: pointer;
  }
  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .review {
    padding: 7px 14px;
    border-radius: var(--r-sm);
    background: var(--accent);
    color: #fff;
    text-decoration: none;
    font-weight: 600;
  }
  .notice {
    border-left: 3px solid var(--accent);
    margin: 0 0 16px;
    padding: 12px 16px;
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
    font: 12px/1.6 ui-monospace, monospace;
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
    box-sizing: border-box;
    resize: vertical;
  }
  .row {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
  }
  .actions button.primary {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
    font-weight: 600;
  }
  .actions button.danger {
    color: var(--danger);
    border-color: #f3c7c4;
  }
  .failure {
    border-left: 3px solid var(--danger);
    margin: 0 0 16px;
  }
  .layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 340px;
    gap: 16px;
    align-items: start;
  }
  .column {
    display: flex;
    flex-direction: column;
    gap: 16px;
    min-width: 0;
  }
  @media (max-width: 1000px) {
    .layout {
      grid-template-columns: 1fr;
    }
  }
</style>
