<script lang="ts">
  /**
   * A state, as a dot and words (Kit · 12, "Bento / Status Pill"). The words
   * are the point: a colour is never the only thing that says what state
   * something is in (FR-006). The tones are the six the kit draws — work in
   * progress, waiting for a person, done, failed, design work, queued.
   */
  let {
    tone,
    label,
    live = false,
  }: {
    tone: 'run' | 'wait' | 'done' | 'fail' | 'pen' | 'queue';
    label: string;
    /** A glow on the dot, for something happening right now. */
    live?: boolean;
  } = $props();
</script>

<span class="pill {tone === 'run' ? '' : `pill--${tone}`}" class:pill--live={live}>{label}</span>
