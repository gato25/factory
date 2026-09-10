<script lang="ts">
  import QueuePosition from '$components/QueuePosition.svelte';
  import { position } from '$lib/remote/runs.remote';
  import type { RunView } from '$lib/services/run-view';

  let { view }: { view: RunView } = $props();

  const place = $derived(view.run.status === 'queued' ? position(view.run.id) : null);
</script>

<section class="card">
  <h2 class="section">Run details</h2>
  <dl>
    <dt>Pipeline</dt>
    <dd>{view.pipeline.name} <span class="muted small">v{view.pipeline.version}</span></dd>

    <dt>Attempt</dt>
    <dd>{view.run.attempt}</dd>

    <dt>Repository</dt>
    <dd>{view.repository.fullPath}</dd>

    <dt>Branch</dt>
    <dd><code>{view.ticket.branchName}</code> → <code>{view.repository.defaultBranch}</code></dd>

    <dt>Sandbox</dt>
    <dd>
      {#if view.run.containerId}
        <code>{view.run.containerId.slice(0, 12)}</code>
      {:else}
        <span class="muted">not created</span>
      {/if}
    </dd>

    <!-- A reference identifying the execution in the orchestrator (FR-078) -->
    <dt>Execution</dt>
    <dd>
      {#if view.run.orchestratorExecutionId}
        <code>{view.run.orchestratorExecutionId}</code>
      {:else}
        <span class="muted">not started</span>
      {/if}
    </dd>

    <dt>Budget</dt>
    <dd>${view.run.costUsd} of ${view.run.costCeilingUsd}</dd>
  </dl>

  {#if place?.ready}
    <!-- Runs beyond the concurrency ceiling wait, and see where (FR-082) -->
    <QueuePosition position={place.current} />
  {/if}

  {#if view.ticket.classificationMissing}
    <!-- FR-102: the warning is a field on the run, not a log line -->
    <p class="badge warn">
      The specification step recorded no decision about the interface, so design was skipped.
      Check whether this ticket needed screens.
    </p>
  {:else if view.ticket.hasUi !== null}
    <p class="small muted">
      {view.ticket.hasUi ? 'Changes the interface' : 'No interface change'}
      {#if view.ticket.uiRationale}— {view.ticket.uiRationale}{/if}
    </p>
  {/if}
</section>

<style>
  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 6px 14px;
    margin: 0;
  }
  dt {
    color: var(--text-3);
    font-size: 12px;
  }
  dd {
    margin: 0;
    overflow-wrap: anywhere;
  }
  code {
    background: var(--surface-2);
    padding: 1px 5px;
    border-radius: 4px;
    font-size: 12px;
  }
  p.badge {
    display: block;
    margin-top: 12px;
    line-height: 1.5;
  }
</style>
