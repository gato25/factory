<script lang="ts">
  import Icon from '$components/Icon.svelte';
  import { stepTitle } from '$lib/default-names';
  import { m } from '$lib/i18n';
  import type { RunView } from '$lib/services/run-view';
  import { duration, iconFor } from '$lib/step-kind';

  /**
   * Artboard 06's step track: the run's OWN pipeline across the head tile,
   * one orb per step and one for the merge request that ends it, threaded on
   * a belt that is lit behind the run and grey ahead of it (FR-020).
   *
   * Each step says in words what happened to it — how long it took, that it
   * is running, that it waits for a person, that it failed — and a skipped
   * step says so and, under the track, why (FR-075a). Choosing a step shows
   * its log below.
   */
  let {
    steps,
    run,
    onSelect,
    selected,
  }: {
    steps: RunView['steps'];
    run: RunView['run'];
    onSelect?: (index: number) => void;
    selected?: number;
  } = $props();

  /**
   * The step that failed, so it is the one the eye lands on. The run's own
   * record of where it failed wins over a step row, because a ceiling stops
   * a run between steps.
   */
  const failedIndex = $derived(
    run.status === 'failed'
      ? (run.failureStepIndex ?? steps.find((step) => step.state === 'failed')?.index ?? null)
      : null,
  );
  const waitingIndex = $derived(run.status === 'waiting_approval' ? run.currentStepIndex : null);

  const chosen = $derived(steps.find((step) => step.index === selected) ?? null);
  const skipped = $derived(steps.filter((step) => step.state === 'skipped'));

  type State = 'done' | 'running' | 'waiting' | 'pending' | 'skipped' | 'failed';

  interface Cell {
    /** Absent for the merge request, which is not a step anybody can open. */
    index: number | null;
    label: string;
    state: State;
    detail: string;
    icon: string;
    tone: '' | 'orb--pen' | 'orb--amber' | 'orb--mint' | 'orb--red' | 'quiet';
  }

  const labelOf = (step: RunView['steps'][number]) => stepTitle(step);

  const cells = $derived.by((): Cell[] => {
    const out: Cell[] = steps.map((step) => {
      const state: State =
        step.index === failedIndex
          ? 'failed'
          : step.index === waitingIndex
            ? 'waiting'
            : (step.state as State);
      const words = m.stepTracker;
      const took = step.durationS ? duration(step.durationS) : null;
      return {
        index: step.index,
        label: labelOf(step),
        state,
        detail: {
          done: took ?? words.done,
          running: took ? words.runningFor(took) : words.running,
          waiting: words.waitingForYou,
          pending: words.waiting,
          skipped: words.skipped,
          failed: words.failed,
        }[state],
        icon:
          state === 'done'
            ? 'check'
            : state === 'failed'
              ? 'x'
              : state === 'skipped'
                ? 'chevron-right'
                : state === 'waiting'
                  ? 'hand'
                  : iconFor(step.type),
        tone:
          state === 'failed'
            ? 'orb--red'
            : state === 'waiting'
              ? 'orb--amber'
              : state === 'pending' || state === 'skipped'
                ? 'quiet'
                : step.type === 'design'
                  ? 'orb--pen'
                  : '',
      };
    });
    // Implicit and always last (FR-029).
    const opened = run.status === 'done';
    const opening = run.status === 'opening_mr';
    out.push({
      index: null,
      label: m.stepTracker.mergeRequest,
      state: opened ? 'done' : opening ? 'running' : 'pending',
      detail: opened ? m.stepTracker.opened : opening ? m.stepTracker.running : m.stepTracker.waiting,
      icon: opened ? 'check' : 'git-pull-request',
      tone: opened ? 'orb--mint' : opening ? '' : 'quiet',
    });
    return out;
  });

  /** A cell the run has got to, which is what lights the belt into it. */
  const reached = (cell: Cell | undefined) =>
    !!cell && cell.state !== 'pending' && cell.state !== 'skipped';
</script>

<ol class="track" aria-label={m.stepTracker.label(cells.length)}>
  {#each cells as cell, i (cell.index ?? 'mr')}
    {#if i > 0}
      <li class="belt" class:lit={reached(cell)} aria-hidden="true"><span></span></li>
    {/if}
    <li class="step {cell.state}" data-step-state={cell.state}>
      {#if cell.index === null}
        <span class="cell">
          <span class="orb {cell.tone}" aria-hidden="true"><Icon name={cell.icon} size={19} /></span>
          <span class="n">{cell.label}</span>
          <span class="d">{cell.detail}</span>
        </span>
      {:else}
        <button
          type="button"
          class="cell"
          class:on={selected === cell.index}
          aria-pressed={selected === cell.index}
          aria-label={m.stepTracker.stepLabel(cell.index + 1, cell.label, cell.detail)}
          onclick={() => onSelect?.(cell.index as number)}
        >
          <span class="orb {cell.tone}" aria-hidden="true"><Icon name={cell.icon} size={19} /></span>
          <span class="n">{cell.label}</span>
          <span class="d">{cell.detail}</span>
        </button>
      {/if}
    </li>
  {/each}
</ol>

<!--
  A skipped step is shown WITH its reason and never omitted (FR-075a), so
  these are listed whether or not the step is the one selected.
-->
{#if skipped.length > 0 || (chosen?.summary && chosen.state === 'done')}
  <div class="notes">
    {#each skipped as step (step.index)}
      <p class="note skipped-note">
        {m.stepTracker.skippedBecause(labelOf(step), step.conditionNotMet ?? '')}
      </p>
    {/each}
    {#if chosen?.summary && chosen.state === 'done'}
      <p class="note">{labelOf(chosen)} — {chosen.summary}</p>
    {/if}
  </div>
{/if}

<style>
  .track {
    display: flex;
    align-items: flex-start;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .step {
    flex: none;
    width: 150px;
  }
  .belt {
    flex: 1;
    min-width: 12px;
    padding-top: 21px;
  }
  .belt span {
    display: block;
    height: 4px;
    border-radius: 2px;
    background: var(--card-border);
  }
  .belt.lit span {
    background: linear-gradient(90deg, var(--accent-from), var(--accent-to));
  }

  .cell {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 0;
    border: 0;
    border-radius: 16px;
    font: inherit;
    text-align: center;
    color: inherit;
    background: none;
  }
  button.cell {
    cursor: pointer;
  }
  button.cell:hover .orb,
  button.cell.on .orb {
    outline: 3px solid var(--accent-soft);
    outline-offset: 2px;
  }
  .orb.quiet {
    color: var(--text-3);
    background: var(--surface-2);
    box-shadow: inset 0 0 0 1.5px var(--border);
  }
  .n {
    max-width: 100%;
    overflow: hidden;
    font-size: var(--type-body);
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text);
  }
  .d {
    font-size: var(--type-caption);
    color: var(--text-2);
  }
  .pending .n,
  .skipped .n {
    color: var(--text-3);
  }
  .skipped .n {
    text-decoration: line-through;
  }
  .running .d {
    font-weight: 700;
    color: var(--accent-text);
  }
  .waiting .d {
    font-weight: 700;
    color: var(--warning-text);
  }
  .failed .d,
  .failed .n {
    font-weight: 700;
    color: var(--danger-text);
  }

  .notes {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .note {
    margin: 0;
    padding: 10px 14px;
    border-radius: 12px;
    font-size: var(--type-body);
    color: var(--text-2);
    background: var(--surface-2);
  }

  @media (max-width: 1100px) {
    .track {
      overflow-x: auto;
      padding-bottom: 6px;
    }
    .step {
      width: 120px;
    }
  }
</style>
