<script lang="ts">
  import { compactTokens } from '@factory/shared';
  import type { Snippet } from 'svelte';
  import Icon from '$components/Icon.svelte';
  import { ago, exact } from '$lib/format';
  import { m } from '$lib/i18n';
  import { duration } from '$lib/step-kind';

  /**
   * The head of a ticket screen, in the two shapes the artboards draw:
   *
   *   - `run` (artboard 06): the tile of the page's side column, stacked — the
   *     crumb, the title over its state, the branch, the pipeline and when it
   *     started, the two figures somebody watching a run looks at — how long,
   *     and how many tokens — the actions full width, and under it all the
   *     step track running down the column.
   *   - `wide` (artboards 07 and 14): the same crumb, title and state on the
   *     ground above the checkpoint's own tiles, the meta as pills, and the
   *     actions on the right.
   *
   * The state is a pill of dot and words, never colour alone (FR-006).
   */
  let {
    ticketId,
    repositoryName,
    reference,
    title,
    branchName,
    createdByName,
    startedAt = null,
    tokens,
    elapsedS = null,
    pipeline = null,
    status,
    variant = 'wide',
    stats = true,
    actions,
    children,
  }: {
    ticketId: string;
    repositoryName: string;
    reference: string;
    title: string;
    branchName: string | null;
    createdByName: string | null;
    startedAt?: Date | string | null;
    /** Everything the run's steps have processed so far; shown where the cost used to be. */
    tokens: number;
    /** Total of the steps that have run. */
    elapsedS?: number | null;
    /** "Стандарт · 6 алхам": the pipeline the run pinned, and its length. */
    pipeline?: string | null;
    status: { label: string; tone: string };
    variant?: 'wide' | 'run' | 'rail';
    /** The run variant's two figures. Left out for a ticket with no run, where both would be a dash. */
    stats?: boolean;
    actions?: Snippet;
    /** The step track, under the head (the run variant). */
    children?: Snippet;
  } = $props();

  const run = $derived(variant !== 'wide');
  /** The kit's pill tones; the older names the screens pass map onto them. */
  const TONE: Record<string, string> = {
    run: '',
    live: '',
    wait: 'pill--wait',
    warn: 'pill--wait',
    done: 'pill--done',
    ok: 'pill--done',
    fail: 'pill--fail',
    bad: 'pill--fail',
    pen: 'pill--pen',
  };
  const pill = $derived(TONE[status.tone] ?? 'pill--queue');
</script>

<header class="head" class:tile={run} class:run>
  <div class="top">
    <div class="l">
      <nav class="crumb" aria-label={m.ticketHead.where}>
        {#if !run}<a href="/tickets">{m.ticketHead.tickets}</a><Icon name="chevron-right" size={13} />{/if}
        <span>{repositoryName}</span>
        <Icon name="chevron-right" size={13} />
        <a class="id" href="/tickets/{ticketId}">{reference}</a>
      </nav>

      <div class="title-row">
        <h1>{title}</h1>
        <span class="pill {pill}" class:pill--live={status.tone === 'run' || status.tone === 'live'}>{status.label}</span>
      </div>

      <div class="meta">
        <span class="chip"><Icon name="git-branch" size={12} />{branchName ?? m.ticketHead.noBranch}</span>
        {#if run && pipeline}
          <span class="chip"><Icon name="workflow" size={12} />{pipeline}</span>
        {/if}
        {#if !run}
          <span class="chip">
            <Icon name="user" size={12} />{m.ticketHead.createdBy(createdByName ?? m.ticketCard.unknown)}
          </span>
        {/if}
        {#if startedAt}
          <span class="chip" title={exact(startedAt)}>
            <Icon name="timer" size={12} />{m.ticketHead.started(ago(startedAt))}
          </span>
        {/if}
        {#if !run}
          <span class="chip"><Icon name="coins" size={12} />{m.ticketHead.soFar(compactTokens(tokens))}</span>
        {/if}
      </div>
    </div>

    <div class="r">
      {#if run && stats}
        <!-- The two figures somebody watching a run looks at. -->
        <div class="stats">
          <div class="stat">
            <span class="v">{elapsedS ? duration(elapsedS) : '—'}</span>
            <span class="k">{m.ticketHead.elapsed}</span>
          </div>
          <div class="stat">
            <!-- A dash, not "0": a run from before tokens were recorded did not use none. -->
            <span class="v" data-tokens={tokens}>{tokens > 0 ? compactTokens(tokens) : '—'}</span>
            <span class="k">{m.ticketHead.tokensUsed}</span>
          </div>
        </div>
      {/if}
      {#if actions}
        <div class="actions">{@render actions()}</div>
      {/if}
    </div>
  </div>

  {#if children}{@render children()}{/if}
</header>

<style>
  .head {
    display: flex;
    flex-direction: column;
    gap: 24px;
    margin-bottom: 20px;
  }
  .head:not(.run) {
    padding: 8px 4px 0;
  }
  .top {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 24px;
  }
  .l {
    display: flex;
    flex: 1 1 440px;
    flex-direction: column;
    gap: 10px;
    min-width: 0;
  }
  .crumb {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--text-3);
  }
  .crumb a {
    color: var(--text-3);
    text-decoration: none;
  }
  .crumb a:hover {
    text-decoration: underline;
  }
  .crumb .id {
    font-weight: 600;
    color: var(--text-2);
  }
  .title-row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 12px;
    min-width: 0;
  }
  h1 {
    margin: 0;
    font-size: 28px;
    font-weight: 600;
    line-height: 1.2;
    letter-spacing: -0.6px;
    overflow-wrap: anywhere;
  }
  .title-row .pill {
    font-weight: 700;
  }
  .meta {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    border-radius: var(--r-pill);
    font-size: var(--type-caption);
    font-weight: 500;
    color: var(--text-2);
    background: #ffffffcc;
  }
  .run .chip {
    background: var(--surface-2);
  }
  .chip :global(svg) {
    flex: none;
  }

  .r {
    display: flex;
    flex: 0 1 auto;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: 16px 28px;
  }
  .stat {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 2px;
  }
  .stat .v {
    font-family: var(--font-head);
    font-size: 26px;
    font-weight: 700;
    letter-spacing: -0.8px;
    font-variant-numeric: tabular-nums;
    color: var(--text);
  }
  .stat .k {
    font-size: var(--type-caption);
    color: var(--text-2);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 10px;
  }
  .stats {
    display: flex;
    gap: 28px;
  }

  /*
   * The run variant is the side column's tile: everything stacked, the
   * figures and the actions under the title rather than beside it, the
   * actions sharing the column's width.
   */
  .run {
    gap: 22px;
    margin-bottom: 0;
    padding: 24px;
  }
  .run .top {
    flex-direction: column;
    align-items: stretch;
    gap: 18px;
  }
  .run .l {
    flex: none;
  }
  .run .title-row {
    flex-direction: column;
    align-items: flex-start;
    gap: 10px;
  }
  .run h1 {
    font-size: 24px;
    letter-spacing: -0.5px;
  }
  .run .r {
    flex-direction: column;
    align-items: stretch;
    justify-content: flex-start;
    gap: 16px;
  }
  .run .stat {
    align-items: flex-start;
  }
  .run .actions {
    justify-content: stretch;
  }
  .run .actions > :global(.btn) {
    flex: 1 1 auto;
    justify-content: center;
  }

  @media (max-width: 1100px) {
    .top {
      flex-direction: column;
    }
    .r {
      flex-wrap: wrap;
    }
  }
</style>
