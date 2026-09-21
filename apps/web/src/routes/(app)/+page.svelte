<script lang="ts">
  import { onMount } from 'svelte';
  import ActiveRuns from '$components/ActiveRuns.svelte';
  import ActivityFeed from '$components/ActivityFeed.svelte';
  import ApprovalPanel from '$components/ApprovalPanel.svelte';
  import StatTile from '$components/StatTile.svelte';
  import { subscribeToRun } from '$lib/events/subscribe';
  import { active, activity, tiles } from '$lib/remote/runs.remote';
  import { setup } from '$lib/remote/settings.remote';
  import { m } from '$lib/i18n';
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

  /** A list as a person reads one, not a bare comma list. */
  function listed(items: string[]): string {
    if (items.length <= 1) return items[0] ?? '';
    return `${items.slice(0, -1).join(m.dashboard.listJoin)}${m.dashboard.listLast}${items[items.length - 1]}`;
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

<section class="strip" aria-label={m.dashboard.glance}>
  {#if !t.ready}
    <p class="loading">{m.dashboard.loading}</p>
  {:else}
    {@const d = t.current}
    <StatTile
      label={m.dashboard.connectedRepos}
      value={d.repositoriesConnected}
      caption={m.dashboard.reposByProvider(
        d.repositoriesByProvider.gitlab,
        d.repositoriesByProvider.github,
      )}
    />
    <StatTile
      label={m.dashboard.ticketsRunning}
      value={d.ticketsRunning}
      caption={m.dashboard.acrossRepos(d.ticketsRunningAcrossRepositories)}
    />
    <StatTile
      label={m.dashboard.waitingForApproval}
      value={d.awaitingApproval}
      caption={d.awaitingApproval === 0 ? m.dashboard.nothingToReview : m.dashboard.needsYourReview}
      tone="warning"
    />
    <StatTile
      label={m.dashboard.mergeRequestsThisWeek}
      value={d.mergeRequestsThisWeek}
      caption={m.dashboard.mergeRequests(
        d.mergeRequestsOpened,
        d.mergeRequestsThisWeek - d.mergeRequestsOpened,
      )}
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
    {m.dashboard.notReady(listed(s.current.missing))}
    {#if s.current.canFix}
      {@const needsRepository = s.current.missing.includes('a connected repository')}
      {@const needsSettings = s.current.missing.length > (needsRepository ? 1 : 0)}
      {m.dashboard.setUpBefore}{#if needsSettings}<a href="/settings">{m.nav.settings}</a>{/if}{#if
        needsSettings && needsRepository
      }{m.dashboard.listLast}{/if}{#if needsRepository}<a href="/repositories"
          >{m.nav.repositories}</a
        >{/if}{m.dashboard.setUpAfter}
    {:else}
      {m.dashboard.askAdministrator}
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
