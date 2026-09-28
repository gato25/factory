<script lang="ts">
  import type { Step } from '@factory/shared';
  import Icon from '$components/Icon.svelte';
  import { agentDescription, agentName } from '$lib/default-names';
  import { modelName } from '$lib/format';
  import { m } from '$lib/i18n';
  import { STEP_KIND_LABEL } from '$lib/services/pipeline';

  /**
   * One step card on artboard 08's canvas: a grip, an orb coloured by what
   * the step is, the name with any badges, a line saying what it does, and an
   * overflow menu (specs/004-bento-redesign FR-022).
   *
   * The colour is the point, and each keeps its one meaning (FR-005): the
   * accent for an agent's work — deeper for a custom agent, which also says
   * "Захиалгат" in words — golden yellow for a checkpoint, where a person
   * has to act, pen.dev blue for a design step, grey for a shell command and
   * green for a notification. A conditional step is marked as conditional and
   * its condition is stated in words, never as a code (FR-032f).
   */

  export interface BuilderAgent {
    id: string;
    name: string;
    description?: string | null;
    icon?: string | null;
    engine: string;
    model: string;
    allowedTools?: string[];
    skills?: string[];
    isDefault?: boolean;
  }

  let {
    step,
    index,
    total,
    agent,
    selected = false,
    problems = [],
    onSelect,
    onRemove,
    onMoveUp,
    onMoveDown,
    editable = true,
  }: {
    step: Step;
    index: number;
    total: number;
    agent?: BuilderAgent;
    selected?: boolean;
    /** Every problem this step has: one can breach two rules at once. */
    problems?: string[];
    onSelect?: () => void;
    onRemove?: () => void;
    onMoveUp?: () => void;
    onMoveDown?: () => void;
    editable?: boolean;
  } = $props();

  let menu = $state(false);

  const custom = $derived(
    (step.type === 'agent' || step.type === 'design') && agent ? agent.isDefault === false : false,
  );
  const tone = $derived(
    step.type === 'checkpoint'
      ? 'gate'
      : step.type === 'design'
        ? 'design'
        : step.type === 'shell'
          ? 'shell'
          : step.type === 'notify'
            ? 'notify'
            : custom
              ? 'custom'
              : 'plain',
  );

  /** The design gives each kind its own icon; an agent brings its own. */
  const KIND_ICON: Record<Step['type'], string> = {
    agent: 'bot',
    design: 'pen-tool',
    checkpoint: 'hand',
    shell: 'terminal',
    notify: 'bell',
  };
  const icon = $derived(
    (step.type === 'agent' || step.type === 'design' ? agent?.icon : null) ?? KIND_ICON[step.type],
  );

  const condition = $derived(
    step.condition === 'always' ? undefined : m.newTicket.condition[step.condition],
  );

  const title = $derived(
    step.type === 'agent' || step.type === 'design'
      ? agent
        ? agentName(agent.name)
        : m.stepNode.noAgentChosen(STEP_KIND_LABEL[step.type])
      : STEP_KIND_LABEL[step.type],
  );

  const description = $derived(describe());
  const meta = $derived(metaOf());

  function describe(): string | undefined {
    switch (step.type) {
      case 'agent':
        return (
          (agent ? agentDescription(agent.name, agent.description ?? null) : null) ??
          (step.output_files?.length
            ? m.stepNode.produces(step.output_files.join(', '))
            : m.stepNode.writesTheCode)
        );
      case 'checkpoint':
        return [
          step.approvers === 'anyone'
            ? m.stepNode.anyoneDecides
            : step.approvers === 'ticket_creator'
              ? m.stepNode.authorDecides
              : m.stepNode.namedApprovers((step.approvers ?? []).length),
          step.timeout_hours
            ? m.stepNode.timeout(
                step.timeout_hours,
                step.on_timeout === 'continue'
                  ? m.stepNode.autoContinue
                  : step.on_timeout === 'fail'
                    ? m.stepNode.runFails
                    : m.stepNode.keepsWaiting,
              )
            : m.stepNode.waitsIndefinitely,
        ].join(' · ');
      case 'shell':
        return step.command || m.stepNode.noCommandYet;
      case 'notify':
        return step.channel || m.stepNode.noChannelYet;
      default:
        return undefined;
    }
  }

  function metaOf(): string | undefined {
    if (step.type === 'design') {
      return [
        'pen.dev CLI',
        agent?.model ? modelName(agent.model) : undefined,
        m.stepNode.writesDesign(step.design?.source_path ?? 'docs/design/ui.pen'),
      ]
        .filter(Boolean)
        .join(' · ');
    }
    if (step.type !== 'agent' || !agent) return undefined;
    return [
      modelName(agent.model),
      agent.allowedTools?.length ? agent.allowedTools.join(', ') : undefined,
      agent.skills?.length ? m.stepNode.skills(agent.skills.join(', ')) : undefined,
    ]
      .filter(Boolean)
      .join(' · ');
  }
</script>

<svelte:window onclick={() => (menu = false)} />

<li class="node {tone}" class:selected class:invalid={problems.length > 0}>
  <!-- The number is not on the artboard. It is here because this screen's own
       refusals say "Step 1 is a design step…", and a message naming a step
       nobody can count to is a message about nothing. -->
  <span class="grip" aria-hidden="true">
    <span class="n">{index + 1}</span>
    <Icon name="grip-vertical" size={16} />
  </span>

  <!-- Named by its position as well as its title: this screen's refusals say
       "Step 1 is a design step…", and the name has to be the thing they
       point at. -->
  <button
    type="button"
    class="open"
    aria-label={m.stepNode.stepLabel(index + 1, title)}
    onclick={onSelect}
    disabled={!onSelect}
  >
    <span class="ic" aria-hidden="true"><Icon name={icon} size={16} /></span>
    <span class="tx">
      <span class="tr">
        <span class="nm">{title}</span>
        {#if condition}
          <!-- Marked as conditional, in words (FR-032f) -->
          <span class="badge conditional">{condition}</span>
        {/if}
        {#if custom}
          <span class="badge custom">{m.stepNode.custom}</span>
        {/if}
      </span>
      {#if description}<span class="d">{description}</span>{/if}
      {#if meta}<span class="m">{meta}</span>{/if}
      {#each problems as problem (problem)}
        <span class="problem">{problem}</span>
      {/each}
    </span>
  </button>

  {#if editable}
    <span class="more">
      <button
        type="button"
        aria-label={m.stepNode.actionsFor(index + 1)}
        aria-expanded={menu}
        onclick={(event) => {
          event.stopPropagation();
          menu = !menu;
        }}
      >
        <Icon name="ellipsis-vertical" size={16} />
      </button>
      {#if menu}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <span class="menu" onclick={(event) => event.stopPropagation()}>
          <button
            type="button"
            disabled={index === 0}
            onclick={() => {
              onMoveUp?.();
              menu = false;
            }}>{m.stepNode.moveUp(index + 1)}</button
          >
          <button
            type="button"
            disabled={index === total - 1}
            onclick={() => {
              onMoveDown?.();
              menu = false;
            }}>{m.stepNode.moveDown(index + 1)}</button
          >
          <button
            type="button"
            class="danger"
            onclick={() => {
              onRemove?.();
              menu = false;
            }}>{m.stepNode.remove(index + 1)}</button
          >
        </span>
      {/if}
    </span>
  {/if}
</li>

<style>
  /* A step card: the kit's tile at a smaller radius, tinted by what it is. */
  .node {
    --node-a: var(--tile-from);
    --node-b: var(--tile-to);
    display: flex;
    align-items: center;
    gap: 12px;
    width: 640px;
    max-width: 100%;
    padding: 10px 14px 10px 10px;
    border: 1px solid transparent;
    border-radius: var(--r-lg);
    background:
      linear-gradient(180deg, var(--node-a), var(--node-b)) padding-box,
      linear-gradient(180deg, var(--highlight), #ffffff00) border-box;
    box-shadow: 0 6px 16px var(--shadow-depth);
  }
  .node.gate {
    --node-a: var(--approval-from);
    --node-b: var(--approval-to);
  }
  .node.selected {
    box-shadow:
      0 0 0 2px var(--accent),
      0 6px 16px var(--shadow-depth);
  }
  .node.invalid {
    box-shadow:
      0 0 0 2px var(--red-to),
      0 6px 16px var(--shadow-depth);
  }

  .grip {
    display: flex;
    flex: none;
    align-items: center;
    gap: 4px;
    color: var(--text-3);
    cursor: grab;
  }
  .n {
    min-width: 1ch;
    font-size: var(--type-caption);
    text-align: right;
    color: var(--text-3);
  }

  .open {
    display: flex;
    flex: 1;
    align-items: center;
    gap: 12px;
    min-width: 0;
    padding: 0;
    border: 0;
    font: inherit;
    text-align: left;
    color: inherit;
    background: none;
    cursor: pointer;
  }
  .open:disabled {
    cursor: default;
  }

  /* The orb says what kind of step it is (FR-005, FR-022). */
  .ic {
    --ic-a: var(--accent-from);
    --ic-b: var(--accent-to);
    display: grid;
    flex: none;
    place-items: center;
    width: 34px;
    height: 34px;
    border-radius: 11px;
    color: var(--text-inv);
    background: linear-gradient(180deg, var(--ic-a), var(--ic-b));
  }
  .node.custom .ic {
    --ic-a: var(--accent-deep-from);
    --ic-b: var(--accent-deep-to);
  }
  .node.gate .ic {
    --ic-a: var(--amber-from);
    --ic-b: var(--amber-to);
    color: var(--on-amber);
  }
  .node.design .ic {
    --ic-a: var(--pen-from);
    --ic-b: var(--pen-to);
  }
  .node.shell .ic {
    --ic-a: #b9b2a9;
    --ic-b: #6a635a;
  }
  .node.notify .ic {
    --ic-a: var(--mint-from);
    --ic-b: var(--mint-to);
  }

  .tx {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .tr {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }
  .nm {
    font-size: var(--type-body);
    font-weight: 700;
    color: var(--text);
  }
  .node.gate .nm {
    color: #4a3a00;
  }
  .d,
  .m {
    overflow: hidden;
    font-size: var(--type-caption);
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-2);
  }
  .node.gate .d {
    color: #7a6310;
  }
  .m {
    color: var(--text-3);
  }
  /* A problem is read, not scanned: it wraps rather than truncating. */
  .problem {
    margin-top: 2px;
    font-size: var(--type-caption);
    white-space: normal;
    color: var(--danger-text);
  }

  .badge {
    padding: 2px 8px;
    border-radius: var(--r-pill);
    font-size: var(--type-caption);
    font-weight: 700;
    color: var(--pen-text);
    background: var(--purple-soft);
  }
  .node.gate .badge.conditional {
    color: var(--warning-text);
    background: #fffbea;
  }
  .badge.custom {
    color: var(--accent-text);
    background: var(--accent-soft);
  }

  .more {
    position: relative;
    flex: none;
  }
  .more > button {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    padding: 0;
    border: 0;
    border-radius: 8px;
    color: var(--text-3);
    background: none;
    cursor: pointer;
  }
  .more > button:hover {
    color: var(--text-2);
    background: #ffffffb3;
  }
  .menu {
    position: absolute;
    top: 32px;
    right: 0;
    z-index: 5;
    display: flex;
    flex-direction: column;
    gap: 2px;
    width: 220px;
    padding: 6px;
    border-radius: 14px;
    background: var(--surface);
    box-shadow:
      0 1px 2px var(--shadow-soft),
      0 14px 36px var(--shadow-depth);
  }
  .menu button {
    padding: 9px 10px;
    border: 0;
    border-radius: 10px;
    font: 500 var(--type-body) / 1.3 var(--font);
    text-align: left;
    color: var(--text);
    background: none;
    cursor: pointer;
  }
  .menu button:hover:not(:disabled) {
    background: var(--surface-2);
  }
  .menu button:disabled {
    cursor: default;
    opacity: 0.4;
  }
  .menu button.danger {
    color: var(--danger-text);
  }
</style>
