<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from '$components/Icon.svelte';
  import { ago, exact } from '$lib/format';
  import { duration } from '$lib/step-kind';

  /**
   * The head `design.pen` puts on a ticket screen. Two shapes, because two
   * screens need it differently:
   *
   *   - `wide` (the default) is the full-width header screen 07 draws: the
   *     crumb, the title beside its status, a row of meta, actions on the
   *     right.
   *   - `rail` is what screen 06 became. The run view is now a fixed-height
   *     shell with the log filling it, and this is the 320px column beside
   *     it, so everything stacks: crumb, title, badge, then the two figures
   *     worth a glance as a pair of stat cells, the remaining meta as quiet
   *     lines, and the actions across the bottom.
   *
   * The stat cells exist because elapsed and spend were a single unlabelled
   * line of small monospace text buried in the meta, which is no way to
   * show the two numbers somebody watching a run actually looks at.
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
    elapsedS = null,
    status,
    variant = 'wide',
    actions,
  }: {
    ticketId: string;
    repositoryName: string;
    reference: string;
    title: string;
    branchName: string | null;
    createdByName: string | null;
    startedAt?: Date | string | null;
    costUsd: string;
    /** Total of the steps that have run, for the rail's first stat cell. */
    elapsedS?: number | null;
    status: { label: string; tone: string };
    variant?: 'wide' | 'rail';
    actions?: Snippet;
  } = $props();

  const rail = $derived(variant === 'rail');
</script>

<header class="head" class:rail>
  <div class="l">
    <p class="crumb">
      <a href="/tickets">Tickets</a>
      <Icon name="chevron-right" size={14} />
      <span>{repositoryName}</span>
      <Icon name="chevron-right" size={14} />
      <a class="id" href="/tickets/{ticketId}">{reference}</a>
    </p>

    <div class="title-row">
      <h1>{title}</h1>
      <span class="badge {status.tone}">
        <span class="dot"></span>
        {status.label}
      </span>
    </div>

    {#if rail}
      <!-- The two figures somebody watching a run looks at, as a pair. -->
      <div class="stats">
        <div class="stat">
          <span class="v">{elapsedS ? duration(elapsedS) : '—'}</span>
          <span class="k">elapsed</span>
        </div>
        <div class="stat">
          <span class="v">${costUsd}</span>
          <span class="k">spent</span>
        </div>
      </div>
    {/if}

    <div class="meta">
      <span><Icon name="git-branch" size={14} />{branchName ?? 'no branch yet'}</span>
      <span><Icon name="user" size={14} />Created by {createdByName ?? 'unknown'}</span>
      {#if startedAt}
        <span title={exact(startedAt)}>
          <Icon name="timer" size={14} />Started {ago(startedAt)}
        </span>
      {/if}
      {#if !rail}
        <span><Icon name="coins" size={14} />${costUsd} so far</span>
      {/if}
    </div>
  </div>

  {#if actions}
    <div class="actions">{@render actions()}</div>
  {/if}
</header>

<style>
  .head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 24px;
    margin-bottom: 20px;
  }
  .l {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }
  .crumb {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0;
    font-size: 12px;
    color: var(--text-3);
  }
  .crumb a {
    color: var(--text-3);
    text-decoration: none;
  }
  .crumb a:hover {
    color: var(--accent-text);
  }
  .crumb .id {
    color: var(--text-2);
  }

  .title-row {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }
  h1 {
    margin: 0;
    font-family: var(--font-head);
    font-size: 22px;
    font-weight: 700;
    color: var(--text);
  }

  .meta {
    display: flex;
    align-items: center;
    gap: 18px;
    flex-wrap: wrap;
    font-size: 12px;
    color: var(--text-2);
  }
  .meta span {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .meta :global(svg) {
    color: var(--text-3);
    flex: none;
  }

  .badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    border-radius: 999px;
    background: var(--surface-2);
    font-size: 12px;
    font-weight: 500;
    color: var(--text-2);
  }
  .badge.live {
    background: var(--accent-soft);
    color: var(--accent-text);
  }
  .badge.warn {
    background: var(--warning-soft);
    color: var(--warning);
  }
  .badge.ok {
    background: var(--success-soft);
    color: var(--success);
  }
  .badge.bad {
    background: var(--danger-soft);
    color: var(--danger);
  }
  .dot {
    width: 6px;
    height: 6px;
    border-radius: 999px;
    background: currentcolor;
    flex: none;
  }

  .actions {
    display: flex;
    align-items: center;
    gap: 10px;
    flex: none;
    flex-wrap: wrap;
  }

  /* Everything below is the rail: one narrow column, so nothing sits beside
     anything else except the two stat cells and the buttons. */
  .head.rail {
    flex-direction: column;
    align-items: stretch;
    gap: 12px;
    margin-bottom: 0;
  }
  .head.rail .l {
    gap: 9px;
  }
  .head.rail .title-row {
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  }
  .head.rail h1 {
    font-size: 17px;
    line-height: 1.3;
  }
  .head.rail .meta {
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
    font-size: 11.5px;
  }
  .head.rail .meta span {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .head.rail .actions {
    flex: initial;
    flex-wrap: nowrap;
    gap: 8px;
  }
  /* Full-width halves, so two buttons fit a 284px column. */
  .head.rail .actions :global(> *) {
    flex: 1 1 0;
    min-width: 0;
    justify-content: center;
  }

  .stats {
    display: flex;
    gap: 8px;
  }
  .stat {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1 1 0;
    min-width: 0;
    padding: 8px 10px;
    border-radius: var(--r-md);
    background: var(--surface-2);
  }
  .stat .v {
    font-family: var(--font-mono);
    font-size: 14px;
    font-weight: 700;
    color: var(--text);
  }
  .stat .k {
    font-size: 10.5px;
    color: var(--text-3);
  }

  @media (max-width: 1100px) {
    .head {
      flex-direction: column;
    }
  }
</style>
