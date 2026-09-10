<script lang="ts">
  import OwnerBadge from '$components/OwnerBadge.svelte';

  /**
   * One agent. The engine it runs on is stated here, not only in the editor,
   * because it is what decides which steps can use it and whether tool
   * permissions apply at all (FR-036b, FR-036a).
   */
  let {
    agent,
    mine = false
  }: {
    agent: {
      id: string;
      name: string;
      description: string | null;
      engine: string;
      model: string;
      allowedTools: string[];
      skills: string[];
      ownerId: string | null;
      isDefault: boolean;
      mayChange: boolean;
      usage: { pipelines: number; runs: number; runsInFlight: number };
    };
    mine?: boolean;
  } = $props();

  const ENGINE: Record<string, string> = {
    claude_cli: 'Coding agent',
    design_cli: 'Design service'
  };
</script>

<article class="card agent">
  <header>
    <a href="/agents/{agent.id}"><strong>{agent.name}</strong></a>
    <span class="badges">
      <!-- Which engine it runs on (FR-036b) -->
      <span class="badge small engine" class:design={agent.engine === 'design_cli'}>
        {ENGINE[agent.engine] ?? agent.engine}
      </span>
      <OwnerBadge
        isDefault={agent.isDefault}
        {mine}
        mayChange={agent.mayChange}
        ownerName={null}
      />
    </span>
  </header>

  {#if agent.description}<p class="muted small">{agent.description}</p>{/if}

  <dl>
    <dt>Model</dt>
    <dd><code>{agent.model}</code></dd>

    <dt>Tools</dt>
    <dd>
      {#if agent.engine === 'design_cli'}
        <!-- Tool permissions do not apply to this engine (FR-036a) -->
        <span class="muted">not applicable to the design service</span>
      {:else if agent.allowedTools.length === 0}
        <span class="muted">none — it can read nothing and write nothing</span>
      {:else}
        {agent.allowedTools.join(', ')}
      {/if}
    </dd>

    <dt>Skills</dt>
    <dd>{agent.skills.length > 0 ? agent.skills.join(', ') : '—'}</dd>

    <!-- How many pipelines and runs depend on it (FR-043a) -->
    <dt>Used by</dt>
    <dd>
      {agent.usage.pipelines} pipeline{agent.usage.pipelines === 1 ? '' : 's'} &middot;
      {agent.usage.runs} run{agent.usage.runs === 1 ? '' : 's'}
      {#if agent.usage.runsInFlight > 0}
        <span class="badge small warn">{agent.usage.runsInFlight} in flight</span>
      {/if}
    </dd>
  </dl>
</article>

<style>
  .agent { display: flex; flex-direction: column; gap: 8px; }
  header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 10px;
    flex-wrap: wrap;
  }
  a { text-decoration: none; color: inherit; }
  a:hover strong { text-decoration: underline; }
  .badges { display: flex; gap: 6px; flex-wrap: wrap; }
  .engine { background: var(--surface-2); color: var(--text-2); }
  .engine.design { background: #fdeffa; color: #8a3b76; }
  p { margin: 0; }
  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 4px 12px;
    margin: 0;
    font-size: 13px;
  }
  dt { color: var(--text-3); }
  dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
</style>
