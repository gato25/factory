<script lang="ts">
  import { health } from '$lib/remote/health.remote';
</script>

<p>Dashboard tiles, active runs and the approval panel arrive with user story 2 (T094–T096).</p>

<svelte:boundary>
  <p>service: {await health().then((r) => r.status)}</p>
  {#snippet pending()}<p>checking…</p>{/snippet}
</svelte:boundary>
