<script lang="ts">
  import Icon from '$components/Icon.svelte';
  import type { BoardTicket } from '$lib/services/run-view';

  /**
   * One board card, built to `design.pen`'s Card: the reference and the
   * author's avatar on one row, the title, the repository and pipeline, then
   * a full-width status strip.
   *
   * The strip is the point of the card. Whichever applies — the running step,
   * the pending gate, the merge request, the failure reason — is what tells
   * you whether this ticket needs you, and it is coloured so a column can be
   * scanned without reading (FR-023a).
   */

  let { ticket }: { ticket: BoardTicket } = $props();

  const STRIP: Record<BoardTicket['strip']['kind'], { tone: string; icon: string }> = {
    step: { tone: 'live', icon: 'loader' },
    gate: { tone: 'warn', icon: 'hand' },
    merge_request: { tone: 'ok', icon: 'git-pull-request' },
    failure: { tone: 'bad', icon: 'circle-x' },
    none: { tone: '', icon: 'circle-check' },
  };

  const initials = $derived(
    (ticket.createdByName ?? '?')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join(''),
  );
</script>

<a class="ticket" href="/tickets/{ticket.id}">
  <div class="top">
    <span class="id">{ticket.reference}</span>
    <span class="who" title={ticket.createdByName ?? 'unknown'}>{initials}</span>
  </div>

  <h3>{ticket.title}</h3>

  <div class="meta">
    <Icon name="folder-git-2" size={12} />
    <span>{ticket.repository}</span>
    {#if ticket.pipeline}
      <span class="dot">&middot;</span>
      <span>{ticket.pipeline}</span>
    {/if}
  </div>

  {#if ticket.strip.kind !== 'none'}
    <div class="strip {STRIP[ticket.strip.kind].tone}">
      <Icon name={STRIP[ticket.strip.kind].icon} size={13} />
      <span>{ticket.strip.text}</span>
    </div>
  {/if}

  {#if ticket.hasUi === true}
    <p class="ui small muted">Changes the interface</p>
  {/if}
</a>

<style>
  .ticket {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 14px;
    background: var(--surface);
    border: 1px solid var(--card-border);
    border-radius: var(--r-lg);
    text-decoration: none;
    color: inherit;
  }
  .ticket:hover {
    border-color: var(--accent);
  }

  .top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .id {
    font-size: 11px;
    color: var(--text-3);
  }
  .who {
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    border-radius: 999px;
    background: var(--purple-soft);
    color: var(--purple);
    font-size: 9px;
    font-weight: 700;
    flex: none;
  }

  h3 {
    margin: 0;
    font-family: var(--font);
    font-size: 14px;
    font-weight: 600;
    line-height: 1.35;
    color: var(--text);
  }

  .meta {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    font-size: 12px;
    color: var(--text-2);
  }
  .meta :global(svg) {
    color: var(--text-3);
    flex: none;
  }
  .meta span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .meta .dot {
    color: var(--text-3);
    flex: none;
  }

  /* Full width, so a column of them lines up and can be read down. */
  .strip {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 10px;
    border-radius: var(--r-sm);
    font-size: 12px;
    font-weight: 500;
    background: var(--surface-2);
    color: var(--text-2);
  }
  .strip :global(svg) {
    flex: none;
  }
  .strip.live {
    background: var(--accent-soft);
    color: var(--accent);
  }
  .strip.warn {
    background: var(--warning-soft);
    color: var(--warning);
  }
  .strip.ok {
    background: var(--success-soft);
    color: var(--success);
  }
  .strip.bad {
    background: var(--danger-soft);
    color: var(--danger);
  }

  .ui {
    margin: 0;
  }
</style>
