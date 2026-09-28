<script lang="ts">
  import QueuePosition from '$components/QueuePosition.svelte';
  import { pipelineName } from '$lib/default-names';
  import { position } from '$lib/remote/runs.remote';
  import { m } from '$lib/i18n';
  import type { RunView } from '$lib/services/run-view';

  let { view }: { view: RunView } = $props();

  const place = $derived(view.run.status === 'queued' ? position(view.run.id) : null);
</script>

<section class="tile details">
  <h2>{m.runDetails.heading}</h2>
  <dl>
    <dt>{m.runDetails.pipeline}</dt>
    <dd>{pipelineName(view.pipeline.name)} <span class="muted">v{view.pipeline.version}</span></dd>

    <dt>{m.runDetails.run}</dt>
    <dd>
      {view.ticket.reference}-r{view.run.attempt}
      <span class="muted">{m.runDetails.attemptOrdinal(view.run.attempt)}</span>
    </dd>

    <dt>{m.runDetails.repository}</dt>
    <dd>{view.repository.fullPath}</dd>

    <dt>{m.runDetails.branch}</dt>
    <dd><code>{view.ticket.branchName}</code> → <code>{view.repository.defaultBranch}</code></dd>

    <dt>{m.runDetails.sandbox}</dt>
    <dd>
      {#if view.run.containerId}
        <code>{view.run.containerId.slice(0, 12)}</code>
      {:else}
        <span class="muted">{m.runDetails.notCreated}</span>
      {/if}
    </dd>

    <!-- A reference identifying the execution on the execution service (FR-078) -->
    <dt>{m.runDetails.execution}</dt>
    <dd>
      {#if view.run.orchestratorExecutionId}
        <code>{view.run.orchestratorExecutionId}</code>
      {:else}
        <span class="muted">{m.runDetails.notStarted}</span>
      {/if}
    </dd>

    <dt>{m.runDetails.budget}</dt>
    <dd>{m.runDetails.budgetOf(view.run.costUsd, view.run.costCeilingUsd)}</dd>

    <!--
      Per step, and it says so. The tracker used to print "45 min limit"
      beside the run's spend, which read as a budget for the run: a run that
      took ninety-five minutes under that ceiling looked like a bug, when in
      fact the ceiling is a deadline each step gets separately.
    -->
    <dt>{m.runDetails.time}</dt>
    <dd>{m.runDetails.timeCap(view.run.timeCeilingMinutes)}</dd>
  </dl>

  {#if place?.ready}
    <!-- Runs beyond the concurrency ceiling wait, and see where (FR-082) -->
    <QueuePosition position={place.current} />
  {/if}

  {#if view.ticket.classificationMissing}
    <!-- FR-102: the warning is a field on the run, not a log line -->
    <p class="note">
      {m.runDetails.classificationMissing}
    </p>
  {:else if view.ticket.hasUi !== null}
    <p class="small muted">
      {view.ticket.hasUi ? m.runDetails.changesInterface : m.runDetails.noInterfaceChange}
      {#if view.ticket.uiRationale}— {view.ticket.uiRationale}{/if}
    </p>
  {/if}
</section>

<style>
  .details {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 22px;
  }
  h2 {
    margin: 0;
    font-family: var(--font-head);
    font-size: 15px;
    font-weight: 600;
    color: var(--text);
  }
  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 10px 16px;
    margin: 0;
    font-size: var(--type-body);
  }
  dt {
    color: var(--text-2);
  }
  dd {
    margin: 0;
    color: var(--text);
    text-align: right;
    overflow-wrap: anywhere;
  }
  code {
    padding: 1px 6px;
    border-radius: 6px;
    font-size: inherit;
    background: var(--surface-2);
  }
  /* Needing attention, so red (FR-005), and said in words beside it. */
  .note {
    margin: 0;
    padding: 10px 14px;
    border-radius: 12px;
    font-size: var(--type-body);
    line-height: 1.5;
    color: var(--danger-text);
    background: var(--danger-soft);
  }
</style>
