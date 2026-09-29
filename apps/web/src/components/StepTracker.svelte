<script lang="ts">
  import Icon from '$components/Icon.svelte';
  import { stepTitle } from '$lib/default-names';
  import { m } from '$lib/i18n';
  import type { RunView } from '$lib/services/run-view';
  import { requestReference } from '$lib/state-words';
  import { duration, iconFor } from '$lib/step-kind';

  /**
   * Artboard 06's step track: the run's OWN pipeline down the side column,
   * one row per step and one for the merge request that ends it — an orb,
   * the step's name and what happened to it — joined by a connector that is
   * lit behind the run and grey ahead of it (FR-020).
   *
   * Each step says in words what happened to it — how long it took, that it
   * is running, that it waits for a person, that it failed — and a skipped
   * step says so and, under the track, why (FR-075a). Choosing a step shows
   * its log beside the column. The merge request, once opened, is the link
   * to it: the results column that used to carry it is gone (spec:
   * Divergence).
   */
  let {
    steps,
    run,
    mergeRequestUrl = null,
    onSelect,
    selected,
    classification = null,
  }: {
    steps: RunView['steps'];
    run: RunView['run'];
    mergeRequestUrl?: string | null;
    onSelect?: (index: number) => void;
    selected?: number;
    /** Why a design step did or did not run, in the classification's own words (FR-100). */
    classification?: string | null;
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
        // Green for done, as everywhere else (FR-005); a running design step
        // is pen.dev blue.
        tone:
          state === 'done'
            ? 'orb--mint'
            : state === 'failed'
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
      label:
        opened && mergeRequestUrl
          ? m.stepTracker.mergeRequestNamed(requestReference(mergeRequestUrl))
          : m.stepTracker.mergeRequest,
      state: opened ? 'done' : opening ? 'running' : 'pending',
      detail: opened ? m.stepTracker.opened : opening ? m.stepTracker.running : m.stepTracker.waiting,
      icon: opened ? 'check' : 'git-pull-request',
      tone: opened ? 'orb--mint' : opening ? '' : 'quiet',
    });
    return out;
  });

  /** A cell the run has got to, which is what lights the connector into it. */
  const reached = (cell: Cell | undefined) =>
    !!cell && cell.state !== 'pending' && cell.state !== 'skipped';
</script>

<ol class="track" aria-label={m.stepTracker.label(cells.length)}>
  {#each cells as cell, i (cell.index ?? 'mr')}
    {#if i > 0}
      <li
        class="belt"
        class:lit={reached(cell)}
        class:into-running={cell.state === 'running'}
        aria-hidden="true"
      >
        <span></span>
      </li>
    {/if}
    <li class="step {cell.state}" data-step-state={cell.state}>
      {#if cell.index === null}
        {#if cell.state === 'done' && mergeRequestUrl}
          <!-- The system opens it; a person merges it (FR-070). -->
          <a class="cell" href={mergeRequestUrl} target="_blank" rel="noreferrer noopener">
            <span class="orb {cell.tone}" aria-hidden="true"><Icon name={cell.icon} size={17} /></span>
            <span class="tx">
              <span class="n">{cell.label}</span>
              <span class="d">{cell.detail}</span>
            </span>
            <Icon name="external-link" size={14} />
          </a>
        {:else}
          <span class="cell">
            <span class="orb {cell.tone}" aria-hidden="true"><Icon name={cell.icon} size={17} /></span>
            <span class="tx">
              <span class="n">{cell.label}</span>
              <span class="d">{cell.detail}</span>
            </span>
          </span>
        {/if}
      {:else}
        <button
          type="button"
          class="cell"
          class:on={selected === cell.index}
          aria-pressed={selected === cell.index}
          aria-label={m.stepTracker.stepLabel(cell.index + 1, cell.label, cell.detail)}
          title={cell.label}
          onclick={() => onSelect?.(cell.index as number)}
        >
          <span class="orb {cell.tone}" aria-hidden="true"><Icon name={cell.icon} size={17} /></span>
          <span class="tx">
            <span class="n">{cell.label}</span>
            <span class="d">{cell.detail}</span>
          </span>
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
    {#if skipped.length > 0 && classification}
      <p class="note">{classification}</p>
    {/if}
    {#if chosen?.summary && chosen.state === 'done'}
      <p class="note">{labelOf(chosen)} — {chosen.summary}</p>
    {/if}
  </div>
{/if}

<style>
  .track {
    display: flex;
    flex-direction: column;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  /* The connector: centred under a 40px orb, between one row and the next. */
  .belt {
    padding: 4px 0 4px 18px;
  }
  .belt span {
    display: block;
    width: 4px;
    height: 14px;
    border-radius: 2px;
    background: var(--card-border);
  }
  .belt.lit span {
    background: #a9e8cf;
  }
  .belt.into-running span {
    background: linear-gradient(180deg, #a9e8cf, #f8b98f);
  }

  .cell {
    display: flex;
    align-items: center;
    gap: 14px;
    width: 100%;
    padding: 0;
    border: 0;
    border-radius: 16px;
    font: inherit;
    text-align: left;
    text-decoration: none;
    color: inherit;
    background: none;
  }
  button.cell,
  a.cell {
    cursor: pointer;
  }
  a.cell > :global(svg) {
    flex: none;
    color: var(--text-3);
  }
  .orb {
    width: 40px;
    height: 40px;
  }
  button.cell:hover .orb,
  button.cell.on .orb,
  a.cell:hover .orb {
    outline: 3px solid var(--accent-soft);
    outline-offset: 2px;
  }
  .orb.quiet {
    color: var(--text-3);
    background: var(--surface-2);
    box-shadow: inset 0 0 0 1.5px var(--border);
  }
  .tx {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .n {
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
</style>
