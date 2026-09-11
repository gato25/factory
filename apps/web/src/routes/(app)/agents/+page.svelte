<script lang="ts">
  import AgentCard from '$components/AgentCard.svelte';
  import { agents, create, duplicate } from '$lib/remote/agents.remote';

  /**
   * Screen 09 — Agents. A card per agent with its engine, model, tools,
   * skills and how much depends on it (FR-036b, FR-043a).
   */
  let { data }: { data: { user: { id: string } } } = $props();

  const list = $derived(agents());
  let notice = $state<string | null>(null);
  let filter = $state('');

  const shown = $derived(
    list.ready
      ? list.current.filter((agent) =>
          filter
            ? `${agent.name} ${agent.description ?? ''} ${agent.model}`
                .toLowerCase()
                .includes(filter.toLowerCase())
            : true
        )
      : []
  );
</script>

<header class="head">
  <div class="page-head">
    <h2>Agents</h2>
    <p>
      Each agent runs with its own instructions, model, tools and skills. The Design agent runs on
      the pen.dev CLI; the rest run on the Claude CLI. Anyone can make their own; anyone can use
      anyone else's.
    </p>
  </div>
  <input placeholder="Search agents" bind:value={filter} aria-label="Search agents" />
</header>

{#if notice}<p class="card notice" role="status">{notice}</p>{/if}

{#if list.error}
  <p class="card failure" role="alert">{(list.error as Error).message}</p>
{:else if !list.ready}
  <p class="card">Loading agents…</p>
{:else}
  {#if shown.length === 0}
    <p class="card">No agent matches. Create one below.</p>
  {:else}
    <div class="grid">
      {#each shown as agent (agent.id)}
        <div class="cell">
          <!--
            Duplicating is how a shipped default becomes yours to change
            (FR-031). The artboard's foot carries Edit; this goes beside it
            rather than floating under the card.
          -->
          <AgentCard
            {agent}
            mine={agent.ownerId === data.user.id}
            onDuplicate={async () => {
              const result = await duplicate(agent.id);
              notice = ('problem' in result ? result.problem : result.message) ?? null;
            }}
          />
        </div>
      {/each}
    </div>
  {/if}

  <form {...create} class="card new">
    <h2 class="section">New agent</h2>
    <label>
      <span class="small muted">Name</span>
      <input name="name" placeholder="Reviewer" required />
    </label>
    <label>
      <span class="small muted">Engine</span>
      <select name="engine">
        <option value="claude_cli">Coding agent</option>
        <option value="design_cli">Design service</option>
      </select>
    </label>
    <label>
      <span class="small muted">What it is for</span>
      <input name="description" placeholder="Reads a diff and objects" />
    </label>
    {#if create.fields.allIssues()?.length}
      <ul class="errors" role="alert">
        {#each create.fields.allIssues() ?? [] as issue (issue.message)}
          <li>{issue.message}</li>
        {/each}
      </ul>
    {/if}
    {#if create.result && 'problem' in create.result}
      <p class="errors" role="alert">{create.result.problem}</p>
    {/if}
    <div class="row end">
      <button class="primary" type="submit" disabled={create.pending > 0}>Create</button>
    </div>
  </form>
{/if}

<style>
  .head {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 16px;
    flex-wrap: wrap;
    margin-bottom: 28px;
  }
  .page-head {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .page-head h2 {
    margin: 0;
    font-size: 24px;
    font-weight: 700;
    color: var(--text);
  }
  .page-head p {
    margin: 0;
    max-width: 78ch;
    font-size: 14px;
    color: var(--text-2);
  }
  .notice { border-left: 3px solid var(--accent); margin-bottom: 16px; padding: 12px 16px; }
  .failure { border-left: 3px solid var(--danger); }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
    gap: 16px;
  }
  /* Cards line up across a row, as the design's grid does: ragged heights
     make the set read as unrelated items rather than as one list. */
  .cell {
    display: flex;
    flex-direction: column;
    gap: 8px;
    align-items: flex-start;
  }
  .cell :global(.agent) {
    flex: 1;
    width: 100%;
  }
  .row { display: flex; gap: 8px; }
  .row.end { justify-content: flex-end; }
  .new { margin-top: 16px; display: flex; flex-direction: column; gap: 10px; }
  label { display: flex; flex-direction: column; gap: 4px; }
  input, select {
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    font: inherit;
  }
  button, .edit {
    padding: 8px 14px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: var(--surface);
    font: inherit;
    cursor: pointer;
    text-decoration: none;
    color: inherit;
  }
  button.primary {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
    font-weight: 600;
  }
  .errors { margin: 0; padding-left: 18px; color: var(--danger); }
</style>
