<script lang="ts">
  import type { Step } from '@factory/shared';
  import Icon from '$components/Icon.svelte';
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
      <p class="banner warn">
        Nothing in this pipeline checks the result. The implementing agent is asked to leave the
        tests passing, and nothing after it confirms that. Add a shell step running your tests to
        change that.
      </p>
    {/if}

    <!-- What starts a run. Not a step: it is the pipeline's entry (plan.md). -->
    <p class="trigger">
      <Icon name="zap" size={16} />
      <span>Trigger: ticket created (webhook → n8n)</span>
    </p>

    <ol>
      {#each steps as step, index (index)}
        {@render connector(index, `Insert a step at position ${index + 1}`)}
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

      {@render connector(steps.length, 'Add a step at the end')}

      <!-- Implicit and always last: not a step anyone can move (FR-029) -->
      <li class="finish" title={IMPLICIT_LAST_STEP.why}>
        <Icon name="git-pull-request" size={16} />
        <span>{IMPLICIT_LAST_STEP.label} → close ticket</span>
      </li>
      <li class="why">{IMPLICIT_LAST_STEP.why}</li>
    </ol>
  </div>

  <aside class="palette">
    {#if editable}
      <section class="card">
        <h3>Add a step</h3>
        <p>Drag onto the canvas or click a + on a connector.</p>
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

    <section class="card">
      <h3>Your agents</h3>
      {#if agents.length === 0}
        <p>None yet.</p>
      {:else}
        {#each agents as agent (agent.id)}
          <a class="ag" href="/agents/{agent.id}">
            <span class="l">
              <Icon name={agent.icon ?? 'bot'} size={14} />
              <span>{agent.name}</span>
            </span>
            <span class="m">{agent.model}</span>
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
    gap: 24px;
  }

  /* ---- the canvas ---- */
  .canvas {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0;
    flex: 1;
    min-width: 0;
    padding: 16px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--r-lg);
  }
  .canvas ol {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    width: 100%;
  }
  .canvas ol.one {
    width: auto;
  }

  .trigger,
  .finish {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    margin: 0;
    padding: 10px 16px;
    border-radius: 999px;
    font-size: 13px;
    font-weight: 600;
  }
  .trigger {
    background: var(--text);
    color: var(--text-inv);
  }
  .trigger :global(svg) {
    color: var(--trigger-mark);
  }
  .finish {
    background: var(--success-soft);
    border: 1px solid var(--success);
    color: var(--success);
  }
  .why {
    margin-top: 6px;
    font-size: 11px;
    color: var(--text-3);
  }

  /* ---- connectors ---- */
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
    height: 12px;
  }
  .v2 {
    height: 14px;
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
    width: 22px;
    height: 22px;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--surface);
    color: var(--text-2);
    cursor: pointer;
  }
  .plus > button:hover,
  .plus > button[aria-expanded='true'] {
    border-color: var(--accent);
    color: var(--accent);
  }
  .picker {
    position: absolute;
    top: 26px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 6;
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
  .picker button {
    display: flex;
    align-items: center;
    gap: 8px;
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
  .picker button:hover {
    background: var(--surface-2);
  }
  .picker :global(svg) {
    color: var(--text-2);
    flex: none;
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
    width: 560px;
    max-width: 100%;
    margin-top: 8px;
  }

  .banner {
    width: 100%;
    max-width: 560px;
    margin: 0 0 12px;
    padding: 12px 16px;
    border-radius: var(--r-md);
    font-size: 13px;
  }
  ul.banner {
    padding-left: 34px;
  }
  .banner.bad {
    background: var(--danger-soft);
    color: var(--danger);
  }
  .banner.warn {
    background: var(--warning-soft);
    color: var(--warning);
  }

  /* ---- the palette ---- */
  .palette {
    display: flex;
    flex-direction: column;
    gap: 16px;
    width: 320px;
    flex: none;
  }
  .card {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 16px;
    background: var(--surface);
    border: 1px solid var(--card-border);
    border-radius: var(--r-lg);
    box-shadow: 0 1px 2px #0f172a0a;
  }
  .card h3 {
    margin: 0;
    font-family: var(--font-head);
    font-size: 14px;
    font-weight: 600;
    color: var(--text);
  }
  .card p {
    margin: 0;
    font-size: 12px;
    color: var(--text-2);
  }

  .pal {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: var(--surface);
    font: inherit;
    text-align: left;
    cursor: grab;
  }
  .pal:hover {
    border-color: var(--accent);
  }
  .pal .ic {
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    border-radius: 6px;
    flex: none;
    background: var(--surface-2);
    color: var(--text-2);
  }
  .pal .tx {
    display: flex;
    flex-direction: column;
    gap: 1px;
    flex: 1;
    min-width: 0;
  }
  .pal .n {
    font-size: 13px;
    font-weight: 600;
    color: var(--text);
  }
  .pal .d {
    font-size: 11px;
    color: var(--text-3);
  }
  .pal > :global(svg) {
    color: var(--flow-line);
    flex: none;
  }

  /* Each kind wears its own colour here too, so the palette and the canvas
     agree about what a thing is. */
  .pal.checkpoint .ic {
    background: var(--warning-soft);
    color: var(--warning);
  }
  .pal.design {
    background: var(--design-soft);
    border-color: var(--design);
  }
  .pal.design .ic {
    background: var(--surface);
    color: var(--design);
  }
  .pal.design .d {
    color: var(--text-2);
  }
  .pal.agent .ic {
    background: var(--accent-soft);
    color: var(--accent-text);
  }
  .pal.notify .ic {
    background: var(--purple-soft);
    color: var(--purple);
  }

  .ag {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 6px 0;
    border-top: 1px solid var(--border);
    text-decoration: none;
  }
  .ag:first-of-type {
    border-top: 0;
  }
  .ag .l {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    font-size: 13px;
    color: var(--text);
  }
  .ag .l span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ag .l :global(svg) {
    color: var(--text-2);
    flex: none;
  }
  .ag .m {
    font-size: 11px;
    color: var(--text-3);
    flex: none;
  }
  .ag:hover .l {
    color: var(--accent-text);
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
