<script lang="ts">
  import Icon from '$components/Icon.svelte';
  import { ticketBoard } from '$lib/remote/tickets.remote';

  /**
   * Every run waiting for a person, as the most prominent call to action on
   * the page (FR-059). A paused run is the only thing on a dashboard that
   * cannot make progress on its own, so it is shown above everything else.
   *
   * Built to `design.pen`: a header with an amber hand, the title and a count,
   * then one plain row per run with an amber dot and a blue Review button. An
   * earlier version put each row in an amber block inside the card — a
   * coloured box inside a bordered box on a grey page — and the whole column
   * shouted. Amber now appears exactly twice per row, on things that mean
   * "waiting"; blue appears once, on the thing to press.
   */
  let { heading = 'Waiting for your approval' }: { heading?: string } = $props();

  const board = $derived(ticketBoard());
  const waiting = $derived(
    board.ready ? board.current.filter((row) => row.status === 'waiting_approval') : []
  );
</script>

{#if waiting.length > 0}
  <section class="approvals" aria-label={heading}>
    <header>
      <Icon name="hand" size={16} />
      <h2>{heading}</h2>
      <span class="count">{waiting.length}</span>
    </header>
    <ul>
      {#each waiting as ticket (ticket.id)}
        <li>
          <span class="dot"></span>
          <span class="text">
            <span class="title"><span class="id">{ticket.reference}</span> {ticket.title}</span>
            <span class="sub">{ticket.repository} &middot; {ticket.strip.text}</span>
          </span>
          <a class="review" href="/tickets/{ticket.id}/approve">Review</a>
        </li>
      {/each}
    </ul>
  </section>
{/if}

<style>
  .approvals {
    padding: 16px 20px;
    background: var(--surface);
    border: 1px solid var(--card-border);
    border-radius: var(--r-lg);
    box-shadow: 0 1px 2px #0f172a0a;
  }
  header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding-bottom: 6px;
    color: var(--warning);
  }
  h2 {
    margin: 0;
    font-family: var(--font-head);
    font-size: 15px;
    font-weight: 600;
    letter-spacing: -0.01em;
    color: var(--text);
  }
  .count {
    padding: 2px 8px;
    border-radius: 999px;
    background: var(--surface-2);
    font-family: var(--font-mono);
    font-size: 12px;
    font-weight: 600;
    color: var(--text-2);
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  li {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 0;
    border-top: 1px solid var(--surface-2);
  }
  li:first-child {
    border-top: 0;
  }
  .dot {
    width: 6px;
    height: 6px;
    border-radius: 999px;
    background: var(--warning);
    flex: none;
  }
  .text {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1;
    min-width: 0;
  }
  .title {
    font-size: 13px;
    font-weight: 600;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .id {
    font-family: var(--font-mono);
    font-weight: 500;
    color: var(--text-3);
  }
  .sub {
    font-size: 12px;
    color: var(--text-2);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .review {
    flex: none;
    padding: 7px 12px;
    border-radius: var(--r-sm);
    background: var(--accent);
    color: var(--text-inv);
    font-size: 13px;
    font-weight: 600;
    text-decoration: none;
    white-space: nowrap;
  }
  .review:hover {
    background: var(--accent-text);
  }
</style>
