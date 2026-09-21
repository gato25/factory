<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import Icon from '$components/Icon.svelte';
  import { m } from '$lib/i18n';
  import TicketCard from '$components/TicketCard.svelte';
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

  // Cards move automatically as run status changes (FR-023, FR-074).
  onMount(() => subscribeToRun({ target: 'dashboard', onEvent: () => void ticketBoard().refresh() }));

  // The design gives each column a dot in the colour of what that state
  // means, so the board can be read at a glance rather than by heading.
  const COLUMNS = [
    { id: 'draft', label: m.board.backlog, tone: 'idle' },
    { id: 'queued,running', label: m.board.running, tone: 'live' },
    { id: 'waiting_approval', label: m.board.waitingApproval, tone: 'warn' },
    { id: 'done', label: m.board.done, tone: 'ok' },
    { id: 'failed', label: m.board.failed, tone: 'bad' },
  ];
</script>

{#if board.error}
  <p class="card" role="alert">{(board.error as Error).message}</p>
{:else if !board.ready}
  <p class="card">{m.board.loading}</p>
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
      a Waiting approval column, and repeating it above the thing it
      duplicates makes the screen longer without telling anybody more. The
      panel is on the dashboard, where there is no such column (FR-059).
    -->
    {#if search}
      <!-- An empty board after a search should say why it is empty. -->
      <p class="searching card">
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
        <label class="pill">
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
        <label class="pill">
          <Icon name="workflow" size={14} />
          <span class="sr">{m.board.pipeline}</span>
          <select bind:value={pipelineId}>
            <option value="">{m.board.anyPipeline}</option>
            {#each [...new Set(rows.map((t) => t.pipelineId).filter(Boolean))] as id (id)}
              <option value={id}>{rows.find((t) => t.pipelineId === id)?.pipeline}</option>
            {/each}
          </select>
          <Icon name="chevron-down" size={14} />
        </label>
        <label class="pill">
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
          onclick={() => (view = 'board')}><Icon name="kanban" size={16} /></button
        >
        <button
          type="button"
          class:on={view === 'list'}
          aria-label={m.board.listView}
          aria-pressed={view === 'list'}
          onclick={() => (view = 'list')}><Icon name="list" size={16} /></button
        >
      </div>
    </div>

    {#if filtered.length === 0}
      <p class="card">{m.board.noMatch} <a href="/tickets/new">{m.board.createOne}</a>.</p>
    {:else if view === 'board'}
      <div class="board">
        {#each COLUMNS as column (column.id)}
          {@const inColumn = filtered.filter((t) => column.id.split(',').includes(t.status))}
          <section>
            <div class="col-head">
              <span class="dot {column.tone}"></span>
              <span class="col-title">{column.label}</span>
              <span class="count">{inColumn.length}</span>
            </div>
            <div class="cards">
              {#each inColumn as ticket (ticket.id)}
                <TicketCard {ticket} />
              {/each}
              {#if column.id === 'draft'}
                <!-- The design puts the way in at the foot of Backlog. -->
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
      <table class="card">
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
              <td>{ticket.pipeline ?? '—'}</td>
              <td>{ticket.strip.text}</td>
            </tr>
          {/each}
        </tbody>
      </table>
  {/if}
{/if}

<style>
  .searching {
    display: flex;
    gap: 10px;
    align-items: baseline;
    padding: 12px 16px;
  }

  /* The design's Filters: choices that look like choices, and a view switch. */
  .filters {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    flex-wrap: wrap;
    margin-bottom: 28px;
  }
  .pills {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
  }
  .pill {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 10px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    color: var(--text-2);
    cursor: pointer;
  }
  .pill:focus-within {
    border-color: var(--accent);
  }
  .pill select {
    border: 0;
    padding: 0;
    background: none;
    font: inherit;
    font-size: 13px;
    font-weight: 500;
    color: var(--text);
    cursor: pointer;
    /* The design draws one chevron; the native one would make two. */
    appearance: none;
  }
  .pill select:focus {
    outline: none;
  }
  .pill :global(svg:last-child) {
    color: var(--text-3);
  }

  .views {
    display: flex;
    gap: 4px;
    padding: 4px;
    background: var(--surface-2);
    border-radius: var(--r-sm);
  }
  .views button {
    display: grid;
    place-items: center;
    padding: 6px;
    border: 0;
    border-radius: 4px;
    background: none;
    color: var(--text-3);
    cursor: pointer;
  }
  .views button.on {
    background: var(--surface);
    color: var(--text);
  }

  .board {
    display: grid;
    grid-template-columns: repeat(5, minmax(200px, 1fr));
    gap: 16px;
    align-items: start;
    overflow-x: auto;
  }

  .col-head {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 4px 8px;
  }
  .col-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--text);
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 999px;
    flex: none;
  }
  .dot.idle {
    background: var(--text-3);
  }
  .dot.live {
    background: var(--accent);
  }
  .dot.warn {
    background: var(--warning);
  }
  .dot.ok {
    background: var(--success);
  }
  .dot.bad {
    background: var(--danger);
  }
  .count {
    padding: 1px 7px;
    border-radius: 999px;
    background: var(--surface-2);
    font-size: 11px;
    font-weight: 600;
    color: var(--text-2);
  }

  .cards {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .add {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 10px;
    border: 1px dashed var(--border);
    border-radius: var(--r-md);
    text-decoration: none;
    font-size: 13px;
    color: var(--text-2);
  }
  .add:hover {
    border-color: var(--accent);
    color: var(--accent-text);
  }

  table {
    width: 100%;
    border-collapse: collapse;
  }
  th,
  td {
    text-align: left;
    padding: 10px 12px;
    border-bottom: 1px solid var(--border);
  }
  th {
    font-size: 12px;
    color: var(--text-2);
    font-weight: 500;
  }
  td a {
    color: inherit;
  }

  @media (max-width: 900px) {
    .board {
      grid-template-columns: repeat(5, 220px);
    }
  }
</style>
