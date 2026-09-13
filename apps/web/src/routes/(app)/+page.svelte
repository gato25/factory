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

  /**
   * Screen 01 — Dashboard, built to `design.pen`: one stat strip across the
   * top, then the run list filling the row with a 360px column beside it for
   * what needs a person and what just happened.
   *
   * The strip is ONE card. An earlier version drew four, each with a coloured
   * icon chip, and the page's first impression was seven bordered boxes
   * competing for attention. Hierarchy here comes from contrast and space
   * rather than from borders: the strip and the three cards are the only
   * white surfaces on the grey ground, and nothing inside them is boxed again.
   */

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

<section class="strip" aria-label="Workspace at a glance">
  {#if !t.ready}
    <p class="loading">Loading…</p>
  {:else}
    {@const d = t.current}
    <StatTile
      label="Connected repos"
      value={d.repositoriesConnected}
      caption="{d.repositoriesByProvider.gitlab} GitLab &middot; {d.repositoriesByProvider
        .github} GitHub"
    />
    <StatTile
      label="Tickets running"
      value={d.ticketsRunning}
      caption="across {d.ticketsRunningAcrossRepositories} {d.ticketsRunningAcrossRepositories === 1
        ? 'repo'
        : 'repos'}"
    />
    <StatTile
      label="Waiting for approval"
      value={d.awaitingApproval}
      caption={d.awaitingApproval === 0 ? 'nothing to review' : 'needs your review'}
      tone="warning"
    />
    <StatTile
      label="Merge requests this week"
      value={d.mergeRequestsThisWeek}
      caption="{d.mergeRequestsOpened} opened &middot; {d.mergeRequestsThisWeek -
        d.mergeRequestsOpened} without an address"
    />
  {/if}
</section>

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
  The design's Mid: the run list fills the row, and a 360px column beside it
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
  /* The strip: one card, four cells, three short dividers — as the artboard
     draws it, with the dividers 48px tall and centred rather than full
     height, which is what keeps the strip reading as one line. */
  .strip {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    margin-bottom: 24px;
    background: var(--surface);
    border: 1px solid var(--card-border);
    border-radius: var(--r-lg);
    box-shadow: 0 1px 2px #0f172a0a;
  }
  .strip > :global(article) {
    position: relative;
  }
  .strip > :global(article + article)::before {
    content: '';
    position: absolute;
    left: 0;
    top: 50%;
    width: 1px;
    height: 48px;
    transform: translateY(-50%);
    background: var(--border);
  }
  .loading {
    grid-column: 1 / -1;
    margin: 0;
    padding: 18px 24px;
    font-size: 13px;
    color: var(--text-3);
  }
  @media (max-width: 900px) {
    .strip {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .strip > :global(article:nth-child(3))::before {
      display: none;
    }
    .strip > :global(article:nth-child(n + 3)) {
      border-top: 1px solid var(--border);
    }
  }

  .warning {
    border-left: 3px solid var(--warning);
    padding: 12px 16px;
    margin-bottom: 24px;
    color: #8a6100;
  }

  /* The design's Mid: a filling column and a 360px one, 24px apart. */
  .mid {
    display: flex;
    align-items: flex-start;
    gap: 24px;
  }
  .side {
    display: flex;
    flex-direction: column;
    gap: 24px;
    width: 360px;
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
