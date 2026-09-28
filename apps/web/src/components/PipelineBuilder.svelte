<script lang="ts">
  import { agentName } from '$lib/default-names';
  import { modelName } from '$lib/format';
  import type { Step } from '@factory/shared';
  import Icon from '$components/Icon.svelte';
  import { m } from '$lib/i18n';
  import StepEditor from '$components/StepEditor.svelte';
  import StepNode, { type BuilderAgent } from '$components/StepNode.svelte';
  import {
    blankStep,
    IMPLICIT_LAST_STEP,
    PALETTE_ORDER,
    STEP_KIND_DETAIL,
    STEP_KIND_LABEL,
  } from '$lib/services/pipeline';

  /**
   * Built to `design.pen`'s 08 Pipeline Builder: a grey canvas carrying the
   * trigger, the nodes and the finish, with a 320px palette beside it.
   *
   * A + sits on every connector so a step can go between any two (FR-026);
   * dragging reorders, and the overflow menu on each node does the same for
   * anyone not using a mouse. Choosing a node opens its editor under it —
   * the artboard shows a permanent palette, so the editor comes to the step
   * rather than replacing the palette.
   *
   * Every edit here is to a DRAFT. A pipeline gains a version when someone
   * saves, not when they drag a step (FR-027).
   */
  let {
    steps = $bindable(),
    agents = [],
    members = [],
    problems = [],
    editable = true,
  }: {
    steps: Step[];
    agents: BuilderAgent[];
    members: { id: string; name: string }[];
    problems: { index: number | null; message: string }[];
    editable?: boolean;
  } = $props();

  let selected = $state<number | null>(null);
  let dragging = $state<number | null>(null);
  let dragKind = $state<(typeof PALETTE_ORDER)[number] | null>(null);
  let dropAt = $state<number | null>(null);
  let openPlus = $state<number | null>(null);

  const overall = $derived(problems.filter((p) => p.index === null));

  /**
   * FR-034a and SC-016 — a pipeline with no verification step is a pipeline
   * where nothing beyond the implementing agent checks the result. That is a
   * legitimate choice, so it is a warning rather than a refusal — but it is
   * made plain here, where the choice is being made, as well as before a
   * ticket is started.
   */
  const verifies = $derived(
    steps.some((step) => step.type === 'shell' && Boolean(step.command?.trim())),
  );
  const problemsFor = (index: number) =>
    problems.filter((p) => p.index === index).map((p) => p.message);

  function move(from: number, to: number) {
    const next = [...steps];
    const [step] = next.splice(from, 1);
    if (!step) return;
    next.splice(Math.max(0, Math.min(next.length, to)), 0, step);
    steps = next;
    selected = next.indexOf(step);
  }

  function insert(at: number, kind: (typeof PALETTE_ORDER)[number]) {
    const next = [...steps];
    next.splice(at, 0, blankStep(kind));
    steps = next;
    selected = at;
    openPlus = null;
  }

  function remove(at: number) {
    steps = steps.filter((_, index) => index !== at);
    selected = null;
  }

  function change(at: number, step: Step) {
    steps = steps.map((existing, index) => (index === at ? step : existing));
  }

  /** A drop is either a reorder or a new step from the palette. */
  function onDrop(at: number) {
    if (dragKind) insert(at, dragKind);
    else if (dragging !== null) move(dragging, dragging < at ? at - 1 : at);
    dragging = null;
    dragKind = null;
    dropAt = null;
  }
</script>

<svelte:window onclick={() => (openPlus = null)} />

{#snippet connector(at: number, label: string)}
  <li class="conn" class:over={dropAt === at}>
    <span class="v"></span>
    {#if editable}
      <span class="plus">
        <button
          type="button"
          aria-label={label}
          aria-expanded={openPlus === at}
          onclick={(event) => {
            event.stopPropagation();
            openPlus = openPlus === at ? null : at;
          }}
        >
          <Icon name="plus" size={12} />
        </button>
        {#if openPlus === at}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <span class="picker" onclick={(event) => event.stopPropagation()}>
            {#each PALETTE_ORDER as kind (kind)}
              <button type="button" onclick={() => insert(at, kind)}>
                <Icon name={STEP_KIND_DETAIL[kind].icon} size={14} />
                <span>{STEP_KIND_LABEL[kind]}</span>
              </button>
            {/each}
          </span>
        {/if}
      </span>
      <span class="v2"></span>
      <span
        class="drop"
        role="presentation"
        ondragover={(event) => {
          event.preventDefault();
          dropAt = at;
        }}
        ondragleave={() => (dropAt = dropAt === at ? null : dropAt)}
        ondrop={() => onDrop(at)}
      ></span>
    {/if}
  </li>
{/snippet}

<div class="builder">
  <div class="canvas">
    {#if overall.length > 0}
      <ul class="banner bad" role="alert">
        {#each overall as problem (problem.message)}
          <li>{problem.message}</li>
        {/each}
      </ul>
    {/if}

    {#if steps.length > 0 && !verifies}
      <p class="banner warn">{m.newTicket.noVerification}</p>
    {/if}

    <!-- What starts a run. Not a step: it is the pipeline's entry (plan.md). -->
    <p class="trigger">
      <Icon name="zap" size={16} />
      <span>{m.builder.trigger}</span>
    </p>

    <ol>
      {#each steps as step, index (index)}
        {@render connector(index, m.builder.insertAt(index + 1))}
        <li
          class="slot"
          draggable={editable}
          role="presentation"
          ondragstart={() => (dragging = index)}
          ondragend={() => {
            dragging = null;
            dropAt = null;
          }}
        >
          <ol class="one">
            <StepNode
              {step}
              {index}
              total={steps.length}
              {editable}
              selected={selected === index}
              problems={problemsFor(index)}
              agent={agents.find((a) => a.id === step.agent_id)}
              onSelect={() => (selected = selected === index ? null : index)}
              onRemove={() => remove(index)}
              onMoveUp={() => move(index, index - 1)}
              onMoveDown={() => move(index, index + 2)}
            />
          </ol>
          {#if selected === index && editable}
            <div class="inline-editor">
              <StepEditor
                {step}
                {index}
                {agents}
                {members}
                onChange={(next) => change(index, next)}
                onClose={() => (selected = null)}
              />
            </div>
          {/if}
        </li>
      {/each}

      {@render connector(steps.length, m.builder.addAtEnd)}

      <!-- Implicit and always last: not a step anyone can move (FR-029) -->
      <li class="finish" title={IMPLICIT_LAST_STEP.why}>
        <Icon name="git-pull-request" size={16} />
        <span>{m.builder.finish}</span>
      </li>
      <li class="why">{IMPLICIT_LAST_STEP.why}</li>
    </ol>
  </div>

  <aside class="palette">
    {#if editable}
      <section class="tile side">
        <h3>{m.builder.addSequence}</h3>
        <p>{m.builder.addHint}</p>
        {#each PALETTE_ORDER as kind (kind)}
          <button
            type="button"
            class="pal {kind}"
            draggable="true"
            ondragstart={() => (dragKind = kind)}
            ondragend={() => {
              dragKind = null;
              dropAt = null;
            }}
            onclick={() => insert(steps.length, kind)}
          >
            <span class="ic"><Icon name={STEP_KIND_DETAIL[kind].icon} size={15} /></span>
            <span class="tx">
              <span class="n">{STEP_KIND_LABEL[kind]}</span>
              <span class="d">{STEP_KIND_DETAIL[kind].description}</span>
            </span>
            <Icon name="grip-vertical" size={14} />
          </button>
        {/each}
      </section>
    {/if}

    <section class="tile side">
      <h3>{m.builder.yourAgents}</h3>
      {#if agents.length === 0}
        <p>{m.builder.noAgents}</p>
      {:else}
        {#each agents as agent (agent.id)}
          <a class="ag" href="/agents/{agent.id}">
            <span class="l">
              <span class="mini {agent.engine === 'design_cli' ? 'pen' : ''}" aria-hidden="true"
                ><Icon name={agent.icon ?? 'bot'} size={12} /></span
              >
              <span class="nm">{agentName(agent.name)}</span>
            </span>
            <span class="m" class:pen={agent.engine === 'design_cli'}
              >{agent.engine === 'design_cli' ? 'pen.dev' : modelName(agent.model)}</span
            >
          </a>
        {/each}
      {/if}
    </section>
  </aside>
</div>

<style>
  .builder {
    display: flex;
    align-items: stretch;
    gap: 20px;
  }

  /* ---- the canvas: a soft tile the steps are threaded down ---- */
  .canvas {
    display: flex;
    flex: 1;
    flex-direction: column;
    align-items: center;
    min-width: 0;
    padding: 26px 24px;
    border: 1px solid transparent;
    border-radius: var(--r-xl);
    background:
      linear-gradient(180deg, #faf9f7, #f3f1ee) padding-box,
      linear-gradient(180deg, var(--highlight), #ffffff00) border-box;
    box-shadow:
      0 1px 2px var(--shadow-soft),
      0 14px 36px var(--shadow-depth);
  }
  .canvas ol {
    display: flex;
    flex-direction: column;
    align-items: center;
    width: 100%;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .canvas ol.one {
    width: auto;
  }

  .trigger,
  .finish {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    margin: 0;
    padding: 9px 16px;
    border-radius: var(--r-pill);
    font-size: var(--type-body);
    font-weight: 700;
    color: var(--text-inv);
  }
  .trigger {
    background: linear-gradient(180deg, var(--accent-deep-from), var(--accent-deep-to));
    box-shadow: 0 6px 14px var(--glow-accent);
  }
  .finish {
    background: linear-gradient(180deg, var(--mint-deep-from), var(--mint-deep-to));
    box-shadow: 0 6px 14px #16a34a40;
  }
  .why {
    margin-top: 8px;
    font-size: var(--type-caption);
    color: var(--text-2);
  }

  /* ---- connectors, each with its + ---- */
  .conn {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
  }
  .v,
  .v2 {
    width: 2px;
    background: var(--flow-line);
  }
  .v {
    height: 10px;
  }
  .v2 {
    height: 10px;
  }
  .conn.over .v,
  .conn.over .v2 {
    background: var(--accent);
  }
  .plus {
    position: relative;
    z-index: 2;
  }
  .plus > button {
    display: grid;
    place-items: center;
    width: 26px;
    height: 18px;
    padding: 0;
    border: 0;
    border-radius: var(--r-pill);
    color: var(--accent);
    background: var(--surface);
    box-shadow: 0 2px 5px var(--shadow-depth);
    cursor: pointer;
  }
  .plus > button:hover,
  .plus > button[aria-expanded='true'] {
    color: var(--text-inv);
    background: var(--accent-deep-from);
  }
  .picker {
    position: absolute;
    top: 24px;
    left: 50%;
    z-index: 6;
    display: flex;
    flex-direction: column;
    gap: 2px;
    width: 230px;
    padding: 6px;
    border-radius: 14px;
    background: var(--surface);
    box-shadow:
      0 1px 2px var(--shadow-soft),
      0 14px 36px var(--shadow-depth);
    transform: translateX(-50%);
  }
  .picker button {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 9px 10px;
    border: 0;
    border-radius: 10px;
    font: 500 var(--type-body) / 1.3 var(--font);
    text-align: left;
    color: var(--text);
    background: none;
    cursor: pointer;
  }
  .picker button:hover {
    background: var(--surface-2);
  }
  .picker :global(svg) {
    flex: none;
    color: var(--text-2);
  }
  /* The whole connector is the drop target, not only its line. */
  .drop {
    position: absolute;
    inset: -8px -120px;
    z-index: 1;
  }
  .slot {
    display: flex;
    flex-direction: column;
    align-items: center;
    width: 100%;
    cursor: grab;
  }
  .inline-editor {
    width: 640px;
    max-width: 100%;
    margin-top: 8px;
  }
  .banner {
    width: 100%;
    max-width: 640px;
    margin: 0 0 16px;
    padding: 12px 16px;
    border-radius: 14px;
    font-size: var(--type-body);
  }
  ul.banner {
    padding-left: 34px;
  }
  .banner.bad {
    color: var(--danger-text);
    background: var(--danger-soft);
  }
  .banner.warn {
    color: var(--danger-text);
    background: var(--danger-soft);
  }

  /* ---- the palette ---- */
  .palette {
    display: flex;
    flex: none;
    flex-direction: column;
    gap: 20px;
    width: 360px;
  }
  .side {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 22px;
  }
  .side h3 {
    margin: 0;
    font-size: 17px;
    font-weight: 600;
    letter-spacing: -0.3px;
  }
  .side p {
    margin: 0;
    font-size: var(--type-caption);
    color: var(--text-2);
  }
  .pal {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    padding: 10px 12px;
    border: 0;
    border-radius: 14px;
    font: inherit;
    text-align: left;
    color: inherit;
    background: var(--surface-2);
    cursor: grab;
  }
  .pal:hover {
    box-shadow: inset 0 0 0 2px var(--accent-soft);
  }
  .pal .ic {
    display: grid;
    flex: none;
    place-items: center;
    width: 30px;
    height: 30px;
    border-radius: 10px;
    color: var(--text-inv);
    background: linear-gradient(180deg, var(--accent-from), var(--accent-to));
  }
  .pal.checkpoint .ic {
    color: var(--on-amber);
    background: linear-gradient(180deg, var(--amber-from), var(--amber-to));
  }
  .pal.design .ic {
    background: linear-gradient(180deg, var(--pen-from), var(--pen-to));
  }
  .pal.shell .ic {
    background: linear-gradient(180deg, #b9b2a9, #6a635a);
  }
  .pal.notify .ic {
    background: linear-gradient(180deg, var(--mint-from), var(--mint-to));
  }
  .pal .tx {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .pal .n {
    font-size: var(--type-body);
    font-weight: 600;
  }
  .pal .d {
    font-size: var(--type-caption);
    color: var(--text-2);
  }
  .pal > :global(svg) {
    flex: none;
    color: var(--text-3);
  }

  .ag {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 6px 0;
    text-decoration: none;
    color: inherit;
  }
  .ag .l {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }
  .ag .nm {
    overflow: hidden;
    font-size: var(--type-body);
    font-weight: 500;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .mini {
    display: grid;
    flex: none;
    place-items: center;
    width: 24px;
    height: 24px;
    border-radius: var(--r-pill);
    color: var(--text-inv);
    background: linear-gradient(180deg, var(--accent-from), var(--accent-to));
  }
  .mini.pen {
    background: linear-gradient(180deg, var(--pen-from), var(--pen-to));
  }
  .ag .m {
    flex: none;
    font-family: var(--font-head);
    font-size: var(--type-caption);
    font-weight: 600;
    color: var(--text-2);
  }
  .ag .m.pen {
    color: var(--pen-text);
  }
  .ag:hover .nm {
    text-decoration: underline;
  }

  @media (max-width: 1100px) {
    .builder {
      flex-direction: column;
    }
    .palette {
      width: auto;
    }
  }
</style>
