<script lang="ts">
  import Icon from '$components/Icon.svelte';
  import { stepName } from '$lib/default-names';
  import { ago } from '$lib/format';
  import { m } from '$lib/i18n';
  import { ticketBoard } from '$lib/remote/tickets.remote';

  /**
   * Every run waiting for a person, each with the action that reviews it
   * (FR-011, 001 FR-059). A paused run is the only thing on the dashboard that
   * cannot make progress on its own, so it gets the one tinted tile.
   *
   * One entry per waiting RUN, read from the board: a gate that several people
   * may decide — the creator among them — is still one thing to decide.
   *
   * Built to artboard 01's "Tile · Батлалт": the golden tile, its count large,
   * and per run the reference and what it gates, the title, how long it has
   * been ready, and "Батлах".
   */
  const board = $derived(ticketBoard());
  const waiting = $derived(
    board.ready ? board.current.filter((row) => row.status === 'waiting_approval') : [],
  );
</script>

{#if waiting.length > 0}
  <section class="tile tile--approval approvals" aria-labelledby="approvals-heading">
    <header class="head">
      <div>
        <h2 id="approvals-heading" class="title">{m.approvals.heading}</h2>
        <p class="sub">{m.approvals.sub}</p>
      </div>
      <span class="n">{waiting.length}</span>
    </header>
    <ul>
      {#each waiting as ticket (ticket.id)}
        <li class="item">
          <span class="text">
            <span class="meta"
              >{ticket.reference}{#if ticket.gate?.step}&nbsp;· {stepName(ticket.gate.step)}{/if}</span
            >
            <span class="item-title" title={ticket.title}>{ticket.title}</span>
            <span class="when">
              {#if ticket.gate}{m.approvals.ready(ago(ticket.gate.since))}{:else}{ticket.repository}{/if}
            </span>
          </span>
          <a
            class="approve"
            href="/tickets/{ticket.id}/approve"
            aria-label={m.approvals.review(ticket.reference, ticket.title)}
          >
            {m.approvals.approve}
            <Icon name="arrow-right" size={14} />
          </a>
        </li>
      {/each}
    </ul>
  </section>
{/if}

<style>
  .approvals {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .head {
    display: flex;
    justify-content: space-between;
    gap: 12px;
  }
  .title {
    margin: 0;
    font-family: var(--font-head);
    font-size: 19px;
    font-weight: 600;
    letter-spacing: -0.3px;
    color: #4a3a00;
  }
  .sub {
    margin: 4px 0 0;
    font-size: var(--type-caption);
    color: #7a6310;
  }
  .n {
    font-family: var(--font-head);
    font-size: 44px;
    font-weight: 700;
    line-height: 1;
    letter-spacing: -1.5px;
    color: var(--warning-text);
  }
  ul {
    display: flex;
    flex-direction: column;
    gap: 12px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 14px 14px 14px 16px;
    border-radius: 16px;
    background: #fffbeab3;
    box-shadow: 0 4px 12px #b8700f14;
  }
  .text {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }
  .meta {
    font-size: var(--type-caption);
    font-weight: 600;
    color: var(--warning-text);
  }
  .item-title {
    overflow: hidden;
    font-size: var(--type-body);
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--on-amber);
  }
  .when {
    font-size: var(--type-caption);
    color: #7a6310;
  }
  .approve {
    display: inline-flex;
    flex: none;
    align-items: center;
    gap: 6px;
    padding: 9px 14px;
    border-radius: 11px;
    font-size: var(--type-body);
    font-weight: 700;
    text-decoration: none;
    color: var(--on-amber);
    background: linear-gradient(180deg, var(--amber), #d9a200);
    box-shadow: 0 4px 10px #d9a2004d;
  }
  .approve:hover {
    filter: brightness(1.04);
  }
</style>
