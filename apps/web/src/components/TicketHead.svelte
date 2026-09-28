<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from '$components/Icon.svelte';
  import { ago, exact } from '$lib/format';
  import { m } from '$lib/i18n';
  import { duration } from '$lib/step-kind';

  /**
   * The head of a ticket screen, in the two shapes the artboards draw:
   *
   *   - `run` (artboard 06): one tile holding the crumb, the title beside its
   *     state, the branch, the pipeline and when it started, the two figures
   *     somebody watching a run looks at — how long, and how much of the
   *     budget — the actions, and under it all the step track.
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
    costUsd,
    costCeilingUsd = null,
    elapsedS = null,
    pipeline = null,
    status,
    variant = 'wide',
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
    costUsd: string;
    /** The run's budget, shown beside what it has spent. */
    costCeilingUsd?: string | null;
    /** Total of the steps that have run. */
    elapsedS?: number | null;
    /** "Стандарт · 6 алхам": the pipeline the run pinned, and its length. */
    pipeline?: string | null;
    status: { label: string; tone: string };
    variant?: 'wide' | 'run' | 'rail';
    actions?: Snippet;
    /** The step track, under the head (the run variant). */
    children?: Snippet;
  } = $props();

  const run = $derived(variant !== 'wide');
  const dollars = (fixed: string) => `$${Number(fixed).toFixed(2)}`;
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
          <span class="chip"><Icon name="coins" size={12} />{m.ticketHead.soFar(dollars(costUsd))}</span>
        {/if}
      </div>
    </div>

    <div class="r">
      {#if run}
        <!-- The two figures somebody watching a run looks at. -->
        <div class="stat">
          <span class="v">{elapsedS ? duration(elapsedS) : '—'}</span>
          <span class="k">{m.ticketHead.elapsed}</span>
        </div>
        <div class="stat">
          <span class="v">{dollars(costUsd)}</span>
          <span class="k">
            {costCeilingUsd ? m.ticketHead.spentOf(dollars(costCeilingUsd)) : m.ticketHead.spent}
          </span>
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
  .run {
    padding: 28px;
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

  @media (max-width: 1100px) {
    .top {
      flex-direction: column;
    }
    .r {
      flex-wrap: wrap;
    }
  }
</style>
