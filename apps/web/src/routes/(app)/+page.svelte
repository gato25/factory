<script lang="ts">
  import { onMount } from 'svelte';
  import ActiveRuns from '$components/ActiveRuns.svelte';
  import ActivityFeed from '$components/ActivityFeed.svelte';
  import { subscribeToRun } from '$lib/events/subscribe';
  import { active, activity, tiles } from '$lib/remote/runs.remote';
  import { ticketBoard } from '$lib/remote/tickets.remote';

  const t = $derived(tiles());
  const board = $derived(ticketBoard());

  /** The dashboard watches one workspace-wide channel (FR-074). */
  onMount(() =>
    subscribeToRun({
      target: 'dashboard',
      onEvent: () => {
        void tiles().refresh();
        void active().refresh();
        void activity().refresh();
        void ticketBoard().refresh();
      }
    })
  );
</script>

<div class="tiles">
  {#if !t.ready}
    <div class="tile muted">Loading…</div>
  {:else}
    <div class="tile">
      <span class="n">{t.current.repositoriesConnected}</span> connected repositories
    </div>
    <div class="tile"><span class="n">{t.current.ticketsRunning}</span> tickets running</div>
    <div class="tile" class:attention={t.current.awaitingApproval > 0}>
      <span class="n">{t.current.awaitingApproval}</span> waiting for approval
    </div>
    <div class="tile">
      <span class="n">{t.current.mergeRequestsThisWeek}</span> merge requests this week
    </div>
  {/if}
</div>

<!--
  The most important call to action on the page (FR-059). It lives above the
  active-run list on purpose: a paused run is the only thing here that cannot
  make progress without a person.
-->
{#if board.ready}
  {@const waiting = board.current.filter((row) => row.status === 'waiting_approval')}
    {#if waiting.length > 0}
      <section class="card approvals">
        <h2 class="section">Waiting for your approval</h2>
        <ul>
          {#each waiting as ticket (ticket.id)}
            <li>
              <span>
                <strong>{ticket.reference}</strong> {ticket.title}
                <span class="muted small">{ticket.strip.text}</span>
              </span>
              <a class="review" href="/tickets/{ticket.id}">Review</a>
            </li>
          {/each}
        </ul>
      </section>
  {/if}
{/if}

<div class="stack">
  <ActiveRuns />
  <ActivityFeed />
</div>

<style>
  .tiles {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 12px;
    margin-bottom: 16px;
  }
  .tile {
    background: var(--surface);
    border-radius: var(--r);
    padding: 16px;
    color: var(--ink-2);
    font-size: 13px;
  }
  .tile.attention {
    outline: 2px solid var(--warn);
    outline-offset: -2px;
  }
  .n {
    display: block;
    font-size: 26px;
    font-weight: 600;
    color: var(--ink);
    line-height: 1.2;
  }
  .approvals {
    margin-bottom: 16px;
    border-left: 3px solid var(--warn);
  }
  .approvals ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .approvals li {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    padding: 8px 2px;
    border-top: 1px solid var(--line-2);
  }
  .approvals li:first-child {
    border-top: 0;
  }
  .approvals li span {
    display: flex;
    flex-direction: column;
  }
  .review {
    padding: 7px 14px;
    border-radius: var(--r-sm);
    background: var(--accent);
    color: #fff;
    text-decoration: none;
    font-weight: 600;
    white-space: nowrap;
  }
  .stack {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
</style>
