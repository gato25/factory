<script lang="ts">
  import { health } from '$lib/remote/health.remote';
</script>

<h1>Code Factory</h1>
<p>Turn a ticket into a reviewable merge request.</p>

<svelte:boundary>
  <p>service: {await health().then((r) => r.status)}</p>
  {#snippet pending()}<p>checking…</p>{/snippet}
</svelte:boundary>
