<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import ApprovalPanel from '$components/ApprovalPanel.svelte';
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

  const COLUMNS = [
    { id: 'draft', label: 'Backlog' },
    { id: 'queued,running', label: 'Running' },
    { id: 'waiting_approval', label: 'Waiting approval' },
    { id: 'done', label: 'Done' },
    { id: 'failed', label: 'Failed' }
  ];
</script>

{#if board.error}
  <p class="card" role="alert">{(board.error as Error).message}</p>
{:else if !board.ready}
  <p class="card">Loading tickets…</p>
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

    <!-- Grouped by the state that needs a person, before the board (FR-059). -->
    <ApprovalPanel heading="Waiting approval" compact />

    {#if search}
      <!-- An empty board after a search should say why it is empty. -->
      <p class="searching card">
        Showing tickets matching <strong>{search}</strong>.
        <a href="/tickets">Clear the search</a>
      </p>
    {/if}

    <div class="controls card">
      <label>
        <span class="sr">Repository</span>
        <select bind:value={repositoryId}>
          <option value="">All repositories</option>
          {#each repos.ready ? repos.current : [] as repo (repo.id)}
            <option value={repo.id}>{repo.fullPath}</option>
          {/each}
        </select>
      </label>
      <label>
        <span class="sr">Pipeline</span>
        <select bind:value={pipelineId}>
          <option value="">All pipelines</option>
          {#each [...new Set(rows.map((t) => t.pipelineId).filter(Boolean))] as id (id)}
            <option value={id}>{rows.find((t) => t.pipelineId === id)?.pipeline}</option>
          {/each}
        </select>
      </label>
      <label>
        <span class="sr">Creator</span>
        <select bind:value={createdBy}>
          <option value="">Anyone</option>
          {#each [...new Set(rows.map((t) => t.createdBy))] as id (id)}
            <option value={id}>{rows.find((t) => t.createdBy === id)?.createdByName}</option>
          {/each}
        </select>
      </label>
      <div class="toggle">
        <button class:on={view === 'board'} onclick={() => (view = 'board')}>Board</button>
        <button class:on={view === 'list'} onclick={() => (view = 'list')}>List</button>
      </div>
    </div>

    {#if filtered.length === 0}
      <p class="card">No tickets match. <a href="/tickets/new">Create one</a>.</p>
    {:else if view === 'board'}
      <div class="board">
        {#each COLUMNS as column (column.id)}
          {@const inColumn = filtered.filter((t) => column.id.split(',').includes(t.status))}
          <section>
            <h2 class="section">{column.label} <span class="muted">{inColumn.length}</span></h2>
            <div class="cards">
              {#each inColumn as ticket (ticket.id)}
                <TicketCard {ticket} />
              {/each}
            </div>
          </section>
        {/each}
      </div>
    {:else}
      <table class="card">
        <thead>
          <tr><th>Ticket</th><th>Repository</th><th>Pipeline</th><th>Status</th></tr>
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

  .controls {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
    align-items: center;
    margin-bottom: 16px;
    padding: 12px 16px;
  }
  select {
    padding: 7px 10px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    font: inherit;
  }
  .toggle {
    margin-left: auto;
    display: flex;
  }
  .toggle button {
    padding: 7px 12px;
    border: 1px solid var(--border);
    background: var(--surface);
    font: inherit;
    cursor: pointer;
  }
  .toggle button:first-child { border-radius: var(--r-sm) 0 0 var(--r-sm); }
  .toggle button:last-child { border-radius: 0 var(--r-sm) var(--r-sm) 0; border-left: 0; }
  .toggle button.on { background: var(--accent); border-color: var(--accent); color: #fff; }
  .board {
    display: grid;
    grid-template-columns: repeat(5, minmax(200px, 1fr));
    gap: 12px;
    overflow-x: auto;
  }
  .cards { display: flex; flex-direction: column; gap: 8px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid var(--border); }
  th { font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-3); }
  td a { color: inherit; }
  @media (max-width: 900px) {
    .board { grid-template-columns: repeat(5, 220px); }
  }
</style>
