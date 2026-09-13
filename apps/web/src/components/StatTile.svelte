<script lang="ts">
  /**
   * One cell of the dashboard's stat strip, built to `design.pen`: a label, a
   * 32px value beneath it, and a caption under that. The strip around it owns
   * the card — the white surface, the hairline, the dividers — so a cell
   * draws none of its own, and four of them read as one instrument rather
   * than four boxes.
   *
   * There is deliberately no icon. The earlier design gave every tile a
   * coloured chip, and four coloured squares in a row were the loudest thing
   * on the page while carrying nothing the label did not already say. Colour
   * is spent on one thing here: the value turns amber when something is
   * waiting for a person, because that is the one number on this strip that
   * asks for an action.
   *
   * The caption is the part worth defending. A tile that says "6" answers how
   * many and nothing else; "2 GitLab · 4 GitHub" is the beginning of an
   * answer to whatever made you look.
   */
  let {
    label,
    value,
    caption,
    tone = 'neutral',
  }: {
    label: string;
    value: number | string;
    caption: string;
    /** `warning` colours the value amber — only while it is non-zero. */
    tone?: 'neutral' | 'warning';
  } = $props();

  const attention = $derived(tone === 'warning' && Number(value) > 0);
</script>

<article class="stat">
  <span class="label">{label}</span>
  <strong class="value" class:attention>{value}</strong>
  <span class="caption">{caption}</span>
</article>

<style>
  .stat {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
    padding: 18px 24px;
  }
  .label {
    font-size: 13px;
    font-weight: 500;
    color: var(--text-2);
  }
  .value {
    font-family: var(--font-head);
    font-size: 32px;
    font-weight: 700;
    line-height: 1.1;
    letter-spacing: -1px;
    font-variant-numeric: tabular-nums;
    color: var(--text);
  }
  .value.attention {
    color: var(--warning);
  }
  .caption {
    font-size: 12px;
    color: var(--text-3);
  }
</style>
