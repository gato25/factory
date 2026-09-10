<script lang="ts">
  import { ticketBoard } from '$lib/remote/tickets.remote';

  /**
   * Every run waiting for a person, as the most prominent call to action on
   * the page (FR-059). A paused run is the only thing on a dashboard that
   * cannot make progress on its own, so it is shown above everything else.
   */
  let { heading = 'Waiting for your approval', compact = false }: {
    heading?: string;
    compact?: boolean;
  } = $props();

  const board = $derived(ticketBoard());
  const waiting = $derived(
    board.ready ? board.current.filter((row) => row.status === 'waiting_approval') : []
  );
</script>

{#if waiting.length > 0}
  <section class="card approvals" class:compact aria-label={heading}>
    <h2 class="section">{heading} <span class="muted">{waiting.length}</span></h2>
    <ul>
      {#each waiting as ticket (ticket.id)}
        <li>
          <span class="what">
            <strong>{ticket.reference}</strong> {ticket.title}
            <span class="muted small">{ticket.repository} &middot; {ticket.strip.text}</span>
          </span>
          <a class="review" href="/tickets/{ticket.id}/approve">Review</a>
        </li>
      {/each}
    </ul>
  </section>
{/if}

<style>
  .approvals {
    margin-bottom: 16px;
    border-left: 3px solid var(--warning);
  }
  .approvals.compact { margin-bottom: 12px; }
  ul { list-style: none; margin: 0; padding: 0; }
  li {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    padding: 8px 2px;
    border-top: 1px solid var(--border);
  }
  li:first-child { border-top: 0; }
  .what { display: flex; flex-direction: column; min-width: 0; }
  .what span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .review {
    padding: 7px 14px;
    border-radius: var(--r-sm);
    background: var(--accent);
    color: #fff;
    text-decoration: none;
    font-weight: 600;
    white-space: nowrap;
  }
</style>
