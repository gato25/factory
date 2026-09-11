<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from '$components/Icon.svelte';
  import { ago, exact } from '$lib/format';

  /**
   * The head `design.pen` puts on every ticket screen: a crumb, the title
   * with where the run is, then the branch, the author, how long it has been
   * going and what it has cost. Screens 06 and 07 differ only in the buttons,
   * so those come in as a snippet.
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
    status,
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
    status: { label: string; tone: string };
    actions?: Snippet;
  } = $props();
</script>

<header class="head">
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

    <div class="meta">
      <span><Icon name="git-branch" size={14} />{branchName ?? 'no branch yet'}</span>
      <span><Icon name="user" size={14} />Created by {createdByName ?? 'unknown'}</span>
      {#if startedAt}
        <span title={exact(startedAt)}>
          <Icon name="timer" size={14} />Started {ago(startedAt)}
        </span>
      {/if}
      <span><Icon name="coins" size={14} />${costUsd} so far</span>
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

  @media (max-width: 1100px) {
    .head {
      flex-direction: column;
    }
  }
</style>
