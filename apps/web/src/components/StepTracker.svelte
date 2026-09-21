<script lang="ts">
  import Icon from '$components/Icon.svelte';
  import type { RunView } from '$lib/services/run-view';
  import { duration, iconFor } from '$lib/step-kind';

  /**
   * `design.pen`'s stepper, artboard 06: one row per step down the side rail,
   * each node threaded on a continuous connector — accent behind the run,
   * hairline grey ahead of it. A finished step shows a check, the one
   * running shows its own mark on a solid node, the ones ahead show theirs
   * greyed.
   *
   * **Why it runs down rather than across.** It was a horizontal row whose
   * widths were `flex-grow: durationS`, so a bar's width was the time that
   * step took. Six boxes of arbitrary width read as an accident rather than
   * a measurement, and the shortest step needed a `min-width` floor that
   * made its width a lie anyway. Down the rail every label has room, and the
   * duration is printed rather than implied — 3m 42s against 2m 41s is exact
   * where one box being somewhat wider than another was only comparable.
   * What is lost is seeing the slowest step at a glance.
   *
   * No card of its own: the rail is one card and this is the lower half of
   * it. No spend bar either — the cost against its ceiling belongs in Run
   * details, which is where `design.pen` puts it and where it already is.
   * The failure and the Retry live on the page, which says more about both
   * than this could.
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
    run.failureStepIndex ?? (steps.find((step) => step.state === 'failed')?.index ?? null),
  );

  const chosen = $derived(steps.find((step) => step.index === selected) ?? null);
  const skipped = $derived(steps.filter((step) => step.state === 'skipped'));

  type State = 'done' | 'running' | 'pending' | 'skipped' | 'failed';

  interface Cell {
    /** Absent for the merge request, which is not a step anybody can open. */
    index: number | null;
    label: string;
    state: State;
    /** The figure on the right of the row: a duration, or what it waits on. */
    detail: string;
    icon: string;
  }

  /** A finished step says so with a check; the rest carry their own mark. */
  const MARK: Record<State, string | null> = {
    done: 'check',
    failed: 'x',
    skipped: 'chevron-right',
    running: null,
    pending: null,
  };

  const cells = $derived.by((): Cell[] => {
    const out: Cell[] = steps.map((step) => {
      const state: State = step.index === failedIndex ? 'failed' : (step.state as State);
      return {
        index: step.index,
        label: step.label,
        state,
        detail:
          state === 'running'
            ? 'running'
            : state === 'pending'
              ? 'waiting'
              : state === 'skipped'
                ? 'skipped'
                : step.durationS
                  ? duration(step.durationS)
                  : '—',
        icon: MARK[state] ?? iconFor(step.type),
      };
    });
    // Implicit and always last (FR-029).
    const opened = run.status === 'done';
    out.push({
      index: null,
      label: 'Merge request',
      state: opened ? 'done' : 'pending',
      detail: opened ? 'opened' : 'waiting',
      icon: opened ? 'check' : 'git-pull-request',
    });
    return out;
  });

  /** A cell the run has got to, which is what colours the rail into it. */
  const reached = (cell: Cell) => cell.state !== 'pending';
</script>

<!--
  Each row draws its own half of the connector above and below its node, so
  the line is continuous without anything being positioned over anything
  else. The rows have a fixed height and no gap, which is what lets the
  halves meet.
-->
{#snippet inside(cell: Cell, i: number)}
  {@const first = i === 0}
  {@const last = i === cells.length - 1}
  <span class="rail" aria-hidden="true">
    <span class="line" class:hidden={first} class:on={!first && reached(cell)}></span>
    <span class="node"><Icon name={cell.icon} size={13} /></span>
    <span class="line" class:hidden={last} class:on={!last && reached(cells[i + 1])}></span>
  </span>
  <span class="n">{cell.label}</span>
  <span class="d">{cell.detail}</span>
{/snippet}

<ol class="track">
  {#each cells as cell, i (cell.index ?? 'mr')}
    <li class={cell.state}>
      {#if cell.index === null}
        <span class="cell">{@render inside(cell, i)}</span>
      {:else}
        <button
          type="button"
          class="cell"
          class:on={selected === cell.index}
          aria-label={`Step ${cell.index + 1} — ${cell.label}, ${cell.detail}`}
          onclick={() => onSelect?.(cell.index as number)}>{@render inside(cell, i)}</button>
      {/if}
    </li>
  {/each}
</ol>

<!--
  A skipped step is shown WITH its reason and never omitted (FR-075a), so
  these are listed whether or not the step is the one selected.
-->
{#each skipped as step (step.index)}
  <p class="note">{step.label} skipped — {step.conditionNotMet}.</p>
{/each}
{#if chosen?.summary && chosen.state === 'done'}
  <p class="note">{chosen.label} — {chosen.summary}</p>
{/if}

<style>
  .track {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .track > li {
    display: flex;
  }

  /* A fixed row height with no gap between rows: the 8px stubs above and
     below each node meet, and the rail reads as one line. */
  .cell {
    display: flex;
    align-items: center;
    gap: 10px;
    flex: 1;
    min-width: 0;
    height: 38px;
    padding: 0;
    border: 0;
    background: none;
    font: inherit;
    color: inherit;
    text-align: left;
  }
  button.cell {
    cursor: pointer;
  }
  button.cell:hover .node,
  button.cell.on .node {
    outline: 3px solid var(--accent-soft);
  }
  button.cell:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
    border-radius: var(--r-sm);
  }

  .rail {
    display: flex;
    flex-direction: column;
    align-items: center;
    width: 26px;
    height: 38px;
    flex: none;
  }
  .line {
    width: 2px;
    height: 8px;
    flex: none;
    background: var(--border);
  }
  .line.on {
    background: var(--accent);
  }
  .line.hidden {
    background: none;
  }

  .node {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    flex: none;
    border-radius: 999px;
    background: var(--surface-2);
    box-shadow: inset 0 0 0 1.5px var(--border);
    color: var(--text-3);
  }
  li.done .node {
    background: var(--accent-soft);
    box-shadow: inset 0 0 0 1.5px var(--accent);
    color: var(--accent);
  }
  li.running .node {
    background: var(--accent);
    box-shadow: 0 2px 8px #2450e64d;
    color: var(--text-inv);
  }
  li.failed .node {
    background: var(--danger);
    box-shadow: 0 2px 8px #dc26264d;
    color: var(--text-inv);
  }

  .n {
    flex: 1;
    min-width: 0;
    font-size: 12px;
    font-weight: 600;
    color: var(--text-2);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .d {
    flex: none;
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-3);
  }
  li.running .n {
    font-weight: 700;
    color: var(--text);
  }
  li.failed .n {
    color: var(--danger);
  }
  li.pending .n {
    color: var(--text-3);
  }
  li.skipped .n {
    color: var(--text-3);
    text-decoration: line-through;
  }

  .note {
    margin: 10px 0 0;
    padding-top: 10px;
    border-top: 1px solid var(--border);
    font-size: 11.5px;
    line-height: 1.5;
    color: var(--text-2);
  }
</style>
