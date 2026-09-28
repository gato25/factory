<script lang="ts">
  import { m } from '$lib/i18n';

  /**
   * How often a ticket reaches a merge request on its first attempt with
   * nobody editing what the agents wrote (FR-012) — the same number the
   * first-attempt audit prints, because both call one function (SC-004).
   *
   * With nothing decided in the window there is no rate, and the tile says
   * so: 0% would claim every ticket failed.
   */
  let { figure }: { figure: { counted: number; successes: number; rate: number | null } } =
    $props();

  const SIZE = 104;
  const STROKE = 10.4; // the design's inner radius is 0.8 of the outer
  const radius = (SIZE - STROKE) / 2;
  const circumference = 2 * Math.PI * radius;
  const percent = $derived(figure.rate === null ? null : Math.round(figure.rate * 100));
</script>

<section class="tile ring-tile" aria-labelledby="first-attempt-label">
  <svg class="ring" width={SIZE} height={SIZE} viewBox="0 0 {SIZE} {SIZE}" aria-hidden="true">
    <defs>
      <linearGradient id="first-attempt-value" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="var(--accent-from)" />
        <stop offset="1" stop-color="var(--accent-to)" />
      </linearGradient>
    </defs>
    <circle
      cx={SIZE / 2}
      cy={SIZE / 2}
      r={radius}
      fill="none"
      stroke="var(--border)"
      stroke-width={STROKE}
    />
    {#if figure.rate !== null && figure.rate > 0}
      <circle
        class="value"
        cx={SIZE / 2}
        cy={SIZE / 2}
        r={radius}
        fill="none"
        stroke="url(#first-attempt-value)"
        stroke-width={STROKE}
        stroke-linecap="round"
        stroke-dasharray="{circumference * figure.rate} {circumference}"
        transform="rotate(-90 {SIZE / 2} {SIZE / 2})"
      />
    {/if}
  </svg>
  <div class="text">
    {#if percent === null}
      <p class="n none">{m.dashboard.firstAttempt.nothing}</p>
      <p id="first-attempt-label" class="label">{m.dashboard.firstAttempt.label}</p>
      <p class="sub">{m.dashboard.firstAttempt.nothingYet}</p>
    {:else}
      <p class="n" data-rate={percent}>{percent}%</p>
      <p id="first-attempt-label" class="label">{m.dashboard.firstAttempt.label}</p>
      <p class="sub">{m.dashboard.firstAttempt.counted(figure.successes, figure.counted)}</p>
    {/if}
  </div>
</section>

<style>
  .ring-tile {
    display: flex;
    align-items: center;
    gap: 20px;
    min-height: 168px;
  }
  .ring {
    flex: none;
  }
  .value {
    filter: drop-shadow(0 4px 5px #f26b1d40);
  }
  .text {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }
  p {
    margin: 0;
  }
  .n {
    font-family: var(--font-head);
    font-size: 40px;
    font-weight: 700;
    line-height: 1.05;
    letter-spacing: -1.2px;
    color: var(--text);
  }
  .n.none {
    font-size: 22px;
    letter-spacing: -0.3px;
  }
  .label {
    font-size: var(--type-body);
    font-weight: 600;
    color: var(--text);
  }
  .sub {
    font-size: var(--type-caption);
    color: var(--text-2);
  }
</style>
