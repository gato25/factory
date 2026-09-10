<script lang="ts">
  import type { Step } from '@factory/shared';
  import StepEditor from '$components/StepEditor.svelte';
  import StepNode from '$components/StepNode.svelte';
  import {
    IMPLICIT_LAST_STEP,
    STEP_KIND_LABEL,
    STEP_KINDS,
    blankStep
  } from '$lib/services/pipeline';

  /**
   * The vertical flow, the step palette, and a + on each connector so a step
   * can be inserted between any two (FR-026). Dragging reorders; the arrows
   * do the same thing for anyone not using a mouse.
   *
   * Every edit here is to a DRAFT. A pipeline gains a version when someone
   * saves, not when they drag a step (FR-027).
   */
  let {
    steps = $bindable(),
    agents = [],
    members = [],
    problems = [],
    editable = true
  }: {
    steps: Step[];
    agents: { id: string; name: string; engine: string; model: string }[];
    members: { id: string; name: string }[];
    problems: { index: number | null; message: string }[];
    editable?: boolean;
  } = $props();

  let selected = $state<number | null>(null);
  let dragging = $state<number | null>(null);
  let dropAt = $state<number | null>(null);

  const overall = $derived(problems.filter((p) => p.index === null));

  /**
   * FR-034a and SC-016 — a pipeline with no verification step is a pipeline
   * where nothing beyond the implementing agent checks the result. That is a
   * legitimate choice, so it is a warning rather than a refusal — but it is
   * made plain here, where the choice is being made, as well as before a
   * ticket is started.
   */
  const verifies = $derived(
    steps.some((step) => step.type === 'shell' && Boolean(step.command?.trim()))
  );
  const problemsFor = (index: number) =>
    problems.filter((p) => p.index === index).map((p) => p.message);
  const agentName = (id?: string) => agents.find((a) => a.id === id)?.name;

  function move(from: number, to: number) {
    const next = [...steps];
    const [step] = next.splice(from, 1);
    if (!step) return;
    next.splice(Math.max(0, Math.min(next.length, to)), 0, step);
    steps = next;
    selected = next.indexOf(step);
  }

  function insert(at: number, kind: (typeof STEP_KINDS)[number], from?: EventTarget | null) {
    const next = [...steps];
    next.splice(at, 0, blankStep(kind));
    steps = next;
    selected = at;
    // The palette closes behind the step it added; leaving it open puts a
    // second copy of every button on the page.
    (from as HTMLElement | null)?.closest('details')?.removeAttribute('open');
  }

  function remove(at: number) {
    steps = steps.filter((_, index) => index !== at);
    selected = null;
  }

  function change(at: number, step: Step) {
    steps = steps.map((existing, index) => (index === at ? step : existing));
  }

  function onDrop(at: number) {
    if (dragging !== null) move(dragging, dragging < at ? at - 1 : at);
    dragging = null;
    dropAt = null;
  }
</script>

<div class="builder">
  <div class="flow">
    {#if overall.length > 0}
      <ul class="errors card" role="alert">
        {#each overall as problem (problem.message)}
          <li>{problem.message}</li>
        {/each}
      </ul>
    {/if}

    {#if steps.length > 0 && !verifies}
      <p class="card warning">
        Nothing in this pipeline checks the result. The implementing agent is asked to leave the
        tests passing, and nothing after it confirms that. Add a shell step running your tests to
        change that.
      </p>
    {/if}

    <ol>
      {#each steps as step, index (index)}
        {#if editable}
          <!-- A + on every connector, including before the first step -->
          <li class="connector" class:over={dropAt === index}>
            <span class="line"></span>
            <details>
              <summary aria-label="Insert a step at position {index + 1}">+</summary>
              <div class="palette">
                {#each STEP_KINDS as kind (kind)}
                  <button type="button" onclick={(e) => insert(index, kind, e.currentTarget)}>
                    {STEP_KIND_LABEL[kind]}
                  </button>
                {/each}
              </div>
            </details>
            <span
              class="drop"
              role="presentation"
              ondragover={(e) => {
                e.preventDefault();
                dropAt = index;
              }}
              ondragleave={() => (dropAt = dropAt === index ? null : dropAt)}
              ondrop={() => onDrop(index)}
            ></span>
          </li>
        {/if}
        <div
          class="draggable"
          draggable={editable}
          role="presentation"
          ondragstart={() => (dragging = index)}
          ondragend={() => {
            dragging = null;
            dropAt = null;
          }}
        >
          <StepNode
            {step}
            {index}
            total={steps.length}
            {editable}
            selected={selected === index}
            problems={problemsFor(index)}
            agentName={agentName(step.agent_id)}
            onSelect={() => (selected = selected === index ? null : index)}
            onRemove={() => remove(index)}
            onMoveUp={() => move(index, index - 1)}
            onMoveDown={() => move(index, index + 2)}
          />
        </div>
      {/each}

      {#if editable}
        <li class="connector" class:over={dropAt === steps.length}>
          <span class="line"></span>
          <details>
            <summary aria-label="Add a step at the end">+</summary>
            <div class="palette">
              {#each STEP_KINDS as kind (kind)}
                <button type="button" onclick={(e) => insert(steps.length, kind, e.currentTarget)}>
                  {STEP_KIND_LABEL[kind]}
                </button>
              {/each}
            </div>
          </details>
          <span
            class="drop"
            role="presentation"
            ondragover={(e) => {
              e.preventDefault();
              dropAt = steps.length;
            }}
            ondragleave={() => (dropAt = dropAt === steps.length ? null : dropAt)}
            ondrop={() => onDrop(steps.length)}
          ></span>
        </li>
      {/if}

      <!-- Implicit and always last: not a step anyone can move (FR-029) -->
      <li class="implicit">
        <span class="lock" aria-hidden="true">🔒</span>
        <span>
          <strong>{IMPLICIT_LAST_STEP.label}</strong>
          <span class="muted small">{IMPLICIT_LAST_STEP.why}</span>
        </span>
      </li>
    </ol>
  </div>

  <div class="side">
    {#if selected !== null && steps[selected]}
      <StepEditor
        step={steps[selected]}
        index={selected}
        {agents}
        {members}
        onChange={(step) => change(selected as number, step)}
      />
    {:else}
      <section class="card">
        <h2 class="section">Steps</h2>
        <p class="muted small">
          Choose a step to change what it does, or use a + to add one between two others.
        </p>
        {#if editable}
          <div class="palette standing">
            {#each STEP_KINDS as kind (kind)}
              <button type="button" onclick={(e) => insert(steps.length, kind, e.currentTarget)}>
                {STEP_KIND_LABEL[kind]}
              </button>
            {/each}
          </div>
        {/if}
      </section>
    {/if}
  </div>
</div>

<style>
  .builder {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 340px;
    gap: 16px;
    align-items: start;
  }
  ol {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
  }
  .draggable { cursor: grab; }
  .connector {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    height: 26px;
  }
  .connector .line {
    position: absolute;
    inset: 0 auto;
    left: 22px;
    width: 1px;
    background: var(--line);
  }
  .connector.over .line { background: var(--accent); width: 3px; }
  .connector .drop {
    position: absolute;
    inset: -6px 0;
  }
  details { position: relative; z-index: 1; }
  summary {
    list-style: none;
    width: 22px;
    height: 22px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--line);
    border-radius: 999px;
    background: var(--surface);
    color: var(--ink-3);
    cursor: pointer;
    font-size: 14px;
    line-height: 1;
  }
  summary::-webkit-details-marker { display: none; }
  details[open] summary { border-color: var(--accent); color: var(--accent); }
  .palette {
    position: absolute;
    top: 26px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 2;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 6px;
    border: 1px solid var(--line);
    border-radius: var(--r-sm);
    background: var(--surface);
    box-shadow: 0 6px 20px rgba(16, 18, 24, 0.12);
    min-width: 150px;
  }
  .palette.standing {
    position: static;
    transform: none;
    box-shadow: none;
    border: 0;
    padding: 8px 0 0;
  }
  .palette button {
    padding: 7px 10px;
    border: 0;
    border-radius: var(--r-sm);
    background: none;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .palette button:hover { background: var(--line-2); }
  .palette.standing button { border: 1px solid var(--line); }
  .implicit {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    margin-top: 8px;
    padding: 10px 12px;
    border: 1px dashed var(--line);
    border-radius: var(--r-sm);
    color: var(--ink-3);
  }
  .implicit span:last-child { display: flex; flex-direction: column; }
  .warning {
    margin: 0 0 12px;
    padding: 12px 16px;
    border-left: 3px solid var(--warn);
    color: #8a6100;
  }
  .errors {
    margin: 0 0 12px;
    padding: 12px 16px 12px 34px;
    border-left: 3px solid var(--bad);
    color: var(--bad);
  }
  @media (max-width: 1000px) {
    .builder { grid-template-columns: 1fr; }
  }
</style>
