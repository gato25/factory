<script lang="ts">
  import { m } from '$lib/i18n';

  /**
   * Who owns a pipeline, agent or skill, wherever it can be selected or
   * edited (FR-006d). A shipped default has no owner, which is its own thing
   * worth saying: it is available to everyone and administrator-only to
   * change (FR-006b). A chip in the kit's soft greys, with the viewer's own
   * in the done mint: ownership is a fact about the thing, not a status.
   */
  let {
    ownerName = null,
    isDefault = false,
    mine = false,
    mayChange = false,
  }: {
    ownerName?: string | null;
    isDefault?: boolean;
    mine?: boolean;
    mayChange?: boolean;
  } = $props();
</script>

{#if isDefault}
  <span class="owner" title={m.owner.sharedTitle}>{m.owner.shipped}</span>
{:else if mine}
  <span class="owner mine">{m.owner.yours}</span>
{:else}
  <span class="owner" title={mayChange ? m.owner.youCanChange : m.owner.youCannotChange}>
    {ownerName ?? m.owner.someoneElse}
  </span>
{/if}

<style>
  .owner {
    display: inline-flex;
    align-items: center;
    padding: 4px 10px;
    border-radius: var(--r-pill);
    font-size: var(--type-caption);
    font-weight: 600;
    white-space: nowrap;
    color: var(--text-2);
    background: var(--surface-2);
  }
  .mine {
    color: var(--success-text);
    background: var(--success-soft);
  }
</style>
