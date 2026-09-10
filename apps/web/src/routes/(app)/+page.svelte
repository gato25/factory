<script lang="ts">
  import { onMount } from 'svelte';
  import ActiveRuns from '$components/ActiveRuns.svelte';
  import ApprovalPanel from '$components/ApprovalPanel.svelte';
  import ActivityFeed from '$components/ActivityFeed.svelte';
  import { subscribeToRun } from '$lib/events/subscribe';
  import { active, activity, tiles } from '$lib/remote/runs.remote';
  import { setup } from '$lib/remote/settings.remote';
  import { ticketBoard } from '$lib/remote/tickets.remote';

  const t = $derived(tiles());
  const s = $derived(setup());

  /** "and" rather than a bare comma list, because a person reads this. */
  function listed(items: string[]): string {
    if (items.length <= 1) return items[0] ?? '';
    return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
  }

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
  An unconfigured deployment cannot run anything, and saying so is more use
  than an empty list. It sits above everything because until it is resolved,
  nothing else on this page can ever be non-empty.
-->
{#if s.ready && !s.current.ready}
  <p class="card warning" role="status">
    Nothing can run yet: this workspace still needs {listed(s.current.missing)}.
    {#if s.current.canFix}
      {@const needsRepository = s.current.missing.includes('a connected repository')}
      {@const needsSettings = s.current.missing.length > (needsRepository ? 1 : 0)}
      Set that up in
      {#if needsSettings}<a href="/settings">Settings</a>{/if}{#if
        needsSettings && needsRepository
      }{' '}and {/if}{#if needsRepository}<a href="/repositories">Repositories</a>{/if}.
    {:else}
      Ask an administrator — workspace connections and credentials are theirs to set (FR-004).
    {/if}
  </p>
{/if}

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
  .warning {
    border-left: 3px solid var(--warning);
    padding: 12px 16px;
    margin-bottom: 16px;
    color: #8a6100;
  }
  .tiles {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 12px;
    margin-bottom: 16px;
  }
  .tile {
    background: var(--surface);
    border-radius: var(--r-md);
    padding: 16px;
    color: var(--text-2);
    font-size: 13px;
  }
  .tile.attention {
    outline: 2px solid var(--warning);
    outline-offset: -2px;
  }
  .n {
    display: block;
    font-size: 26px;
    font-weight: 600;
    color: var(--text);
    line-height: 1.2;
  }
  .stack {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
</style>
