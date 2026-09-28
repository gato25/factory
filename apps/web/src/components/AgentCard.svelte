<script lang="ts">
  import Icon from '$components/Icon.svelte';
  import OwnerBadge from '$components/OwnerBadge.svelte';
  import { agentDescription, agentName } from '$lib/default-names';
  import { modelName } from '$lib/format';
  import { m } from '$lib/i18n';

  /**
   * One agent, as artboard 09 draws it: an orb and a badge on one row, the
   * name, what it is for, the model, tools and skills as soft rows, and a
   * foot carrying how much depends on it and the actions
   * (specs/004-bento-redesign FR-023).
   *
   * The orb is the engine the agent runs on — pen.dev blue for the design
   * service, the accent for the Claude CLI — because the engine decides
   * which steps can use it and whether tool permissions apply at all
   * (FR-036a, FR-036b). One somebody made takes the deep accent and says
   * "Захиалгат" in words, as its step does in the builder, so the two
   * screens agree about what a thing is.
   */
  let {
    agent,
    mine = false,
    onDuplicate,
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
    /** Duplicating is how a shipped default becomes yours (FR-031). */
    onDuplicate?: () => void;
  } = $props();

  const design = $derived(agent.engine === 'design_cli');
  const badge = $derived(
    // The design labels the design agent "Нөхцөлт", because that is the fact
    // about it that matters: it runs only when a ticket changes the interface
    // (FR-032b).
    design
      ? m.agentCard.conditional
      : agent.isDefault
        ? m.agentCard.isDefault
        : m.agentCard.custom,
  );
  const tools = $derived(
    agent.allowedTools
      .map((tool) => m.toolName[tool as keyof typeof m.toolName] ?? tool)
      .join(', '),
  );
  const used = $derived(agent.usage.pipelines > 0 || agent.usage.runs > 0);
</script>

<article class="tile agent" data-agent={agent.id}>
  <div class="top">
    <span
      class="orb"
      class:orb--pen={design}
      class:custom={!design && !agent.isDefault}
      role="img"
      aria-label={design ? m.agentCard.penCli : m.agentCard.claudeCli}
      title={design ? m.agentCard.penCli : m.agentCard.claudeCli}
    >
      <Icon name={agent.icon ?? (design ? 'pen-tool' : 'bot')} size={20} />
    </span>
    <span class="badges">
      <OwnerBadge
        ownerName={agent.ownerName}
        isDefault={agent.isDefault}
        {mine}
        mayChange={agent.mayChange}
      />
      <span class="kind" class:pen={design} class:custom={!design && !agent.isDefault}>{badge}</span>
    </span>
  </div>

  <div class="tx">
    <a class="name" href="/agents/{agent.id}">{agentName(agent.name)}</a>
    {#if agentDescription(agent.name, agent.description)}
      <p class="description">{agentDescription(agent.name, agent.description)}</p>
    {/if}
  </div>

  <dl class="kv">
    <div class="row">
      <dt>{m.agentCard.model}</dt>
      <dd>{modelName(agent.model)}</dd>
    </div>
    {#if design}
      <!-- Tool permissions do not apply to this engine (FR-036a); what it runs on and makes does. -->
      <div class="row">
        <dt>{m.agentCard.engine}</dt>
        <dd class="pen-text">{m.agentCard.penCli}</dd>
      </div>
      <div class="row">
        <dt>{m.agentCard.output}</dt>
        <dd>{m.agentCard.designOutput}</dd>
      </div>
    {:else}
      <div class="row">
        <dt>{m.agentCard.tools}</dt>
        <dd>{tools || m.agentCard.noTools}</dd>
      </div>
      <div class="row">
        <dt>{m.agentCard.skills}</dt>
        <dd>{agent.skills.length > 0 ? agent.skills.join(', ') : '—'}</dd>
      </div>
    {/if}
  </dl>

  <div class="foot">
    <!-- How many pipelines and runs depend on it (FR-043a) -->
    <span class="usage">
      {used ? m.agentCard.usage(agent.usage.pipelines, agent.usage.runs) : m.agentCard.unused}
      {#if agent.usage.runsInFlight > 0}
        · {m.agentCard.inFlight(agent.usage.runsInFlight)}
      {/if}
    </span>
    <span class="actions">
      {#if onDuplicate}
        <button type="button" class="btn btn--secondary small" onclick={onDuplicate}>
          <Icon name="copy" size={12} />{m.agentCard.duplicate}
        </button>
      {/if}
      <a class="btn btn--secondary small" href="/agents/{agent.id}">
        <Icon name="pencil" size={12} />{agent.mayChange ? m.agentCard.edit : m.agentCard.read}
      </a>
    </span>
  </div>
</article>

<style>
  .agent {
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-width: 0;
    padding: 22px;
  }
  .top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  .orb.custom {
    --orb-a: var(--accent-deep-from);
    --orb-b: var(--accent-deep-to);
  }
  .kind {
    padding: 4px 10px;
    border-radius: var(--r-pill);
    font-size: var(--type-caption);
    font-weight: 700;
    color: var(--accent-text);
    background: var(--accent-soft);
  }
  .kind.pen {
    color: var(--pen-text);
    background: #e3ecfb;
  }
  .kind.custom {
    color: var(--accent-text);
    background: var(--accent-soft);
    box-shadow: inset 0 0 0 1px #f0cdb4;
  }

  .tx {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }
  .name {
    font-family: var(--font-head);
    font-size: 18px;
    font-weight: 600;
    letter-spacing: -0.3px;
    color: var(--text);
    text-decoration: none;
    overflow-wrap: anywhere;
  }
  .name:hover {
    text-decoration: underline;
  }
  .description {
    margin: 0;
    font-size: var(--type-caption);
    line-height: 1.45;
    color: var(--text-2);
  }

  .kv {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin: 0;
  }
  .row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    padding: 7px 10px;
    border-radius: 10px;
    background: #f4f2ef;
    font-size: var(--type-caption);
  }
  dt {
    flex: none;
    color: var(--text-2);
  }
  dd {
    min-width: 0;
    margin: 0;
    font-weight: 600;
    text-align: right;
    color: var(--text);
    overflow-wrap: anywhere;
  }
  .pen-text {
    color: var(--pen-text);
  }

  .badges {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
    justify-content: flex-end;
  }
  .foot {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin-top: auto;
  }
  .usage {
    font-size: var(--type-caption);
    color: var(--text-3);
  }
  .btn.small {
    padding: 7px 12px;
  }
  .actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 6px;
    flex-wrap: wrap;
  }
</style>
