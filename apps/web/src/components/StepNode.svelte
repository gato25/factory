<script lang="ts">
  import type { Step } from '@factory/shared';
  import { CONDITION_DESCRIPTION } from '@factory/shared';
  import { STEP_KIND_LABEL } from '$lib/services/pipeline';

  /**
   * One step in the vertical flow. A conditional step is marked as
   * conditional and its condition is stated in words, never as a code
   * (FR-032f) — the same words the pre-flight preview and the run view use.
   */
  let {
    step,
    index,
    total,
    selected = false,
    problems = [],
    agentName,
    onSelect,
    onRemove,
    onMoveUp,
    onMoveDown,
    editable = true
  }: {
    step: Step;
    index: number;
    total: number;
    selected?: boolean;
    /** Every problem this step has: one can breach two rules at once. */
    problems?: string[];
    agentName?: string;
    onSelect?: () => void;
    onRemove?: () => void;
    onMoveUp?: () => void;
    onMoveDown?: () => void;
    editable?: boolean;
  } = $props();

  const condition = $derived(CONDITION_DESCRIPTION[step.condition]);
  const detail = $derived(describe(step, agentName));

  function describe(s: Step, agent?: string): string | undefined {
    switch (s.type) {
      case 'agent':
        return s.output_files?.length
          ? `${agent ?? 'no agent chosen'} — produces ${s.output_files.join(', ')}`
          : `${agent ?? 'no agent chosen'} — writes the code`;
      case 'design':
        return `${agent ?? 'no agent chosen'} — ${s.design?.source_path ?? 'docs/design/ui.pen'}`;
      case 'checkpoint':
        return [
          s.approvers === 'anyone'
            ? 'anyone in the workspace decides'
            : s.approvers === 'ticket_creator'
              ? "the ticket's author decides"
              : `${(s.approvers ?? []).length} named approver(s)`,
          s.timeout_hours
            ? `waits ${s.timeout_hours}h, then ${s.on_timeout ?? 'wait'}s`
            : 'waits indefinitely'
        ].join(' · ');
      case 'shell':
        return s.command || 'no command yet';
      case 'notify':
        return s.channel || 'no channel yet';
    }
  }
</script>

<li class:selected class:invalid={problems.length > 0}>
  <button type="button" class="body" onclick={onSelect} disabled={!onSelect}>
    <span class="row">
      <span class="n">{index + 1}</span>
      <span class="kind">{STEP_KIND_LABEL[step.type]}</span>
      {#if condition}
        <!-- Marked as conditional, in words (FR-032f) -->
        <span class="badge small conditional">{condition}</span>
      {/if}
    </span>
    {#if detail}<span class="detail muted small">{detail}</span>{/if}
    {#each problems as problem (problem)}
      <span class="problem small">{problem}</span>
    {/each}
  </button>

  {#if editable}
    <span class="controls">
      <button
        type="button"
        onclick={onMoveUp}
        disabled={index === 0}
        aria-label="Move step {index + 1} up">↑</button
      >
      <button
        type="button"
        onclick={onMoveDown}
        disabled={index === total - 1}
        aria-label="Move step {index + 1} down">↓</button
      >
      <button
        type="button"
        class="danger"
        onclick={onRemove}
        aria-label="Remove step {index + 1}">✕</button
      >
    </span>
  {/if}
</li>

<style>
  li {
    display: flex;
    align-items: stretch;
    gap: 8px;
    border: 1px solid var(--line);
    border-radius: var(--r-sm);
    background: var(--surface);
    padding: 4px 8px 4px 4px;
  }
  li.selected {
    border-color: var(--accent);
    box-shadow: inset 3px 0 0 var(--accent);
  }
  li.invalid {
    border-color: #f3c7c4;
    box-shadow: inset 3px 0 0 var(--bad);
  }
  .body {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
    align-items: flex-start;
    padding: 8px;
    border: 0;
    background: none;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .body:disabled { cursor: default; }
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .n {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    border-radius: 999px;
    background: var(--line-2);
    font-size: 11px;
    color: var(--ink-2);
  }
  .kind { font-weight: 600; }
  .conditional { background: #fff5e0; color: #8a6100; }
  .detail {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 100%;
  }
  /* A problem is read, not scanned: it wraps rather than truncating. */
  .problem {
    color: var(--bad);
    max-width: 100%;
    white-space: normal;
  }
  .controls {
    display: flex;
    align-items: center;
    gap: 2px;
  }
  .controls button {
    border: 0;
    background: none;
    font: inherit;
    color: var(--ink-3);
    cursor: pointer;
    padding: 4px 6px;
    border-radius: var(--r-sm);
  }
  .controls button:hover:not(:disabled) { background: var(--line-2); color: var(--ink); }
  .controls button:disabled { opacity: 0.3; cursor: default; }
  .controls button.danger:hover { color: var(--bad); }
</style>
