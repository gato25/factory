<script lang="ts">
  import { m } from '$lib/i18n';

  /**
   * A run waiting on the concurrency cap sees where it is (FR-082). The
   * number matters more than the wait: "third in line" is actionable, "still
   * queued" is not.
   */
  let { position, cap }: { position: number | null; cap?: number } = $props();
</script>

{#if position !== null}
  <p class="pill pill--queue queued">{m.queue.position(position, cap ?? null)}</p>
{/if}

<style>
  .queued {
    margin: 0;
    font-size: var(--type-body);
    white-space: normal;
  }
</style>
