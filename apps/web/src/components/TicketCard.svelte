<script lang="ts">
  import type { BoardTicket } from '$lib/services/run-view';

  let { ticket }: { ticket: BoardTicket } = $props();

  // Whichever applies: the running step, the pending gate, the merge request,
  // or the failure reason (FR-023a).
  const TONE: Record<BoardTicket['strip']['kind'], string> = {
    step: 'live',
    gate: 'warn',
    merge_request: 'ok',
    failure: 'bad',
    none: ''
  };
</script>

<a class="ticket" href="/tickets/{ticket.id}">
  <header>
    <strong>{ticket.reference}</strong>
    <span class="who muted small" title={ticket.createdByName ?? ''}>
      {(ticket.createdByName ?? '?').slice(0, 1).toUpperCase()}
    </span>
  </header>
  <h3>{ticket.title}</h3>
  <p class="muted small">
    {ticket.repository}{#if ticket.pipeline} &middot; {ticket.pipeline}{/if}
  </p>
  <p class="strip badge {TONE[ticket.strip.kind]}">{ticket.strip.text}</p>
  {#if ticket.hasUi === true}
    <p class="muted small">Changes the interface</p>
  {/if}
</a>

<style>
  .ticket {
    display: block;
    background: var(--surface);
    border-radius: var(--r-sm);
    padding: 12px;
    text-decoration: none;
    color: inherit;
    box-shadow: 0 1px 2px rgba(26, 29, 36, 0.06);
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .who {
    width: 22px;
    height: 22px;
    border-radius: 999px;
    background: var(--line-2);
    display: grid;
    place-items: center;
  }
  h3 {
    margin: 6px 0 4px;
    font-size: 14px;
    line-height: 1.35;
  }
  p {
    margin: 0 0 6px;
  }
  .strip {
    display: block;
    line-height: 1.4;
  }
</style>
