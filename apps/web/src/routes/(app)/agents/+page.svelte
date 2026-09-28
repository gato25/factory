<script lang="ts">
  import AgentCard from '$components/AgentCard.svelte';
  import Icon from '$components/Icon.svelte';
  import { agentDescription, agentName } from '$lib/default-names';
  import { m } from '$lib/i18n';
  import { agents, create, duplicate } from '$lib/remote/agents.remote';

  /**
   * Screen 09 — Agents, built to `design.pen`: a tile per agent with the orb
   * of the engine it runs on, its model, tools, skills and how much depends
   * on it (FR-023, FR-036b, FR-043a), and a last tile for making a new one.
   */
  let { data }: { data: { user: { id: string } } } = $props();

  const list = $derived(agents());
  let notice = $state<string | null>(null);
  let filter = $state('');

  const shown = $derived(
    list.ready
      ? list.current.filter((agent) =>
          filter
            ? `${agentName(agent.name)} ${agentDescription(agent.name, agent.description) ?? ''} ${agent.model}`
                .toLowerCase()
                .includes(filter.toLowerCase())
            : true,
        )
      : [],
  );
</script>

<header class="page-head">
  <div class="text">
    <h1>{m.agents.heading}</h1>
    <p class="lede">{m.agents.lede}</p>
  </div>
  <div class="tools">
    <input
      class="search"
      placeholder={m.agents.search}
      bind:value={filter}
      aria-label={m.agents.search}
    />
    <a class="btn" href="#new-agent"><Icon name="plus" size={15} />{m.agents.newAgent}</a>
  </div>
</header>

{#if notice}<p class="tile notice" role="status">{notice}</p>{/if}

{#if list.error}
  <p class="tile tile--danger failure" role="alert">{(list.error as Error).message}</p>
{:else if !list.ready}
  <p class="tile">{m.agents.loading}</p>
{:else}
  <div class="grid">
    {#each shown as agent (agent.id)}
      <!--
        Duplicating is how a shipped default becomes yours to change
        (FR-031). The artboard's foot carries Edit; this goes beside it.
      -->
      <AgentCard
        {agent}
        mine={agent.ownerId === data.user.id}
        onDuplicate={async () => {
          const result = await duplicate(agent.id);
          notice = ('problem' in result ? result.problem : result.message) ?? null;
        }}
      />
    {/each}

    <form {...create} class="tile new" id="new-agent">
      <div class="new-head">
        <span class="orb-soft" aria-hidden="true"><Icon name="plus" size={22} /></span>
        <h2>{m.agents.newAgent}</h2>
        <p>{m.agentCard.newSub}</p>
      </div>
      <label class="field">
        <span class="label">{m.agents.name}</span>
        <input name="name" placeholder={m.agents.namePlaceholder} required />
      </label>
      <label class="field">
        <span class="label">{m.agents.engine}</span>
        <select name="engine">
          <option value="claude_cli">{m.agents.codingAgent}</option>
          <option value="design_cli">{m.agents.designService}</option>
        </select>
      </label>
      <label class="field">
        <span class="label">{m.agents.whatItIsFor}</span>
        <input name="description" placeholder={m.agents.descriptionPlaceholder} />
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
      <button class="btn" type="submit" disabled={create.pending > 0}>{m.agents.create}</button>
    </form>
  </div>

  {#if shown.length === 0}
    <p class="tile none">{m.agents.noMatch}</p>
  {/if}
{/if}

<style>
  .page-head {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 20px;
    flex-wrap: wrap;
    padding: 4px 4px 0;
    margin-bottom: 20px;
  }
  .text {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }
  h1 {
    margin: 0;
    font-family: var(--font-head);
    font-size: 30px;
    font-weight: 600;
    letter-spacing: -0.6px;
    color: var(--text);
  }
  .lede {
    margin: 0;
    max-width: 90ch;
    font-size: var(--type-body);
    color: var(--text-2);
  }
  .tools {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .search {
    width: 220px;
    padding: 10px 12px;
    border: 1px solid transparent;
    border-radius: 11px;
    font: inherit;
    font-size: var(--type-body);
    background: #ffffffcc;
  }
  .search:focus {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  .notice,
  .failure,
  .none {
    margin: 0 0 20px;
    padding: 14px 18px;
  }
  .none {
    margin-top: 20px;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    gap: 20px;
  }

  .new {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 22px;
    border: 1.5px dashed #f0cdb4;
    background: #ffffff66;
    box-shadow: none;
  }
  .new-head {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding-bottom: 4px;
    text-align: center;
  }
  .orb-soft {
    display: grid;
    place-items: center;
    width: 52px;
    height: 52px;
    border-radius: var(--r-pill);
    color: var(--accent);
    background: var(--accent-soft);
  }
  .new h2 {
    margin: 0;
    font-family: var(--font-head);
    font-size: 17px;
    font-weight: 600;
    color: var(--text);
  }
  .new-head p {
    margin: 0;
    font-size: var(--type-caption);
    color: var(--text-2);
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .label {
    font-size: var(--type-caption);
    font-weight: 600;
    color: var(--text-2);
  }
  input,
  select {
    padding: 9px 11px;
    border: 1px solid var(--border);
    border-radius: 10px;
    font: inherit;
    font-size: var(--type-body);
    background: var(--surface);
  }
  .new .btn {
    align-self: flex-end;
  }
  .errors {
    margin: 0;
    padding-left: 18px;
    font-size: var(--type-body);
    color: var(--danger-text);
  }
</style>
