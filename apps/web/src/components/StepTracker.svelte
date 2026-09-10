<script lang="ts">
  import type { RunView } from '$lib/services/run-view';

  let {
    steps,
    run,
    onSelect,
    selected
  }: {
    steps: RunView['steps'];
    run: RunView['run'];
    onSelect?: (index: number) => void;
    selected?: number;
  } = $props();

  const spentPercent = $derived(
    Math.min(100, Math.round((Number(run.costUsd) / Number(run.costCeilingUsd)) * 100))
  );

  const MARK: Record<RunView['steps'][number]['state'], string> = {
    done: '✓',
    running: '●',
    failed: '✕',
    skipped: '–',
    pending: '○'
  };
</script>

<section class="card">
  <h2 class="section">Pipeline steps</h2>

  <ol>
    {#each steps as step (step.index)}
      <li class={step.state} class:selected={selected === step.index}>
        <button type="button" onclick={() => onSelect?.(step.index)}>
          <span class="mark" aria-hidden="true">{MARK[step.state]}</span>
          <span class="body">
            <span class="label">
              {step.label}
              {#if step.conditional}<span class="badge small">conditional</span>{/if}
            </span>
            {#if step.model}<span class="muted small">{step.model}</span>{/if}

            <!-- A skipped step is shown with its reason, never omitted (FR-075a) -->
            {#if step.state === 'skipped'}
              <span class="muted small">skipped — {step.conditionNotMet}</span>
            {:else if step.state === 'failed'}
              <span class="fail small">{step.errorDetail ?? 'failed'}</span>
            {:else if step.summary}
              <span class="muted small">{step.summary}</span>
            {/if}
          </span>
          <span class="meta small muted">
            {#if step.durationS}{step.durationS}s{/if}
            {#if step.costUsd && step.costUsd !== '0.0000'}&middot; ${step.costUsd}{/if}
          </span>
        </button>
      </li>
    {/each}
    <li class="implicit">
      <span class="mark" aria-hidden="true">○</span>
      <span class="body"><span class="label">Open merge request</span></span>
    </li>
  </ol>

  <div class="spend">
    <div class="bar"><div class="fill" style="width: {spentPercent}%"></div></div>
    <p class="small muted">
      ${run.costUsd} of ${run.costCeilingUsd} ceiling &middot; {run.timeCeilingMinutes} min limit
    </p>
  </div>
</section>

<style>
  ol {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
  }
  li {
    border-top: 1px solid var(--line-2);
  }
  li:first-child {
    border-top: 0;
  }
  button {
    display: grid;
    grid-template-columns: 20px 1fr auto;
    gap: 10px;
    width: 100%;
    padding: 10px 4px;
    border: 0;
    background: none;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  li.selected button {
    background: #f6f8ff;
  }
  .implicit {
    display: grid;
    grid-template-columns: 20px 1fr;
    gap: 10px;
    padding: 10px 4px;
    color: var(--ink-3);
  }
  .mark {
    text-align: center;
    color: var(--ink-3);
  }
  li.done .mark { color: var(--ok); }
  li.running .mark { color: var(--accent); }
  li.failed .mark { color: var(--bad); }
  li.skipped .mark { color: var(--ink-3); }
  .body {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .label {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  li.skipped .label {
    text-decoration: line-through;
    color: var(--ink-3);
  }
  .fail {
    color: var(--bad);
  }
  .meta {
    white-space: nowrap;
  }
  .spend {
    margin-top: 12px;
    border-top: 1px solid var(--line-2);
    padding-top: 12px;
  }
  .bar {
    height: 6px;
    border-radius: 999px;
    background: var(--line-2);
    overflow: hidden;
  }
  .fill {
    height: 100%;
    background: var(--accent);
  }
  .spend p {
    margin: 6px 0 0;
  }
</style>
