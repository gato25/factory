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
</script>

{#if isDefault}
  <span class="badge small shipped" title="Бүгдэд нээлттэй; администратор өөрчилнө">
    Үндсэн
  </span>
{:else if mine}
  <span class="badge small mine">Таных</span>
{:else}
  <span
    class="badge small"
    title={mayChange ? 'Та үүнийг өөрчилж болно' : 'Та ашиглаж болно, өөрчилж болохгүй'}
  >
    {ownerName ?? 'Өөр хэн нэгэн'}
  </span>
{/if}

<style>
  .shipped { background: #eef1ff; color: #3a49a8; }
  .mine { background: #e9f6ec; color: #216b34; }
</style>
