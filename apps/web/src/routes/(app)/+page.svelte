<script lang="ts">
  import { onMount } from 'svelte';
  import ApprovalPanel from '$components/ApprovalPanel.svelte';
  import DashboardTickets from '$components/DashboardTickets.svelte';
  import FirstAttemptRing from '$components/FirstAttemptRing.svelte';
  import WeekChart from '$components/WeekChart.svelte';
  import { subscribeToRun } from '$lib/events/subscribe';
  import { m } from '$lib/i18n';
  import { dashboardFigures, dashboardTickets } from '$lib/remote/runs.remote';
  import { setup } from '$lib/remote/settings.remote';
  import { ticketBoard } from '$lib/remote/tickets.remote';

  /**
   * Screen 01 — the dashboard, built to artboard 01 (specs/004-bento-redesign
   * US1): what the factory is doing, and what needs me.
   *
   * One row: the ticket list fills it, and a 400px column beside it carries
   * the approvals, the first-attempt figure and the week. Approvals sit at the
   * top of that column because a paused run is the only thing here that
   * cannot make progress without somebody (FR-011).
   */

  const s = $derived(setup());
  const groups = $derived(dashboardTickets());
  const numbers = $derived(dashboardFigures());

  /** A list as a person reads one, not a bare comma list. */
  function listed(items: string[]): string {
    if (items.length <= 1) return items[0] ?? '';
    return `${items.slice(0, -1).join(m.dashboard.listJoin)}${m.dashboard.listLast}${items[items.length - 1]}`;
  }

  /** The dashboard watches one workspace-wide channel, so every part of it moves together (FR-014). */
  onMount(() =>
    subscribeToRun({
      target: 'dashboard',
      onEvent: () => {
        void dashboardTickets().refresh();
        void dashboardFigures().refresh();
        void ticketBoard().refresh();
      },
    }),
  );
</script>

<!--
  An unconfigured deployment cannot run anything, and saying so is more use
  than an empty list. It sits above everything because until it is resolved,
  nothing else on this page can ever be non-empty (FR-014).
-->
{#if s.ready && !s.current.ready}
  <p class="tile tile--danger notice" role="status">
    {m.dashboard.notReady(listed(s.current.missing.map((item) => m.dashboard.missing[item] ?? item)))}
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

<div class="row">
  {#if groups.ready}
    <DashboardTickets groups={groups.current} />
  {:else}
    <section class="tile loading-tile"><p class="loading">{m.dashboard.loading}</p></section>
  {/if}

  <div class="side">
    <ApprovalPanel />
    {#if numbers.ready}
      <FirstAttemptRing figure={numbers.current.firstAttempt} />
      <WeekChart
        days={numbers.current.mergeRequestsByDay}
        total={numbers.current.mergeRequestsTotal}
        costToday={numbers.current.costToday}
      />
    {/if}
  </div>
</div>

<style>
  /* Nothing can run: that needs attention, which is red (FR-005). */
  .notice {
    margin: 0 0 20px;
    padding: 16px 20px;
    font-size: var(--type-body);
    color: var(--danger-text);
  }
  .notice a {
    font-weight: 600;
    color: var(--danger-text);
  }

  .row {
    display: flex;
    align-items: flex-start;
    gap: 20px;
  }
  .row > :global(:first-child) {
    flex: 1;
  }
  .side {
    display: flex;
    flex: none;
    flex-direction: column;
    gap: 20px;
    width: 400px;
  }
  .loading {
    margin: 0;
    color: var(--text-2);
  }

  /* Narrower than the design: the column goes under the list rather than
     squeezing it (spec edge case). */
  @media (max-width: 1100px) {
    .row {
      flex-direction: column;
      align-items: stretch;
    }
    .side {
      width: 100%;
    }
  }
</style>
