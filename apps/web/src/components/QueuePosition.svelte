<script lang="ts">
  /**
   * A run waiting on the concurrency cap sees where it is (FR-082). The
   * number matters more than the wait: "third in line" is actionable, "still
   * queued" is not.
   */
  let { position, cap }: { position: number | null; cap?: number } = $props();
</script>

{#if position !== null}
  <p class="badge warn queued">
    Сул орчин хүлээж байна — дараалалд {position}-рт{#if cap}, зэрэг {cap} орчин ажиллана{/if}.
  </p>
{/if}

<style>
  .queued { display: inline-block; }
</style>
