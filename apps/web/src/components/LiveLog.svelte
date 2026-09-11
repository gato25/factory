<script lang="ts">
  import Icon from '$components/Icon.svelte';
  import { log } from '$lib/remote/runs.remote';
  import type { RunView } from '$lib/services/run-view';

  /**
   * `design.pen`'s Live Log: a dark panel with the step and the exact command
   * that produced the output in its head (FR-076), a LIVE pill while it is
   * streaming, and the output below with a timestamp per line.
   *
   * Lines are tinted by what they say — a tick green, a start blue, a warning
   * amber — because a log nobody can scan is a log nobody reads. The tint
   * comes from the line's own first characters; nothing here invents meaning
   * the engine did not write.
   */
  let {
    runId,
    step,
    live,
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
          ? `claude -p --output-format json --model ${step.model}`
          : '—',
  );

  interface Line {
    key: string;
    at: string;
    text: string;
    tone: '' | 'ok' | 'run' | 'warn' | 'bad';
  }

  /**
   * One line per line, carrying the time the chunk it came from was written.
   * A chunk can hold several lines, so the time repeats — it is shown only
   * when it changes, rather than stamping five lines with one clock reading.
   */
  const lines = $derived.by((): Line[] => {
    if (!chunks.ready) return [];
    const out: Line[] = [];
    let last = '';
    for (const chunk of chunks.current) {
      const at = clock(chunk.at);
      const parts = chunk.text.split('\n');
      parts.forEach((text, n) => {
        if (n === parts.length - 1 && text === '') return;
        out.push({
          key: `${chunk.seq}:${n}`,
          at: at === last ? '' : at,
          text,
          tone: chunk.stream === 'stderr' ? 'bad' : toneOf(text),
        });
        last = at;
      });
    }
    return out;
  });

  function clock(at: Date | string): string {
    const when = typeof at === 'string' ? new Date(at) : at;
    return Number.isNaN(when.getTime())
      ? ''
      : when.toTimeString().slice(0, 8);
  }

  function toneOf(text: string): Line['tone'] {
    const body = text.trimStart();
    if (body.startsWith('✓') || body.startsWith('✔')) return 'ok';
    if (body.startsWith('▶') || body.startsWith('$')) return 'run';
    if (body.startsWith('⚠') || body.startsWith('warning')) return 'warn';
    if (body.startsWith('✗') || body.startsWith('✕') || body.startsWith('error')) return 'bad';
    return '';
  }
</script>

<section class="log">
  <header>
    <span class="l">
      <Icon name="terminal" size={16} />
      <span class="t">{step.label} · {live ? 'live output' : 'output'}</span>
      {#if live}
        <span class="live"><span class="d"></span>LIVE</span>
      {/if}
    </span>
    <code>{command}</code>
  </header>

  <div class="body">
    {#if chunks.error}
      <p role="alert">Could not load the output.</p>
    {:else if !chunks.ready}
      <p>Loading output…</p>
    {:else if lines.length === 0}
      <p>
        {step.state === 'pending'
          ? 'This step has not started.'
          : step.state === 'skipped'
            ? `Skipped — ${step.conditionNotMet}.`
            : 'No output yet.'}
      </p>
    {:else}
      {#each lines as line (line.key)}
        <p class="line {line.tone}">
          <span class="ts">{line.at}</span><span class="m">{line.text}</span>
        </p>
      {/each}
    {/if}
  </div>
</section>

<style>
  .log {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
    min-height: 320px;
    background: var(--code-bg);
    border: 1px solid var(--code-edge);
    border-radius: var(--r-lg);
    overflow: hidden;
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 12px 16px;
    border-bottom: 1px solid var(--code-edge);
  }
  .l {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }
  .l :global(svg) {
    color: var(--text-inv-2);
    flex: none;
  }
  .t {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-inv);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .live {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 2px 8px;
    border-radius: 999px;
    background: var(--live-pill);
    color: var(--code-ok);
    font-size: 11px;
    font-weight: 600;
    flex: none;
  }
  .live .d {
    width: 6px;
    height: 6px;
    border-radius: 999px;
    background: currentcolor;
  }
  header code {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-inv-2);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: none;
    max-width: 45%;
  }

  .body {
    flex: 1;
    min-height: 0;
    max-height: 460px;
    overflow: auto;
    padding: 16px;
    font-family: var(--font-mono);
    font-size: 12px;
    line-height: 1.6;
  }
  .body p {
    margin: 0;
    color: var(--text-inv-2);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .line {
    display: flex;
    gap: 12px;
  }
  .ts {
    width: 8ch;
    flex: none;
    color: var(--code-line);
    user-select: none;
  }
  .m {
    flex: 1;
    min-width: 0;
  }
  .line.ok {
    color: var(--code-ok);
  }
  .line.run {
    color: var(--code-run);
  }
  .line.warn {
    color: var(--amber);
  }
  .line.bad {
    color: var(--danger);
  }
</style>
