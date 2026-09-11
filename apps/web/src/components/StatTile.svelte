<script lang="ts">
  import Icon from '$components/Icon.svelte';

  /**
   * One dashboard tile, built to `design.pen`'s Stat component: a label and a
   * 34px icon chip on one row, the value at 34px beneath, and a caption under
   * that.
   *
   * The caption is the part worth defending. A tile that says "6" answers how
   * many and nothing else; "2 GitLab · 4 GitHub" is the beginning of an
   * answer to whatever made you look.
   */
  let {
    label,
    value,
    caption,
    icon,
    tone = 'accent',
  }: {
    label: string;
    value: number | string;
    caption: string;
    icon: string;
    /** Which soft chip the design gives this tile. */
    tone?: 'accent' | 'warning' | 'success';
  } = $props();
</script>

<article class="stat">
  <div class="top">
    <span class="label">{label}</span>
    <span class="chip {tone}"><Icon name={icon} size={17} /></span>
  </div>
  <strong class="value">{value}</strong>
  <span class="caption">{caption}</span>
</article>

<style>
  .stat {
    display: flex;
    flex-direction: column;
    gap: 12px;
    flex: 1;
    min-width: 0;
    padding: 22px;
    background: var(--surface);
    border: 1px solid var(--card-border);
    border-radius: var(--r-lg);
  }
  .top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  .label {
    font-size: 13px;
    font-weight: 500;
    color: var(--text-2);
  }
  .chip {
    display: grid;
    place-items: center;
    width: 34px;
    height: 34px;
    border-radius: 10px;
    flex: none;
  }
  .chip.accent {
    background: var(--accent-soft);
    color: var(--accent-text);
  }
  .chip.warning {
    background: var(--warning-soft);
    color: var(--warning);
  }
  .chip.success {
    background: var(--success-soft);
    color: var(--success);
  }
  .value {
    font-family: var(--font-head);
    font-size: 34px;
    font-weight: 700;
    line-height: 1.1;
    color: var(--text);
  }
  .caption {
    font-size: 12px;
    color: var(--text-3);
  }
</style>
