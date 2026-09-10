<script lang="ts">
  import { log } from '$lib/remote/runs.remote';
  import type { RunView } from '$lib/services/run-view';

  let {
    runId,
    step,
    live
  }: { runId: string; step: RunView['steps'][number]; live: boolean } = $props();

  /**
   * Read `.current`, not `{#await}`. A remote query is a promise WITH a
   * reactive current value: awaiting it renders the first resolution and then
   * ignores `refresh()`, which is exactly what the live log must not do.
   */
  const chunks = $derived(log({ runId, stepIndex: step.index }));

  // The exact command that produced the output, in the header (FR-076).
  const command = $derived(
    step.command
      ? step.command
      : step.type === 'design'
        ? `pen --out … --model ${step.model ?? ''}`
        : step.model
          ? `claude -p … --model ${step.model}`
          : '—'
  );
</script>

<section class="card">
  <header>
    <h2 class="section">Live log</h2>
    <code>{command}</code>
    {#if live}<span class="badge live">streaming</span>{/if}
  </header>

  {#if chunks.error}
    <p class="muted small" role="alert">Could not load the output.</p>
  {:else if !chunks.ready}
    <p class="muted small">Loading output…</p>
  {:else if chunks.current.length === 0}
    <p class="muted small">
      {step.state === 'pending'
        ? 'This step has not started.'
        : step.state === 'skipped'
          ? `Skipped — ${step.conditionNotMet}.`
          : 'No output yet.'}
    </p>
  {:else}
    <pre>{#each chunks.current as chunk (chunk.seq)}<span class={chunk.stream}>{chunk.text}</span>{/each}</pre>
  {/if}
</section>

<style>
  header {
    display: flex;
    align-items: baseline;
    gap: 10px;
    flex-wrap: wrap;
    margin-bottom: 10px;
  }
  header h2 {
    margin: 0;
  }
  code {
    font-size: 12px;
    color: var(--ink-3);
    background: var(--line-2);
    padding: 2px 6px;
    border-radius: 4px;
    overflow-wrap: anywhere;
  }
  pre {
    margin: 0;
    padding: 12px;
    background: #14161c;
    color: #d7dbe4;
    border-radius: var(--r-sm);
    font-size: 12px;
    line-height: 1.5;
    max-height: 420px;
    overflow: auto;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .stderr {
    color: #ff9a8f;
  }
</style>
