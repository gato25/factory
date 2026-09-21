<script lang="ts">
  import Icon from '$components/Icon.svelte';
  import Markdown from '$components/Markdown.svelte';
  import { m } from '$lib/i18n';
  import { toRows } from '$lib/log-lines';
  import { log } from '$lib/remote/runs.remote';
  import type { RunView } from '$lib/services/run-view';
  import { glyphFor, spent, toneFor } from '$lib/step-kind';

  /**
   * `design.pen`'s Live Output panel, artboard 15, node `lRG8t`.
   *
   * The head is the artboard's: a 32px tone-soft badge carrying the step's
   * glyph, the step's name over the exact command that produced the output
   * (FR-076), and on the right what the step has spent so far with a LIVE
   * pill while it streams. It used to be a terminal icon, a line of running
   * text and the command pushed to the far right, which is a different
   * component wearing the same name.
   *
   * A line is drawn by what it IS, and the artboard gives each of its five
   * kinds a different shape rather than only a different colour:
   *
   *   - a tool call is a chip naming the tool, then what it was called
   *     with, because scanning a run means scanning the verbs;
   *   - the command that opened the step carries ⚡ and the step's colour;
   *   - the agent's own words carry no marker at all and are set in the
   *     body face, indented — they are prose and read as prose;
   *   - a success, a warning and an error sit on a tinted ground with an
   *     emoji, because those are the three lines somebody scanning a failed
   *     run is looking for.
   *
   * To those `log-lines.ts` adds two the artboard never had to show, because
   * its three example panels were tidy and real output is not: the tool's own
   * setup chatter, and the banners it draws for a terminal. Both are quiet
   * and both fold. What folds is never dropped — a log is evidence.
   *
   * **The head is white and the body is a console.** The body has its own
   * palette, `--log-*`, picked FOR a dark ground rather than borrowed from
   * the light one. That borrowing is what went wrong the last time this
   * panel was dark: `bad` fell back to `--danger`, a red chosen for white,
   * and measured 3.89:1 against the ground carrying every error and the
   * whole of stderr. A pale tint was tried in between and was worse than
   * either — `--text-3` fell to about 2.3:1 on it, and the soft green and
   * amber rows sat so near the ground's own lightness that they stopped
   * reading as rows. Every tone here clears AA with room: the text at
   * about 15:1, the muted grey at 7:1, and none of the three states below
   * 6:1 on their own row.
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

  const tone = $derived(toneFor(step.type));
  const meta = $derived(spent(step));

  const rows = $derived(chunks.ready ? toRows(chunks.current) : []);

  /**
   * The log follows the tail, until you tell it not to.
   *
   * Without this the panel simply appended: every line a running step
   * produced landed below the fold, and reading a live run meant dragging
   * the scrollbar every few seconds. With only auto-scroll, reading
   * anything OLDER is impossible, because the next chunk yanks you back.
   *
   * So the rule is the one every console uses. While the view is at the
   * bottom it stays pinned there. The moment you scroll up it stops
   * following and counts what has arrived since, and the pill offers to
   * take you back. Returning to the bottom resumes following, so there is
   * no mode to get stuck in.
   */
  let body = $state<HTMLElement | null>(null);
  let following = $state(true);
  let behind = $state(0);
  /** How many rows had arrived last time this looked, to count the new ones. */
  let seen = 0;

  /** Within a couple of pixels of the end counts as at the end. */
  function atBottom(el: HTMLElement): boolean {
    return el.scrollHeight - el.scrollTop - el.clientHeight < 4;
  }

  function onScroll() {
    if (!body) return;
    following = atBottom(body);
    if (following) behind = 0;
  }

  function toBottom() {
    if (!body) return;
    body.scrollTop = body.scrollHeight;
    following = true;
    behind = 0;
  }

  // Picking a different step is a different log: follow it from the bottom
  // rather than inheriting where the last one was left.
  $effect(() => {
    void step.index;
    following = true;
    behind = 0;
    seen = 0;
  });

  /**
   * Runs after the rows are in the DOM, because the height it scrolls to is
   * the height they gave it. `behind` accumulates while the reader is away,
   * rather than counting only the most recent chunk.
   */
  $effect(() => {
    const count = rows.length;
    if (!body) return;
    if (following) body.scrollTop = body.scrollHeight;
    else if (count > seen) behind += count - seen;
    seen = count;
  });

  /** The emoji each kind carries. A tool call and prose carry none. */
  const EMOJI: Record<string, string> = {
    start: '⚡',
    ok: '✅',
    warn: '⚠️',
    bad: '❌',
  };

  /** "3 more lines", for a disclosure that has not been opened. */
  function more(n: number): string {
    return `${n} more line${n === 1 ? '' : 's'}`;
  }

  /**
   * The four empty states the artboard draws, each with its own glyph and
   * its own sentence. They were four lines of grey prose in the top-left
   * corner of an otherwise empty panel.
   */
  const empty = $derived.by(() => {
    if (chunks.error) return { glyph: '⚠️', text: m.liveLog.couldNotLoad };
    if (!chunks.ready) {
      // The one state the artboard does not draw: it has no loading to show.
      return { glyph: '⏳', text: m.liveLog.loadingOutput };
    }
    if (step.state === 'pending') return { glyph: '\u{1F552}', text: m.liveLog.stepNotStarted };
    if (step.state === 'skipped') {
      return { glyph: '⏭️', text: m.liveLog.skipped(step.conditionNotMet ?? '') };
    }
    return { glyph: '\u{1F4ED}', text: m.liveLog.noOutput };
  });
</script>

<section class="log {tone}" aria-label={m.liveLog.liveOutput(step.label)}>
  <header>
    <span class="badge" aria-hidden="true">{glyphFor(step.type)}</span>
    <span class="titles">
      <span class="t">{step.label}</span>
      <code>{command}</code>
    </span>
    <span class="right">
      {#if meta}<span class="meta">{meta}</span>{/if}
      {#if live}
        <span class="live"><span class="d"></span>{m.liveLog.live}</span>
      {/if}
    </span>
  </header>

  <div class="body" class:blank={rows.length === 0} bind:this={body} onscroll={onScroll}>
    {#if rows.length === 0}
      <p class="empty" role={chunks.error ? 'alert' : undefined}>
        <span class="e" aria-hidden="true">{empty.glyph}</span>
        <span class="msg">{empty.text}</span>
      </p>
    {:else}
      {#each rows as row (row.key)}
        <div class="row {row.kind}">
          {#if row.kind === 'tool'}
            <span class="dot" aria-hidden="true"></span>
            <span class="chip">{row.tool}</span>
            {#if row.text}<span class="m">{row.text}</span>{:else}<span class="m"></span>{/if}
            {#if row.count}<span class="times">&times;{row.count}</span>{/if}
          {:else if row.kind === 'prose'}
            <!--
              The agent writes Markdown, so it is rendered as Markdown. Only
              here: a tool call, a path and an error are literal output, and
              running those through a parser would eat the asterisks out of a
              glob and the underscores out of a filename.
            -->
            <span class="m"><Markdown source={row.text} /></span>
          {:else}
            {#if EMOJI[row.kind]}<span class="g" aria-hidden="true">{EMOJI[row.kind]}</span>{/if}
            <span class="m">{row.text}</span>
          {/if}
          <span class="ts">{row.at}</span>
        </div>
        {#if row.detail}
          <!-- Folded, never dropped: a log is evidence, and the lines a
               reader did not ask for still have to be reachable. -->
          <details class="fold {row.kind}">
            <summary>{more(row.detail.length)}</summary>
            <pre>{row.detail.join('\n')}</pre>
          </details>
        {/if}
      {/each}
      {#if live}
        <!-- The artboard's running panel ends on a caret, so a step that is
             thinking does not look like a step that has stopped. -->
        <div class="row caret" aria-hidden="true">
          <span class="g">&#x2328;&#xFE0F;</span><span class="m">&#x258D;</span>
        </div>
      {/if}
    {/if}
  </div>

  <!--
    Only while there is something to go back to. Pinned over the foot of the
    panel rather than placed after the rows, so it does not scroll away with
    them.
  -->
  {#if !following && rows.length > 0}
    <button type="button" class="jump" onclick={toBottom}>
      <Icon name="chevron-down" size={13} />
      {behind > 0 ? m.liveLog.newLines(behind) : m.liveLog.jumpToLatest}
    </button>
  {/if}
</section>

<style>
  /*
   * The artboard's panel: white, 20px, and a soft drop shadow instead of a
   * hairline. #0B122014 is the shadow design.pen draws on every card of
   * this class — `--text` at 8%.
   */
  .log {
    position: relative;
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
    min-height: 0;
    /*
     * It fills whatever height the page gives it, and nothing here reaches
     * for the viewport.
     *
     * This used to be `position: sticky` with `max-height: calc(100vh -
     * 32px)`, which was wrong twice over. The panel began a third of the
     * way down a scrolling page, so a height measured against the whole
     * window was always taller than the room left for it — guaranteeing the
     * page scrolled as well as the log. Two nested scrollbars meant the
     * wheel did different things depending on where the pointer sat. The
     * run view is now a fixed-height shell, so this panel is simply told
     * its height and its body is the only thing on the page that scrolls.
     */
    height: 100%;
    background: var(--surface);
    border-radius: var(--r-xl);
    box-shadow: 0 2px 10px #0b122014;
    overflow: hidden;
  }

  /* The step's colour. The artboard tints the badge, the tool-call dots and
     the opening line with it. */
  /*
   * Two tones per step kind, because the panel has two grounds. `--step`
   * and `--step-soft` are for the white head; `--body-tone` is the same
   * idea re-picked for the dark body, where the head's blue would sit at
   * about 2:1 and disappear.
   */
  .log.run {
    --step: var(--success);
    --step-soft: var(--success-soft);
    --body-tone: var(--log-ok);
  }
  .log.design {
    --step: var(--design);
    --step-soft: var(--design-soft);
    --body-tone: var(--log-design);
  }

  /* No rule and no second ground under the head: the artboard draws one
     white panel, and the padding does the separating. */
  header {
    display: flex;
    align-items: center;
    gap: 11px;
    padding: 16px 18px 13px;
  }
  .badge {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    flex: none;
    border-radius: 11px;
    background: var(--step-soft);
    font-size: 15px;
    line-height: 1;
  }
  .titles {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1;
    min-width: 0;
  }
  .t {
    font-family: var(--font-head);
    font-size: 14px;
    font-weight: 700;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* Under the name, not opposite it: the command belongs to the step, and
     across the panel it read as a second, unrelated column. */
  header code {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-3);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .right {
    display: flex;
    align-items: center;
    gap: 9px;
    flex: none;
  }
  .meta {
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--text-3);
  }
  .live {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 3px 9px;
    border-radius: 999px;
    background: var(--success-soft);
    color: var(--success);
    font-size: 10px;
    font-weight: 700;
  }
  .live .d {
    width: 6px;
    height: 6px;
    border-radius: 999px;
    background: currentcolor;
  }

  /* The console. The head above it stays white; this is the one dark
     surface on the page, and every tone below is picked for it. */
  .body {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 8px 18px 16px;
    background: var(--log-bg);
    color: var(--log-text);
  }
  /* An empty panel is 104px of centred nothing in the artboard, not a
     paragraph pinned to the top-left corner. */
  .body.blank {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 104px;
  }
  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    margin: 0;
    text-align: center;
  }
  .empty .e {
    font-size: 22px;
    line-height: 1;
    opacity: 0.85;
  }
  .empty .msg {
    font-size: 11px;
    line-height: 1.45;
    color: var(--log-muted);
  }

  .row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 3px 0;
    border-radius: 10px;
    font-family: var(--font-mono);
    font-size: 11px;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .dot,
  .g,
  .chip,
  .times {
    flex: none;
  }
  .dot {
    width: 5px;
    height: 5px;
    border-radius: 999px;
    background: var(--body-tone);
  }
  .g {
    font-family: var(--font);
    font-size: 12px;
    line-height: 1;
  }
  .m {
    flex: 1;
    min-width: 0;
    line-height: 1.5;
    color: var(--log-muted);
  }
  /*
   * Right-aligned, so the times form a clean edge instead of a ragged one
   * that moves with the text.
   *
   * A floor rather than the artboard's fixed 46px, and never wrapping.
   * `15:23:50` does not fit in 46px at this size, so the last digit was
   * dropping onto a line of its own beside every row. The times are all the
   * same width, so the column stays straight whatever the content sets it
   * to.
   */
  .ts {
    flex: none;
    min-width: 46px;
    font-size: 10px;
    line-height: 1.5;
    text-align: right;
    white-space: nowrap;
    color: var(--log-muted);
    opacity: 0.7;
    user-select: none;
  }

  /*
   * A tool call, as a chip and its argument.
   *
   * Nine consecutive `Using tool: Read` lines said nothing about what was
   * read and buried the one sentence the agent wrote between them. The verb
   * is now a chip the eye can skip down, the argument is beside it in the
   * quiet colour, and identical calls are counted rather than repeated.
   */
  .chip {
    padding: 1px 7px;
    border-radius: 6px;
    background: var(--log-chip);
    color: var(--body-tone);
    font-size: 10.5px;
    font-weight: 600;
    letter-spacing: 0.01em;
  }
  .row.tool .m {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .times {
    padding: 1px 6px;
    border-radius: 999px;
    background: var(--log-chip);
    color: var(--log-muted);
    font-size: 10px;
    font-weight: 600;
  }

  /* The opening line, in the step's own colour. */
  .row.start .m {
    color: var(--body-tone);
  }

  /* An agent's own words are prose: body face, no marker, and indented past
     where the markers would be. Top-aligned rather than centred, because a
     Markdown block is several lines tall and its timestamp belongs beside
     the first of them. */
  .row.prose {
    align-items: flex-start;
    padding: 6px 0 6px 15px;
    /* `pre-wrap` is for literal output. Here the Markdown parser has already
       decided where the breaks are. */
    white-space: normal;
  }
  .row.prose .m {
    font-family: var(--font);
    font-size: 12.5px;
    color: var(--log-text);
  }
  /*
   * Markdown on the console.
   *
   * `Markdown.svelte` is shared with the skill preview, which is a white
   * page, so its own colours are for that. Re-toned here rather than there:
   * the component should not have to know which ground it landed on, and
   * the skill preview should not change because a log did.
   */
  .row.prose .m :global(.markdown) {
    font-size: 12.5px;
    line-height: 1.6;
    color: var(--log-text);
  }
  /* The block's outer leading and trailing space is the row padding's job. */
  .row.prose .m :global(.markdown > :last-child) {
    margin-bottom: 0;
  }
  /* A heading in a log is emphasis, not a document title. At the
     component's own sizes an agent writing `## Plan` produced 15px type in
     the middle of 12.5px output, which read as the panel breaking rather
     than as a heading. */
  .row.prose .m :global(.markdown h1),
  .row.prose .m :global(.markdown h2),
  .row.prose .m :global(.markdown h3) {
    margin: 0;
    font-family: var(--font);
    font-size: 12.5px;
    font-weight: 700;
    color: var(--log-text);
  }
  /* One line of prose is one line. The component's paragraph spacing is for
     a document, and here it put a gap under every remark the agent made. */
  .row.prose .m :global(.markdown p) {
    margin: 0;
  }
  .row.prose .m :global(.markdown ul) {
    margin: 2px 0 0;
    padding-left: 18px;
  }
  .row.prose .m :global(.markdown code) {
    background: var(--log-chip);
    color: var(--log-accent);
  }
  /* The body's own ground with an edge, rather than a darker one: a fenced
     block should read as inset, and inventing a colour the design does not
     name to get there is not worth it. */
  .row.prose .m :global(.markdown pre) {
    background: var(--log-bg);
    color: var(--log-text);
    border: 1px solid var(--log-chip);
  }
  .row.prose .m :global(.markdown th) {
    background: var(--log-chip);
    color: var(--log-text);
    border-bottom-color: var(--log-chip);
  }
  .row.prose .m :global(.markdown td) {
    color: var(--log-text);
    border-bottom-color: var(--log-chip);
  }

  /* The tool talking about itself. Present, and quiet enough to read past. */
  .row.info {
    padding: 2px 0 2px 15px;
  }
  .row.info .m,
  .row.noise .m {
    font-size: 10.5px;
    color: var(--log-muted);
    opacity: 0.85;
  }
  .row.noise {
    padding: 2px 0 2px 15px;
  }

  /* The three lines somebody scanning a run is looking for, on a ground
     that finds them. */
  .row.ok,
  .row.warn,
  .row.bad {
    margin: 2px 0;
    padding: 8px 12px;
  }
  .row.ok .m,
  .row.warn .m,
  .row.bad .m {
    font-family: var(--font);
    font-size: 11.5px;
    font-weight: 600;
  }
  .row.ok {
    background: var(--log-ok-soft);
  }
  .row.ok .m {
    color: var(--log-ok);
  }
  .row.warn {
    background: var(--log-warn-soft);
  }
  .row.warn .m {
    color: var(--log-warn);
  }
  .row.bad {
    background: var(--log-bad-soft);
  }
  .row.bad .m {
    color: var(--log-bad);
  }

  .fold {
    margin: 0 0 2px 15px;
  }
  .fold summary {
    display: inline-flex;
    align-items: center;
    padding: 1px 8px;
    border-radius: 999px;
    background: var(--log-chip);
    color: var(--log-muted);
    font-size: 10px;
    cursor: pointer;
    user-select: none;
    list-style: none;
  }
  .fold summary::-webkit-details-marker {
    display: none;
  }
  .fold summary:hover {
    color: var(--log-text);
  }
  .fold pre {
    margin: 6px 0 2px;
    padding: 10px 12px;
    border-radius: 10px;
    background: var(--log-chip);
    color: var(--log-text);
    font-family: var(--font-mono);
    font-size: 10.5px;
    line-height: 1.55;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  /* Over the foot of the panel, so it does not scroll away with the rows
     it is offering to take you past. */
  .jump {
    position: absolute;
    left: 50%;
    bottom: 16px;
    transform: translateX(-50%);
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    border: 0;
    border-radius: 999px;
    background: var(--log-text);
    color: var(--log-bg);
    font: inherit;
    font-size: 11.5px;
    font-weight: 600;
    cursor: pointer;
    box-shadow: 0 3px 10px #00000066;
  }
  .jump:hover {
    background: var(--log-accent);
  }

  .row.caret .m {
    color: var(--log-text);
    animation: blink 1.1s step-end infinite;
  }
  @keyframes blink {
    50% {
      opacity: 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .row.caret .m {
      animation: none;
    }
  }
</style>
