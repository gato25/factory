<script lang="ts">
  /**
   * Who owns a pipeline, agent or skill, wherever it can be selected or
   * edited (FR-006d). A shipped default has no owner, which is its own thing
   * worth saying: it is available to everyone and administrator-only to
   * change (FR-006b).
   */
  let {
    ownerName = null,
    isDefault = false,
    mine = false,
    mayChange = false
  }: {
    ownerName?: string | null;
    isDefault?: boolean;
    mine?: boolean;
    mayChange?: boolean;
  } = $props();

  import { m } from '$lib/i18n';
</script>

{#if isDefault}
  <span class="badge small shipped" title={m.owner.sharedTitle}>
    {m.owner.shipped}
  </span>
{:else if mine}
  <span class="badge small mine">{m.owner.yours}</span>
{:else}
  <span
    class="badge small"
    title={mayChange ? m.owner.youCanChange : m.owner.youCannotChange}
  >
    {ownerName ?? m.owner.someoneElse}
  </span>
{/if}

<style>
  .shipped { background: #eef1ff; color: #3a49a8; }
  .mine { background: #e9f6ec; color: #216b34; }
</style>
