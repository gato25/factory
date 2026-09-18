<script lang="ts">
  import { CONDITION_DESCRIPTION, type Step } from '@factory/shared';
  import Icon from '$components/Icon.svelte';
  import { STEP_KIND_LABEL } from '$lib/services/pipeline';

  /**
   * One node on `design.pen`'s canvas: a grip, a 32px chip coloured by what
   * the step is, the name with any badges, a description, a meta line, and an
   * overflow menu.
   *
   * The colour is the point. A checkpoint is amber because a person has to
   * act; a design step is pink and a custom agent purple, the same two
   * colours the Agents screen uses, so the two screens agree about what a
   * thing is. A conditional step is marked as conditional and its condition
   * is stated in words, never as a code (FR-032f).
   */

  export interface BuilderAgent {
    id: string;
    name: string;
    description?: string | null;
    icon?: string | null;
    engine: string;
    model: string;
    allowedTools?: string[];
    toolLabels?: string[];
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
        : custom
          ? 'custom'
          : 'plain',
  );

  /** The design gives each kind its own icon; an agent brings its own. */
  const KIND_ICON: Record<Step['type'], string> = {
    agent: 'bot',
    design: 'palette',
    checkpoint: 'hand',
    shell: 'terminal',
    notify: 'bell',
  };
  const icon = $derived(
    (step.type === 'agent' || step.type === 'design' ? agent?.icon : null) ?? KIND_ICON[step.type],
  );

  const condition = $derived(CONDITION_DESCRIPTION[step.condition]);

  const title = $derived(
    step.type === 'agent' || step.type === 'design'
      ? (agent?.name ?? `${STEP_KIND_LABEL[step.type]} — агент сонгоогүй`)
      : STEP_KIND_LABEL[step.type],
  );

  const description = $derived(describe());
  const meta = $derived(metaOf());

  function describe(): string | undefined {
    switch (step.type) {
      case 'agent':
        return (
          agent?.description ??
          (step.output_files?.length
            ? `${step.output_files.join(', ')} гаргана`
            : 'Код бичнэ')
        );
      case 'checkpoint':
        return [
          step.approvers === 'anyone'
            ? 'Багийн аль ч гишүүн шийднэ'
            : step.approvers === 'ticket_creator'
              ? 'Даалгаврыг үүсгэгч шийднэ'
              : `нэрлэсэн ${(step.approvers ?? []).length} батлагч`,
          step.timeout_hours
            ? `${step.timeout_hours} ц хүлээнэ, дараа нь ${
                step.on_timeout === 'continue'
                  ? 'автоматаар үргэлжилнэ'
                  : step.on_timeout === 'fail'
                    ? 'ажиллагаа амжилтгүй болно'
                    : 'хүлээсэн хэвээр байна'
              }`
            : 'хугацаагүй хүлээнэ',
        ].join(' · ');
      case 'shell':
        return step.command || 'команд хараахан алга';
      case 'notify':
        return step.channel || 'суваг хараахан алга';
      default:
        return undefined;
    }
  }

  function metaOf(): string | undefined {
    if (step.type === 'design') {
      return [
        'pen.dev CLI',
        agent?.model,
        `${step.design?.source_path ?? 'docs/design/ui.pen'} бичнэ`,
      ]
        .filter(Boolean)
        .join(' · ');
    }
    if (step.type !== 'agent' || !agent) return undefined;
    return [
      agent.model,
      agent.toolLabels?.length ? agent.toolLabels.join(', ') : undefined,
      agent.skills?.length ? `ур чадвар: ${agent.skills.join(', ')}` : undefined,
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
    aria-label="{index + 1}-р алхам — {title}"
    onclick={onSelect}
    disabled={!onSelect}
  >
    <span class="ic"><Icon name={icon} size={18} /></span>
    <span class="tx">
      <span class="tr">
        <span class="nm">{title}</span>
        {#if condition}
          <!-- Marked as conditional, in words (FR-032f) -->
          <span class="badge conditional"><span class="dot"></span>{condition}</span>
        {/if}
        {#if custom}
          <span class="badge custom"><span class="dot"></span>Захиалгат</span>
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
        aria-label="{index + 1}-р алхмын үйлдэл"
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
            }}>{index + 1}-р алхмыг дээш зөөх</button
          >
          <button
            type="button"
            disabled={index === total - 1}
            onclick={() => {
              onMoveDown?.();
              menu = false;
            }}>{index + 1}-р алхмыг доош зөөх</button
          >
          <button
            type="button"
            class="danger"
            onclick={() => {
              onRemove?.();
              menu = false;
            }}>{index + 1}-р алхмыг устгах</button
          >
        </span>
      {/if}
    </span>
  {/if}
</li>

<style>
  .node {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 560px;
    max-width: 100%;
    padding: 8px 12px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    box-shadow: 0 1px 3px #0f172a14;
  }

  /* What the step IS, drawn as an edge rather than a label. */
  .node.gate {
    background: var(--warning-soft);
    border: 1.5px solid var(--warning-edge);
    box-shadow: none;
  }
  .node.design {
    border: 1.5px solid var(--design);
  }
  .node.custom {
    border: 1.5px solid var(--purple);
  }
  .node.selected {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .node.invalid {
    border-color: var(--danger);
  }

  .grip {
    display: flex;
    align-items: center;
    gap: 4px;
    flex: none;
    color: var(--flow-line);
    cursor: grab;
  }
  .n {
    font-size: 11px;
    color: var(--text-3);
    min-width: 1ch;
    text-align: right;
  }

  .open {
    display: flex;
    align-items: center;
    gap: 12px;
    flex: 1;
    min-width: 0;
    padding: 0;
    border: 0;
    background: none;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .open:disabled {
    cursor: default;
  }

  .ic {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    border-radius: var(--r-sm);
    flex: none;
    background: var(--accent-soft);
    color: var(--accent-text);
  }
  .node.gate .ic {
    background: var(--warning-chip);
    color: var(--warning);
  }
  .node.design .ic {
    background: var(--design-soft);
    color: var(--design);
  }
  .node.custom .ic {
    background: var(--purple-soft);
    color: var(--purple);
  }

  .tx {
    display: flex;
    flex-direction: column;
    gap: 1px;
    flex: 1;
    min-width: 0;
  }
  .tr {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .nm {
    font-size: 13px;
    font-weight: 600;
    color: var(--text);
  }
  .d {
    font-size: 12px;
    color: var(--text-2);
  }
  .m {
    font-size: 11px;
    color: var(--text-3);
  }
  .d,
  .m {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* A problem is read, not scanned: it wraps rather than truncating. */
  .problem {
    margin-top: 2px;
    font-size: 12px;
    color: var(--danger);
    white-space: normal;
  }

  .badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 3px 8px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 500;
    background: var(--design-soft);
    color: var(--design);
  }
  .badge.custom {
    background: var(--purple-soft);
    color: var(--purple);
  }
  .dot {
    width: 6px;
    height: 6px;
    border-radius: 999px;
    background: currentcolor;
    flex: none;
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
    border-radius: var(--r-sm);
    background: none;
    color: var(--text-3);
    cursor: pointer;
  }
  .more > button:hover {
    background: var(--surface-2);
    color: var(--text-2);
  }
  .menu {
    position: absolute;
    top: 30px;
    right: 0;
    z-index: 5;
    display: flex;
    flex-direction: column;
    gap: 2px;
    width: 200px;
    padding: 6px;
    background: var(--surface);
    border: 1px solid var(--card-border);
    border-radius: var(--r-md);
    box-shadow: 0 8px 24px #0f172a1f;
  }
  .menu button {
    padding: 8px 10px;
    border: 0;
    border-radius: var(--r-sm);
    background: none;
    font: inherit;
    font-size: 13px;
    text-align: left;
    color: var(--text);
    cursor: pointer;
  }
  .menu button:hover:not(:disabled) {
    background: var(--surface-2);
  }
  .menu button:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .menu button.danger {
    color: var(--danger);
  }
</style>
