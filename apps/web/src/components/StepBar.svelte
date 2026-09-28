<script lang="ts">
  import { m } from '$lib/i18n';
  import { position, type StepShape, segmentTone } from '$lib/step-shape';

  /**
   * One ticket's progress through its OWN pipeline: a segment per step and
   * one for the merge request, so a quick fix draws three and a reviewed
   * pipeline eight (FR-010, FR-018; data-model StepShape).
   *
   * Colours are the design's (artboard 01): finished steps a light accent,
   * the current one lit in the colour of what it is doing, the rest a quiet
   * grey, a skipped step a darker grey — and a finished ticket green from end
   * to end. The words beside a bar say the same thing; the bar is never the
   * only place a state is written (FR-006).
   */
  let {
    shape,
    size = 'md',
    showCount = false,
  }: {
    shape: StepShape;
    /** `sm` for a board card, `md` for a dashboard row. */
    size?: 'sm' | 'md';
    /** "5/6 алхам" after the bar, as the dashboard row draws it. */
    showCount?: boolean;
  } = $props();

  const at = $derived(position(shape));
  const tones = $derived(Array.from({ length: shape.count }, (_, i) => segmentTone(shape, i)));
</script>

<span class="step-bar {size}">
  <span
    class="segments"
    class:finished={shape.state === 'done'}
    role="img"
    aria-label={m.stepBar.label(at, shape.count)}
  >
    {#each tones as tone, i (i)}
      <span class="segment {tone}"></span>
    {/each}
  </span>
  {#if showCount}
    <span class="count" aria-hidden="true">{m.stepBar.count(at, shape.count)}</span>
  {/if}
</span>

<style>
  .step-bar {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-width: 0;
  }
  .segments {
    display: flex;
    flex: 1;
    gap: 4px;
    min-width: 0;
  }
  .segment {
    flex: 1;
    height: 8px;
    border-radius: 4px;
    background: var(--border);
  }
  .sm .segment {
    height: 6px;
    border-radius: 3px;
  }
  .done {
    background: var(--log-accent);
  }
  .finished .done {
    background: linear-gradient(180deg, var(--mint-from), var(--mint-to));
  }
  .skipped {
    background: var(--card-border);
  }
  .run {
    background: linear-gradient(180deg, var(--accent-from), var(--accent-to));
  }
  .pen {
    background: linear-gradient(180deg, var(--pen-from), var(--pen-to));
  }
  .wait {
    background: linear-gradient(180deg, var(--amber-from), var(--amber-to));
  }
  .fail {
    background: linear-gradient(180deg, var(--red-from), var(--red-to));
  }
  .cancelled {
    background: var(--text-3);
  }
  .count {
    flex: none;
    font-size: var(--type-caption);
    font-variant-numeric: tabular-nums;
    color: var(--text-3);
    white-space: nowrap;
  }
</style>
