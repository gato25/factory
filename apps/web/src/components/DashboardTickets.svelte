<script lang="ts">
  import { onMount } from 'svelte';
  import StepBar from '$components/StepBar.svelte';
  import { pipelineName } from '$lib/default-names';
  import { m } from '$lib/i18n';
  import type { DashboardTickets } from '$lib/services/dashboard';
  import { stateWords } from '$lib/state-words';
  import { position } from '$lib/step-shape';

  /**
   * Artboard 01's ticket tile: every ticket that is moving, under the heading
   * of what state it is in, each drawn against ITS OWN pipeline and saying in
   * words what is happening to it now (FR-009, FR-010).
   *
   * A row is three columns — who it is, how far it is, what it is doing — and
   * the first and last never give up their width to a long name: the title
   * and the meta line truncate, with the whole of them on hover, rather than
   * pushing into the bar or the status (spec edge case "long names").
   */
  let { groups }: { groups: DashboardTickets } = $props();

  const ORDER = [
    { key: 'inProgress', tone: 'run' },
    { key: 'needsAttention', tone: 'fail' },
    { key: 'queued', tone: 'queue' },
    { key: 'done', tone: 'done' },
  ] as const;

  // The running times tick on their own; the data only changes on a callback.
  let now = $state(Date.now());
  onMount(() => {
    const timer = setInterval(() => (now = Date.now()), 20_000);
    return () => clearInterval(timer);
  });

  const empty = $derived(ORDER.every(({ key }) => groups[key].count === 0));

</script>

<section class="tile tickets" aria-labelledby="dashboard-tickets">
  <header class="head">
    <div>
      <h2 id="dashboard-tickets" class="title">{m.dashboard.ticketsTitle}</h2>
      <p class="sub">{m.dashboard.ticketsSub}</p>
    </div>
    <a class="link" href="/tickets">{m.dashboard.viewAll}</a>
  </header>

  {#if empty}
    <p class="nothing">{m.dashboard.nothing}</p>
  {/if}

  {#each ORDER as { key, tone } (key)}
    {@const group = groups[key]}
    {#if group.count > 0}
      <section class="group" aria-label={m.dashboard.groupCount(m.dashboard.groups[key], group.count)}>
        <h3 class="group-head" data-group={key}>
          <span class="dot {tone}" aria-hidden="true"></span>
          <span class="label">{m.dashboard.groups[key]}</span>
          <span class="n">{group.count}</span>
        </h3>
        <ul>
          {#each group.rows as row (row.ticketId)}
            {@const state = stateWords(row.status, 'row', now)}
            {@const meta = `${row.reference} · ${row.repository}${row.pipeline ? ` · ${pipelineName(row.pipeline)}` : ''}`}
            <li class="row" data-ticket={row.ticketId}>
              <a class="text" href="/tickets/{row.ticketId}">
                <span class="row-title" title={row.title}>{row.title}</span>
                <span class="meta" title={meta}>{meta}</span>
              </a>
              <span class="progress">
                <StepBar shape={row.steps} />
                <span class="count" aria-hidden="true"
                  >{m.stepBar.count(position(row.steps), row.steps.count)}</span
                >
              </span>
              <span
                class="pill status {state.tone === 'run' ? '' : `pill--${state.tone}`}"
                class:pill--live={state.live}
                title={state.text}><span class="status-text">{state.text}</span></span
              >
            </li>
          {/each}
        </ul>
        {#if group.more > 0}
          <a class="more" href="/tickets">{m.dashboard.more(group.more)}</a>
        {/if}
      </section>
    {/if}
  {/each}
</section>

<style>
  .tickets {
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-width: 0;
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding-bottom: 6px;
  }
  .title {
    margin: 0;
    font-family: var(--font-head);
    font-size: 19px;
    font-weight: 600;
    letter-spacing: -0.3px;
  }
  .sub {
    margin: 3px 0 0;
    font-size: var(--type-caption);
    color: var(--text-2);
  }
  .link,
  .more {
    font-size: var(--type-body);
    font-weight: 600;
    color: var(--accent-text);
    text-decoration: none;
    white-space: nowrap;
  }
  .more {
    align-self: flex-start;
    padding: 4px 4px 0;
  }
  .link:hover,
  .more:hover {
    text-decoration: underline;
  }
  .nothing {
    margin: 0;
    padding: 12px 4px;
    color: var(--text-2);
  }

  .group {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .group-head {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0;
    padding: 8px 4px 0;
    font-family: var(--font);
    font-size: var(--type-caption);
    letter-spacing: 0;
  }
  .group-head .label {
    font-weight: 700;
    color: var(--text-2);
  }
  .group-head .n {
    font-family: var(--font-head);
    font-weight: 600;
    color: var(--text-3);
  }
  .dot {
    width: 7px;
    height: 7px;
    border-radius: var(--r-pill);
    background: var(--accent);
  }
  .dot.fail {
    background: var(--red-to);
  }
  .dot.queue {
    background: var(--pill-queue-dot);
  }
  .dot.done {
    background: var(--success);
  }

  ul {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .row {
    display: grid;
    grid-template-columns: minmax(0, 300px) minmax(0, 1fr) 264px;
    align-items: center;
    gap: 20px;
    padding: 15px 16px;
    border-radius: 16px;
    background: #f4f2efb3;
  }
  .text {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
    color: inherit;
    text-decoration: none;
  }
  .text:hover .row-title {
    text-decoration: underline;
  }
  .row-title,
  .meta,
  .status-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .row-title {
    font-size: var(--type-body);
    font-weight: 600;
    color: var(--text);
  }
  .meta {
    font-size: var(--type-caption);
    color: var(--text-2);
  }
  .progress {
    display: flex;
    flex-direction: column;
    gap: 5px;
    min-width: 0;
  }
  .count {
    font-family: var(--font-head);
    font-size: var(--type-caption);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    color: var(--text-3);
  }
  .status {
    min-width: 0;
    max-width: 100%;
  }
  .status-text {
    min-width: 0;
  }

  @media (max-width: 1100px) {
    .row {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    }
    .status {
      grid-column: 1 / -1;
      justify-self: start;
    }
  }
</style>
