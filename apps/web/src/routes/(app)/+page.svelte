<script lang="ts">
  import { onMount } from 'svelte';
  import ActiveRuns from '$components/ActiveRuns.svelte';
  import ActivityFeed from '$components/ActivityFeed.svelte';
  import ApprovalPanel from '$components/ApprovalPanel.svelte';
  import StatTile from '$components/StatTile.svelte';
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
    <p class="card muted">Loading…</p>
  {:else}
    {@const d = t.current}
    <StatTile
      label="Connected repos"
      value={d.repositoriesConnected}
      caption="{d.repositoriesByProvider.gitlab} GitLab &middot; {d.repositoriesByProvider
        .github} GitHub"
      icon="git-branch"
    />
    <StatTile
      label="Tickets running"
      value={d.ticketsRunning}
      caption="across {d.ticketsRunningAcrossRepositories} {d.ticketsRunningAcrossRepositories === 1
        ? 'repo'
        : 'repos'}"
      icon="loader"
    />
    <StatTile
      label="Waiting for approval"
      value={d.awaitingApproval}
      caption={d.awaitingApproval === 0 ? 'nothing to review' : 'needs your review'}
      icon="hand"
      tone="warning"
    />
    <StatTile
      label="Merge requests this week"
      value={d.mergeRequestsThisWeek}
      caption="{d.mergeRequestsOpened} opened &middot; {d.mergeRequestsThisWeek -
        d.mergeRequestsOpened} without an address"
      icon="git-pull-request"
      tone="success"
    />
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
  The design's Mid: the run list fills the row, and a 380px column beside it
  carries what needs a person and what just happened. Approvals sit at the
  top of that column because a paused run is the only thing here that cannot
  make progress without somebody (FR-059).
-->
<div class="mid">
  <ActiveRuns />
  <div class="side">
    <ApprovalPanel />
    <ActivityFeed />
  </div>
</div>

<style>
  .warning {
    border-left: 3px solid var(--warning);
    padding: 12px 16px;
    margin-bottom: 16px;
    color: #8a6100;
  }
  .tiles {
    display: flex;
    gap: 16px;
    margin-bottom: 28px;
  }
  @media (max-width: 900px) {
    .tiles {
      flex-wrap: wrap;
    }
  }
  /* The design's Mid: a filling column and a 380px one, 24px apart. */
  .mid {
    display: flex;
    align-items: flex-start;
    gap: 24px;
  }
  .side {
    display: flex;
    flex-direction: column;
    gap: 24px;
    width: 380px;
    flex: none;
  }
  @media (max-width: 1100px) {
    .mid {
      flex-direction: column;
    }
    .side {
      width: 100%;
    }
  }
</style>
