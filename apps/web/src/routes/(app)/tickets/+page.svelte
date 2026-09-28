<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import Icon from '$components/Icon.svelte';
  import { m } from '$lib/i18n';
  import TicketCard from '$components/TicketCard.svelte';
  import { pipelineName } from '$lib/default-names';
  import { stateWords } from '$lib/state-words';
  import { subscribeToRun } from '$lib/events/subscribe';
  import { repositories } from '$lib/remote/repositories.remote';
  import { ticketBoard } from '$lib/remote/tickets.remote';

  const board = $derived(ticketBoard());
  const repos = $derived(repositories());
  let view = $state<'board' | 'list'>('board');
  // Where the frame's search lands. It arrives in the address so a search is
  // linkable and survives a reload, rather than living only in this page.
  const search = $derived((page.url.searchParams.get('q') ?? '').trim().toLowerCase());
  let repositoryId = $state('');
  let pipelineId = $state('');
  let createdBy = $state('');

  // Cards move automatically as run status changes (FR-023, FR-074), and the
  // running times on them tick on their own.
  let now = $state(Date.now());
  onMount(() => {
    const timer = setInterval(() => (now = Date.now()), 20_000);
    const stop = subscribeToRun({ target: 'dashboard', onEvent: () => void ticketBoard().refresh() });
    return () => {
      clearInterval(timer);
      stop?.();
    };
  });

  // Five columns, each tinted and dotted in the colour of what its state
  // means, so the board reads at a glance rather than by heading (FR-018).
  // Queued holds the drafts too — "ready to start" is the step before the
  // queue, and the artboard draws both there.
  const COLUMNS = [
    { id: 'draft,queued', label: m.board.backlog, tone: 'idle', tint: 'neutral-queue' },
    { id: 'running', label: m.board.running, tone: 'live', tint: '' },
    { id: 'waiting_approval', label: m.board.waitingApproval, tone: 'warn', tint: 'tile--approval' },
    { id: 'done', label: m.board.done, tone: 'ok', tint: 'tile--done' },
    { id: 'failed', label: m.board.failed, tone: 'bad', tint: 'tile--danger' },
  ];
</script>

<header class="page-head">
  <div>
    <h1>{m.board.heading}</h1>
    <p class="lede">
      {board.ready ? m.board.lede(board.current.filter((t) => t.status !== 'cancelled').length) : ''}
    </p>
  </div>
  <a class="btn" href="/tickets/new"><Icon name="plus" size={15} />{m.board.newTicket}</a>
</header>

{#if board.error}
  <p class="tile" role="alert">{(board.error as Error).message}</p>
{:else if !board.ready}
  <p class="tile">{m.board.loading}</p>
{:else}
  {@const rows = board.current}
  {@const filtered = rows.filter(
      (t) =>
        (!repositoryId || t.repositoryId === repositoryId) &&
        (!pipelineId || t.pipelineId === pipelineId) &&
        (!createdBy || t.createdBy === createdBy) &&
        // "Search tickets, repos" — the repository's name counts, which is
        // what makes one field able to answer both.
        (!search ||
          `${t.reference} ${t.title} ${t.repository ?? ''}`.toLowerCase().includes(search))
    )}

    <!--
      No approval panel here, as the design has none: this board already has
      a waiting-approval column, and repeating it above the thing it
      duplicates makes the screen longer without telling anybody more. The
      panel is on the dashboard, where there is no such column (FR-059).
    -->
    {#if search}
      <!-- An empty board after a search should say why it is empty. -->
      <p class="searching tile">
        {m.board.searchingBefore}<strong>{search}</strong>{m.board.searchingAfter}
        <a href="/tickets">{m.board.clearSearch}</a>
      </p>
    {/if}

    <!--
      The design's Filters row: three pills that look like what they are —
      a choice you can change — and a segmented view switch.
    -->
    <div class="filters">
      <div class="pills">
        <label class="choice">
          <Icon name="git-branch" size={14} />
          <span class="sr">{m.board.repository}</span>
          <select bind:value={repositoryId}>
            <option value="">{m.board.allRepositories}</option>
            {#each repos.ready ? repos.current : [] as repo (repo.id)}
              <option value={repo.id}>{repo.fullPath}</option>
            {/each}
          </select>
          <Icon name="chevron-down" size={14} />
        </label>
        <label class="choice">
          <Icon name="workflow" size={14} />
          <span class="sr">{m.board.pipeline}</span>
          <select bind:value={pipelineId}>
            <option value="">{m.board.anyPipeline}</option>
            {#each [...new Set(rows.map((t) => t.pipelineId).filter(Boolean))] as id (id)}
              {@const name = rows.find((t) => t.pipelineId === id)?.pipeline}
              <option value={id}>{name ? pipelineName(name) : ''}</option>
            {/each}
          </select>
          <Icon name="chevron-down" size={14} />
        </label>
        <label class="choice">
          <Icon name="user" size={14} />
          <span class="sr">{m.board.creator}</span>
          <select bind:value={createdBy}>
            <option value="">{m.board.createdByAnyone}</option>
            {#each [...new Set(rows.map((t) => t.createdBy))] as id (id)}
              <option value={id}>{rows.find((t) => t.createdBy === id)?.createdByName}</option>
            {/each}
          </select>
          <Icon name="chevron-down" size={14} />
        </label>
      </div>

      <div class="views">
        <button
          type="button"
          class:on={view === 'board'}
          aria-label={m.board.boardView}
          aria-pressed={view === 'board'}
          onclick={() => (view = 'board')}><Icon name="kanban" size={15} /></button
        >
        <button
          type="button"
          class:on={view === 'list'}
          aria-label={m.board.listView}
          aria-pressed={view === 'list'}
          onclick={() => (view = 'list')}><Icon name="list" size={15} /></button
        >
      </div>
    </div>

    {#if filtered.length === 0}
      <p class="tile">{m.board.noMatch} <a href="/tickets/new">{m.board.createOne}</a>.</p>
    {:else if view === 'board'}
      <div class="board">
        {#each COLUMNS as column (column.id)}
          {@const inColumn = filtered.filter((t) => column.id.split(',').includes(t.status))}
          <section class="tile column {column.tint}" aria-label={m.board.column(column.label, inColumn.length)}>
            <h2 class="col-head">
              <span class="dot {column.tone}" aria-hidden="true"></span>
              <span class="col-title">{column.label}</span>
              <span class="count">{inColumn.length}</span>
            </h2>
            <div class="cards">
              {#each inColumn as ticket (ticket.id)}
                <TicketCard {ticket} {now} />
              {/each}
              {#if column.id.startsWith('draft')}
                <!-- The design puts the way in at the foot of the first column. -->
                <a class="add" href="/tickets/new">
                  <Icon name="plus" size={14} />
                  <span>{m.board.newTicket}</span>
                </a>
              {/if}
            </div>
          </section>
        {/each}
      </div>
    {:else}
      <div class="tile list">
        <table>
          <thead>
            <tr
              ><th>{m.board.colTicket}</th><th>{m.board.colRepository}</th><th
                >{m.board.colPipeline}</th
              ><th>{m.board.colStatus}</th></tr
            >
          </thead>
          <tbody>
            {#each filtered as ticket (ticket.id)}
              <tr>
                <td><a href="/tickets/{ticket.id}">{ticket.reference} {ticket.title}</a></td>
                <td>{ticket.repository}</td>
                <td>{ticket.pipeline ? pipelineName(ticket.pipeline) : '—'}</td>
                <td>{stateWords(ticket.state, 'card', now).text}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
  {/if}
{/if}

<style>
  .page-head {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 20px;
    padding: 8px 4px 0;
  }
  h1 {
    margin: 0;
    font-size: 30px;
    font-weight: 600;
    letter-spacing: -0.6px;
  }
  .lede {
    margin: 6px 0 0;
    color: var(--text-2);
  }

  .searching {
    display: flex;
    gap: 10px;
    align-items: baseline;
    margin: 0 0 20px;
    padding: 12px 16px;
  }

  /* The design's Filters: choices that look like choices, and a view switch. */
  .filters {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    flex-wrap: wrap;
    margin-bottom: 20px;
  }
  .pills {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
  }
  .choice {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 9px 14px;
    border-radius: 12px;
    color: var(--text-2);
    background: #ffffffcc;
    box-shadow: 0 2px 6px var(--shadow-soft);
    cursor: pointer;
  }
  .choice:focus-within {
    box-shadow: var(--focus-ring);
  }
  .choice select {
    padding: 0;
    border: 0;
    font: 500 var(--type-body) / 1.3 var(--font);
    color: var(--text);
    background: none;
    cursor: pointer;
    /* The design draws one chevron; the native one would make two. */
    appearance: none;
  }
  .choice select:focus {
    outline: none;
  }
  .choice :global(svg:last-child) {
    color: var(--text-3);
  }

  .views {
    display: flex;
    gap: 4px;
    padding: 4px;
    border-radius: 12px;
    background: var(--accent-soft);
  }
  .views button {
    display: grid;
    place-items: center;
    width: 36px;
    height: 30px;
    border: 0;
    border-radius: 9px;
    color: var(--text-3);
    background: none;
    cursor: pointer;
  }
  .views button.on {
    color: var(--text);
    background: var(--surface);
    box-shadow: 0 2px 6px var(--shadow-depth);
  }

  .board {
    display: grid;
    grid-template-columns: repeat(5, minmax(220px, 1fr));
    gap: 16px;
    align-items: stretch;
    overflow-x: auto;
    padding-bottom: 4px;
  }
  .column {
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-width: 0;
    min-height: 480px;
    padding: 14px;
  }
  .col-head {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0;
    padding: 4px 6px 2px;
  }
  .col-title {
    flex: 1;
    font-family: var(--font-head);
    font-size: var(--type-body);
    font-weight: 600;
    color: var(--text);
  }
  .dot {
    flex: none;
    width: 8px;
    height: 8px;
    border-radius: var(--r-pill);
  }
  .dot.idle {
    background: var(--pill-queue-dot);
  }
  .dot.live {
    background: var(--accent);
  }
  .dot.warn {
    background: #d9a200;
  }
  .dot.ok {
    background: var(--success);
  }
  .dot.bad {
    background: var(--red-to);
  }
  .count {
    padding: 2px 8px;
    border-radius: var(--r-pill);
    font-family: var(--font-head);
    font-size: var(--type-caption);
    font-weight: 700;
    color: var(--text-2);
    background: #ffffff66;
  }

  .cards {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .add {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 10px 12px;
    border-radius: 14px;
    font-size: var(--type-body);
    font-weight: 600;
    text-decoration: none;
    color: var(--text-2);
    background: #ffffff4d;
  }
  .add:hover {
    color: var(--accent-text);
    background: #ffffff99;
  }

  .list {
    padding: 8px 12px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
  }
  th,
  td {
    padding: 12px;
    text-align: left;
  }
  tbody tr + tr td {
    border-top: 1px solid var(--surface-2);
  }
  th {
    font-size: var(--type-caption);
    font-weight: 600;
    color: var(--text-2);
  }
  td {
    font-size: var(--type-body);
  }
  td a {
    font-weight: 600;
    color: inherit;
  }

  /* Narrower than five columns fit, the columns wrap into rows — stacked,
     never scrolled sideways past the edge (spec edge case, 1024px). */
  @media (max-width: 1100px) {
    .board {
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      overflow-x: visible;
    }
  }
</style>
