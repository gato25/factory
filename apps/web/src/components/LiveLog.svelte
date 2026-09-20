<script lang="ts">
  import Icon from '$components/Icon.svelte';
  import { log } from '$lib/remote/runs.remote';
  import type { RunView } from '$lib/services/run-view';

  /**
   * `design.pen`'s Live Output: the step and the exact command that produced
   * it in the head (FR-076), a LIVE pill while it streams, and the lines
   * below.
   *
   * Lines are tinted by what they say — a tick green, a start blue, a
   * warning amber — because a log nobody can scan is a log nobody reads. The
   * tint comes from the line's own first characters; nothing here invents
   * meaning the engine did not write.
   *
   * On a light ground rather than the dark one this used to draw, which is
   * not only taste: `bad` had no token of its own and fell back to
   * `--danger`, a red picked for white. On `--code-bg` that measured 3.89:1
   * — under AA, and the one tone carrying errors and the whole of stderr.
   * Every tone clears AA here.
   *
   * A timestamp repeats only when it CHANGES, and sits at the end of its
   * line rather than in a gutter down the left: a log is read left to right,
   * and a column of identical clock readings is the noisiest thing on it.
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
          ? `claude -p --output-format stream-json --model ${step.model}`
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

  /** One glyph per tone, so a line's kind reads before its text does. */
  const GLYPH: Record<Line['tone'], string> = {
    '': '\u{1F4AC}',
    ok: '\u2705',
    run: '\u{1F527}',
    warn: '\u26A0\uFE0F',
    bad: '\u274C',
  };

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
          <span class="g" aria-hidden="true">{GLYPH[line.tone]}</span><span class="m"
            >{line.text}</span
          ><span class="ts">{line.at}</span>
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
    /* Its own height, not the column's: a short log beside a tall column
       was a screen of empty dark. It stays in view while the column
       scrolls, and its body scrolls within the window's height. */
    align-self: flex-start;
    position: sticky;
    top: 16px;
    max-height: calc(100vh - 32px);
    background: var(--surface);
    border: 1px solid var(--card-border);
    border-radius: var(--r-lg);
    box-shadow: 0 1px 2px #0f172a0a;
    overflow: hidden;
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 12px 16px;
    border-bottom: 1px solid var(--border);
    background: var(--surface-2);
  }
  .l {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }
  .l :global(svg) {
    color: var(--accent);
    flex: none;
  }
  .t {
    font-size: 13px;
    font-weight: 600;
    color: var(--text);
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
    background: var(--success-soft);
    color: var(--success);
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
    color: var(--text-3);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: none;
    max-width: 45%;
  }

  .body {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 10px;
  }
  .body p {
    margin: 0;
    color: var(--text-2);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  /* The empty and loading words are prose, not output. */
  .body > p:not(.line) {
    padding: 8px 6px;
    font-size: 12.5px;
    color: var(--text-3);
  }

  .line {
    display: flex;
    align-items: baseline;
    gap: 9px;
    padding: 3px 9px;
    border-radius: var(--r-sm);
    font-family: var(--font-mono);
    font-size: 11.5px;
    line-height: 1.55;
  }
  .g {
    flex: none;
  }
  .m {
    flex: 1;
    min-width: 0;
  }
  /* At the end of the line and quiet, not a gutter down the left. */
  .ts {
    flex: none;
    font-size: 10px;
    color: var(--text-3);
    opacity: 0.7;
    user-select: none;
  }

  /* An agent's own words are prose and read as prose; a tool call is a
     command and stays monospace. */
  .line:not(.ok):not(.run):not(.warn):not(.bad) .m {
    font-family: var(--font);
    font-size: 12.5px;
    color: var(--text-2);
  }
  .line.run .m {
    color: var(--accent-text);
  }
  .line.ok {
    background: var(--success-soft);
  }
  .line.ok .m {
    color: var(--success);
    font-weight: 600;
  }
  .line.warn {
    background: var(--warning-soft);
  }
  .line.warn .m {
    color: var(--warning);
    font-weight: 600;
  }
  .line.bad {
    background: var(--danger-soft);
  }
  .line.bad .m {
    color: var(--danger);
    font-weight: 600;
  }
</style>
