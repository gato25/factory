<script lang="ts">
  import Icon from '$components/Icon.svelte';
  import OwnerBadge from '$components/OwnerBadge.svelte';

  /**
   * One agent, built to `design.pen`'s Agent card: an icon chip and a badge
   * on one row, the name, the description, then Model / Tools / Skills as a
   * key-value block above a hairline, and a foot carrying usage and Edit.
   *
   * The card is coloured by WHAT THE AGENT IS. A shipped default is accent, a
   * design agent is pink, one somebody made is purple — the same three
   * colours the pipeline builder uses for its step nodes, so the two screens
   * agree about what a thing is. The engine matters here rather than only in
   * the editor: it decides which steps can use the agent and whether tool
   * permissions apply at all (FR-036a, FR-036b).
   */
  let {
    agent,
    mine = false,
  }: {
    agent: {
      id: string;
      name: string;
      description: string | null;
      icon: string | null;
      engine: string;
      model: string;
      allowedTools: string[];
      skills: string[];
      ownerName: string | null;
      isDefault: boolean;
      mayChange: boolean;
      usage: { pipelines: number; runs: number; runsInFlight: number };
    };
    mine?: boolean;
  } = $props();

  const tone = $derived(
    agent.engine === 'design_cli' ? 'design' : agent.isDefault ? 'accent' : 'custom',
  );
  const badge = $derived(
    // The design labels the design agent "Conditional", because that is the
    // fact about it that matters: it runs only when a ticket changes the
    // interface (FR-032b).
    agent.engine === 'design_cli' ? 'Conditional' : agent.isDefault ? 'Default' : 'Custom',
  );
</script>

<article class="agent {tone}">
  <div class="top">
    <span class="chip"><Icon name={agent.icon ?? 'bot'} size={20} /></span>
    <span class="kind">
      <span class="dot"></span>
      {badge}
    </span>
  </div>

  <a class="name" href="/agents/{agent.id}">{agent.name}</a>
  {#if agent.description}<p class="description">{agent.description}</p>{/if}

  <dl class="kv">
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
  </dl>

  <div class="foot">
    <!-- How many pipelines and runs depend on it (FR-043a) -->
    <span class="usage">
      Used in {agent.usage.pipelines} pipeline{agent.usage.pipelines === 1 ? '' : 's'} &middot;
      {agent.usage.runs} run{agent.usage.runs === 1 ? '' : 's'}
      {#if agent.usage.runsInFlight > 0}
        &middot; {agent.usage.runsInFlight} in flight
      {/if}
    </span>
    <span class="right">
      <OwnerBadge
        ownerName={agent.ownerName}
        isDefault={agent.isDefault}
        {mine}
        mayChange={agent.mayChange}
      />
      <a class="edit" href="/agents/{agent.id}">
        <Icon name="pencil" size={16} />
        <span>{agent.mayChange ? 'Edit' : 'Read'}</span>
      </a>
    </span>
  </div>
</article>

<style>
  .agent {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 20px;
    background: var(--surface);
    border: 1px solid var(--card-border);
    border-radius: var(--r-lg);
  }

  .top {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
  }
  .chip {
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    border-radius: var(--r-md);
    flex: none;
  }
  .kind {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    border-radius: 999px;
    font-size: 12px;
    font-weight: 600;
  }
  .dot {
    width: 6px;
    height: 6px;
    border-radius: 999px;
    background: currentcolor;
    flex: none;
  }

  /* What the agent IS, in the same three colours the builder uses. */
  .agent.accent .chip {
    background: var(--accent-soft);
    color: var(--accent-text);
  }
  .agent.accent .kind {
    background: var(--surface-2);
    color: var(--text-2);
  }
  .agent.design .chip,
  .agent.design .kind {
    background: var(--design-soft);
    color: var(--design);
  }
  .agent.custom .chip,
  .agent.custom .kind {
    background: var(--purple-soft);
    color: var(--purple);
  }

  .name {
    font-family: var(--font-head);
    font-size: 17px;
    font-weight: 600;
    color: var(--text);
    text-decoration: none;
  }
  .name:hover {
    text-decoration: underline;
  }
  .description {
    margin: 0;
    font-size: 13px;
    color: var(--text-2);
  }

  .kv {
    display: grid;
    grid-template-columns: 52px 1fr;
    gap: 6px 8px;
    margin: 0;
    padding-top: 12px;
    border-top: 1px solid var(--border);
    font-size: 12px;
  }
  .kv dt {
    color: var(--text-3);
  }
  .kv dd {
    margin: 0;
    font-weight: 500;
    color: var(--text);
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
  }
  .usage {
    font-size: 12px;
    color: var(--text-3);
  }
  .right {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .edit {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: var(--surface);
    text-decoration: none;
    font-size: 14px;
    font-weight: 500;
    color: var(--text);
  }
  .edit :global(svg) {
    color: var(--text-2);
  }
  .edit:hover {
    border-color: var(--accent);
  }
</style>
