<script lang="ts">
  import Icon from '$components/Icon.svelte';
  import type { RunView } from '$lib/services/run-view';

  /**
   * `design.pen`'s horizontal tracker: a 34px circle per step joined by a
   * 2px connector, with the step's name and what it took under it. Green
   * behind, blue at the running one, an empty ring ahead.
   *
   * What the artboard has no room for is under it rather than dropped: why a
   * step was skipped (FR-075a), why the run failed and in whose words
   * (FR-087), and the Retry that belongs beside the step that failed.
   */
  let {
    steps,
    run,
    onSelect,
    selected,
    onRetry,
    retrying = false,
  }: {
    steps: RunView['steps'];
    run: RunView['run'];
    onSelect?: (index: number) => void;
    selected?: number;
    /** Absent when the viewer has nothing to retry — a live run. */
    onRetry?: () => void;
    retrying?: boolean;
  } = $props();

  /**
   * The step that failed, so it is the one the eye lands on and the one the
   * Retry action sits beside (FR-087). The run's own record of where it
   * failed wins over a step row, because a ceiling stops a run between steps.
   */
  const failedIndex = $derived(
    run.failureStepIndex ?? (steps.find((step) => step.state === 'failed')?.index ?? null),
  );

  const spentPercent = $derived(
    Math.min(100, Math.round((Number(run.costUsd) / Number(run.costCeilingUsd)) * 100)),
  );

  const chosen = $derived(steps.find((step) => step.index === selected) ?? null);
  const skipped = $derived(steps.filter((step) => step.state === 'skipped'));

  /** Enough to recognise the failure, not enough to bury the list. */
  function firstLine(detail: string | null | undefined): string {
    if (!detail) return 'failed';
    const line = detail.split('\n')[0]?.trim() ?? '';
    if (!line) return 'failed';
    return line.length > 100 ? `${line.slice(0, 100)}…` : line;
  }

  const MARK: Record<RunView['steps'][number]['state'], string> = {
    done: 'check',
    running: 'code',
    failed: 'circle-x',
    skipped: 'chevron-right',
    pending: 'timer',
  };

  /** "2m 10s · $0.14", as the artboard writes it. */
  function took(step: RunView['steps'][number]): string {
    const parts: string[] = [];
    if (step.state === 'running') parts.push('Running');
    else if (step.state === 'pending') parts.push('waiting');
    else if (step.state === 'skipped') parts.push('skipped');
    else if (step.durationS) {
      const minutes = Math.floor(step.durationS / 60);
      const seconds = step.durationS % 60;
      parts.push(minutes > 0 ? `${minutes}m ${String(seconds).padStart(2, '0')}s` : `${seconds}s`);
    }
    if (step.costUsd && step.costUsd !== '0.0000') parts.push(`$${step.costUsd}`);
    return parts.join(' · ') || '—';
  }
</script>

<section class="card">
  <ol class="track">
    {#each steps as step (step.index)}
      <li class={step.state} class:culprit={step.index === failedIndex}>
        <button
          type="button"
          class:on={selected === step.index}
          aria-label="Step {step.index + 1} — {step.label}"
          onclick={() => onSelect?.(step.index)}
        >
          <span class="circle"><Icon name={MARK[step.state]} size={16} /></span>
          <span class="tx">
            <span class="n">{step.label}</span>
            <span class="s">{took(step)}</span>
          </span>
        </button>
        <span class="connector"></span>
      </li>
    {/each}

    <!-- Implicit and always last (FR-029) -->
    <li class="pending implicit">
      <span class="static">
        <span class="circle"><Icon name="git-pull-request" size={16} /></span>
        <span class="tx">
          <span class="n">Merge request</span>
          <span class="s">{run.status === 'done' ? 'opened' : 'waiting'}</span>
        </span>
      </span>
    </li>
  </ol>

  <!--
    What the artboard's row cannot carry. A skipped step is shown WITH its
    reason and never omitted (FR-075a), so these are listed whether or not
    the step is the one selected.
  -->
  {#each skipped as step (step.index)}
    <p class="note">{step.label} skipped — {step.conditionNotMet}.</p>
  {/each}
  {#if chosen?.summary && chosen.state === 'done'}
    <p class="note">{chosen.label} — {chosen.summary}</p>
  {/if}

  {#if failedIndex !== null}
    {@const culprit = steps.find((step) => step.index === failedIndex)}
    <div class="failed">
      <p>
        {#if run.failureReason}
          {run.failureReason}
        {:else if culprit}
          {firstLine(culprit.errorDetail)}
        {/if}
      </p>
      {#if onRetry}
        <div class="retry">
          <button type="button" class="action" onclick={onRetry} disabled={retrying}>
            {retrying ? 'Retrying…' : 'Retry from here'}
          </button>
          <span class="small muted">A new attempt on this ticket. This one stays readable.</span>
        </div>
      {/if}
    </div>
  {/if}

  <div class="spend">
    <div class="bar"><div class="fill" style="width: {spentPercent}%"></div></div>
    <p class="small muted">
      ${run.costUsd} of ${run.costCeilingUsd} ceiling &middot; {run.timeCeilingMinutes} min limit
    </p>
  </div>
</section>

<style>
  .card {
    padding: 16px 20px;
    background: var(--surface);
    border: 1px solid var(--card-border);
    border-radius: var(--r-lg);
    box-shadow: 0 1px 2px #0f172a0a;
  }

  .track {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    align-items: center;
  }
  .track > li {
    display: flex;
    align-items: center;
    gap: 9px;
    flex: 1;
    min-width: 0;
  }
  .track > li:last-child {
    flex: none;
  }

  button,
  .static {
    display: flex;
    align-items: center;
    gap: 9px;
    flex: none;
    padding: 4px 6px;
    margin: -4px -6px;
    border: 0;
    border-radius: var(--r-sm);
    background: none;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .static {
    cursor: default;
  }
  button:hover,
  button.on {
    background: var(--surface-2);
  }

  .circle {
    display: grid;
    place-items: center;
    width: 34px;
    height: 34px;
    border-radius: 999px;
    flex: none;
    /* Ahead of the run: an empty ring, as the artboard draws it. */
    background: var(--surface);
    border: 2px solid var(--border);
    color: var(--text-3);
  }
  li.done .circle {
    background: var(--success);
    border-color: var(--success);
    color: var(--text-inv);
  }
  li.running .circle {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--text-inv);
  }
  li.failed .circle,
  li.culprit .circle {
    background: var(--danger);
    border-color: var(--danger);
    color: var(--text-inv);
  }
  li.skipped .circle {
    background: var(--surface-2);
    border-color: var(--surface-2);
    color: var(--text-3);
  }

  .tx {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .n {
    font-size: 13px;
    font-weight: 600;
    color: var(--text);
  }
  .s {
    font-size: 11px;
    color: var(--text-3);
  }
  li.running .s {
    color: var(--accent-text);
  }
  li.pending .n,
  li.skipped .n {
    color: var(--text-3);
  }
  li.skipped .n {
    text-decoration: line-through;
  }

  .connector {
    flex: 1;
    min-width: 12px;
    height: 2px;
    background: var(--border);
  }
  li.done .connector {
    background: var(--success);
  }
  li.failed .connector,
  li.culprit .connector {
    background: var(--danger);
  }

  .note {
    margin: 14px 0 0;
    padding-top: 12px;
    border-top: 1px solid var(--border);
    font-size: 12px;
    color: var(--text-2);
  }

  .failed {
    margin-top: 14px;
    padding: 12px 14px;
    border-radius: var(--r-md);
    background: var(--danger-soft);
  }
  .failed p {
    margin: 0;
    font-size: 13px;
    color: var(--danger);
  }
  .retry {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    margin-top: 10px;
  }
  .retry button.action {
    padding: 7px 14px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: var(--surface);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  .retry button.action:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .spend {
    margin-top: 14px;
    border-top: 1px solid var(--border);
    padding-top: 12px;
  }
  .bar {
    height: 6px;
    border-radius: 999px;
    background: var(--surface-2);
    overflow: hidden;
  }
  .fill {
    height: 100%;
    background: var(--accent);
  }
  .spend p {
    margin: 6px 0 0;
  }

  /* Narrow: the row becomes a column rather than shrinking into nothing. */
  @media (max-width: 1100px) {
    .track {
      flex-direction: column;
      align-items: stretch;
    }
    .track > li {
      flex-direction: row;
    }
    .connector {
      display: none;
    }
  }
</style>
