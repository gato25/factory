<script lang="ts">
  import Icon from '$components/Icon.svelte';
  import type { RunView } from '$lib/services/run-view';

  /**
   * `design.pen`'s tracker: one bar per step on a shared time axis, so a
   * bar's WIDTH is how long that step actually took. Equal-width circles
   * said only "four of six done"; this says where the ten minutes went,
   * which is the question a person watching a run is actually asking.
   *
   * Width comes from `flex-grow: durationS`, not from a computed pixel, so
   * the row balances itself for a pipeline of three steps or ten. A
   * `min-width` keeps the shortest step's label readable — which means a
   * very short step is drawn wider than its true share. That is a deliberate
   * floor, not a rounding error: a bar nobody can read carries nothing.
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

  /**
   * An emoji per step kind, keyed on `type` rather than on the agent, because
   * an agent is whatever a workspace made it — "Security review" and "Docs
   * writer" are as valid as the five shipped defaults, and a map keyed on
   * agent names would be wrong for them the day somebody adds one.
   */
  const GLYPH: Record<string, string> = {
    agent: '\u{1F9FE}',
    design: '\u{1F3A8}',
    shell: '\u26A1',
    checkpoint: '\u270B',
    notify: '\u{1F514}',
  };
  const glyph = (type: string) => GLYPH[type] ?? '\u{1F916}';

  /**
   * What a bar is worth on the time axis. A step that has not run has no
   * duration to plot, so it takes a fixed slot rather than collapsing.
   */
  function weight(step: RunView['steps'][number]): number {
    return step.durationS && step.durationS > 0 ? step.durationS : 0;
  }
  /**
   * Before anything has run there is no axis to plot against, so the bars
   * share the row evenly rather than all collapsing to their floor.
   */
  const anyDuration = $derived(steps.some((step) => weight(step) > 0));

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
      <li
        class={step.state}
        class:culprit={step.index === failedIndex}
        style="flex-grow: {anyDuration ? weight(step) : 1}"
      >
        <button
          type="button"
          class:on={selected === step.index}
          aria-label="Step {step.index + 1} — {step.label}, {took(step)}"
          onclick={() => onSelect?.(step.index)}
        >
          <span class="n"><span class="glyph" aria-hidden="true">{glyph(step.type)}</span>{step.label}</span>
          <span class="s">{took(step)}</span>
        </button>
      </li>
    {/each}

    <!-- Implicit and always last (FR-029) -->
    <li class="pending implicit">
      <span class="static">
        <span class="n"><span class="glyph" aria-hidden="true">&#x1F680;</span>Merge request</span>
        <span class="s">{run.status === 'done' ? 'opened' : 'waiting'}</span>
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

  /* One shared axis. `flex-grow` is the step's seconds, so the bars divide
     the row in proportion to the time they took. */
  .track {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    align-items: stretch;
    gap: 4px;
  }
  .track > li {
    display: flex;
    flex-basis: 0;
    min-width: 98px;
  }
  /* The merge request has no duration of its own — a fixed slot at the end. */
  .track > li.implicit {
    flex: none;
    width: 108px;
  }

  button,
  .static {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 1px;
    flex: 1;
    min-width: 0;
    padding: 6px 9px;
    height: 40px;
    border: 0;
    border-radius: var(--r-sm);
    background: var(--surface-2);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .static {
    cursor: default;
  }
  button:hover,
  button.on {
    outline: 2px solid var(--accent-soft);
  }

  .glyph {
    margin-right: 5px;
  }
  .n,
  .s {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .n {
    font-size: 10.5px;
    font-weight: 600;
    color: var(--text-2);
  }
  .s {
    font-size: 9.5px;
    font-family: var(--font-mono);
    color: var(--text-3);
  }

  /* Behind the run: the step's own colour, held back so the running step is
     the only saturated block on the row. */
  li.done button {
    background: var(--accent-soft);
  }
  li.done .n {
    color: var(--accent-text);
  }
  li.done .s {
    color: var(--accent-text);
    opacity: 0.75;
  }

  li.running button {
    background: var(--accent);
  }
  li.running .n {
    color: var(--text-inv);
  }
  li.running .s {
    color: var(--text-inv);
    opacity: 0.8;
  }

  /* Ahead of the run: an empty slot, as the artboard draws it. */
  li.pending button,
  li.pending .static {
    background: var(--surface);
    box-shadow: inset 0 0 0 1px var(--border);
  }
  li.pending .n,
  li.pending .s {
    color: var(--text-3);
  }

  li.skipped button {
    background: var(--surface-2);
  }
  li.skipped .n {
    color: var(--text-3);
    text-decoration: line-through;
  }

  li.failed button,
  li.culprit button {
    background: var(--danger);
  }
  li.failed .n,
  li.culprit .n,
  li.failed .s,
  li.culprit .s {
    color: var(--text-inv);
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

  /* Narrow: the row becomes a column rather than shrinking into nothing.
     The time axis cannot survive the fold, so every step takes one row. */
  @media (max-width: 1100px) {
    .track {
      flex-direction: column;
    }
    .track > li,
    .track > li.implicit {
      width: auto;
      flex: none;
    }
    button,
    .static {
      flex-direction: row;
      align-items: center;
      justify-content: space-between;
      height: auto;
      padding: 9px 12px;
    }
  }
</style>
