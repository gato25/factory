<script lang="ts">
  import Icon from './Icon.svelte';

  /**
   * The UI kit's orb (Kit · 12, "Bento / Orb"): one icon on a round, lit
   * gradient. The tone says what kind of thing it stands for — the accent
   * for work, pen.dev blue for design, amber for a decision by a person,
   * mint for done, red for a failure (FR-005).
   *
   * Decorative unless given a `label`; an orb beside words that already say
   * what it means is hidden from assistive technology rather than read twice.
   */
  let {
    icon,
    tone = 'accent',
    size = 'md',
    label,
  }: {
    icon: string;
    tone?: 'accent' | 'pen' | 'amber' | 'mint' | 'red';
    size?: 'md' | 'sm';
    label?: string;
  } = $props();
</script>

<span
  class="orb {tone === 'accent' ? '' : `orb--${tone}`} {size === 'sm' ? 'orb--sm' : ''}"
  role={label ? 'img' : undefined}
  aria-label={label}
  aria-hidden={label ? undefined : 'true'}
>
  <Icon name={icon} size={size === 'sm' ? 16 : 20} />
</span>
