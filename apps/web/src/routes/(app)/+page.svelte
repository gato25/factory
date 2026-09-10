<script lang="ts">
  import { onMount } from 'svelte';
  import ActiveRuns from '$components/ActiveRuns.svelte';
  import ApprovalPanel from '$components/ApprovalPanel.svelte';
  import ActivityFeed from '$components/ActivityFeed.svelte';
  import { subscribeToRun } from '$lib/events/subscribe';
  import { active, activity, tiles } from '$lib/remote/runs.remote';
  import { ticketBoard } from '$lib/remote/tickets.remote';

  const t = $derived(tiles());

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
  The most important call to action on the page (FR-059). It sits above the
  active-run list on purpose: a paused run is the only thing here that cannot
  make progress without a person.
-->
<ApprovalPanel />

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
  .stack {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
</style>
