<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import ArtifactViewer from '$components/ArtifactViewer.svelte';
  import LiveLog from '$components/LiveLog.svelte';
  import RunDetails from '$components/RunDetails.svelte';
  import StepTracker from '$components/StepTracker.svelte';
  import { subscribeToRun } from '$lib/events/subscribe';
  import { log, run, runForTicket } from '$lib/remote/runs.remote';

  const ticketId = $derived(page.params.id as string);
  /** Reactive: `.current` updates on refresh, whereas `{#await}` would not. */
  const view = $derived(runForTicket(ticketId));
  let selected = $state<number | null>(null);
  let connection = $state<'connecting' | 'live' | 'retrying'>('connecting');

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
          <!-- Pause and Cancel arrive with user story 4 (T131, T132) -->
          <button type="button" disabled title="Arrives with the recovery story">Pause</button>
          <button type="button" disabled title="Arrives with the recovery story">Cancel run</button>
        </div>
      </header>

      {#if loaded.run.failureReason}
        <p class="card failure" role="alert">
          <strong>Step {(loaded.run.failureStepIndex ?? 0) + 1} failed.</strong>
          {loaded.run.failureReason}
        </p>
      {/if}

      <div class="layout">
        <div class="column">
          <StepTracker
            steps={loaded.steps}
            run={loaded.run}
            selected={selected ?? loaded.run.currentStepIndex ?? 0}
            onSelect={(index) => (selected = index)}
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
    background: var(--line-2);
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
    border: 1px solid var(--line);
    border-radius: var(--r-sm);
    background: var(--surface);
    font: inherit;
    cursor: pointer;
  }
  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .failure {
    border-left: 3px solid var(--bad);
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
