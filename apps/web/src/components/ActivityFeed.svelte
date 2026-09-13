<script lang="ts">
  import { activity } from '$lib/remote/runs.remote';

  /**
   * What just happened, built to `design.pen`: a title, then one row per
   * event — a 6px dot in the colour of what it means, a sentence, and how
   * long ago. An earlier version led each row with a 16px coloured icon and
   * a pill naming the kind, and five of those down a column were a rainbow.
   * The dot carries the same meaning at a fraction of the weight.
   */
  const feed = $derived(activity());

  // Derived from the rows that already record what happened, rather than
  // duplicated into a table of its own (FR-073).
  const TEXT: Record<string, string> = {
    mr_opened: 'Merge request opened for',
    run_failed: 'Run failed for',
    gate_reached: 'Checkpoint reached for',
    run_cancelled: 'Run cancelled for',
    ticket_created: 'Ticket created:'
  };
  const TONE: Record<string, string> = {
    mr_opened: 'ok',
    run_failed: 'bad',
    gate_reached: 'warn',
    run_cancelled: '',
    ticket_created: ''
  };

  /**
   * "12 min ago" rather than a full timestamp, as the design reads. A feed is
   * skimmed for recency; the exact moment is a hover away in the title.
   */
  function ago(at: string | number | Date, now = Date.now()): string {
    const seconds = Math.max(0, Math.round((now - new Date(at).getTime()) / 1000));
    if (seconds < 60) return 'just now';
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours} h ago`;
    const days = Math.round(hours / 24);
    if (days < 7) return `${days} d ago`;
    return new Date(at).toLocaleDateString();
  }
</script>

<section class="feed">
  <header><h2>Recent activity</h2></header>
  {#if !feed.ready}
    <p class="empty">Loading…</p>
  {:else}
    {@const rows = feed.current}
    {#if rows.length === 0}
      <p class="empty">Nothing has happened yet.</p>
    {:else}
      <ul>
        {#each rows as row (row.runId)}
          <li>
            <span class="dot {TONE[row.kind]}"></span>
            <span class="text">
              <span class="msg">
                {TEXT[row.kind] ?? row.kind}
                <a href="/tickets/{row.ticketId}">{row.reference} {row.title}</a>
                {#if row.attempt > 1}<span class="attempt">attempt {row.attempt}</span>{/if}
              </span>
              {#if row.kind === 'run_failed' && row.detail}
                <span class="detail">{row.detail}</span>
              {/if}
              <time class="when" datetime={new Date(row.at).toISOString()} title={new Date(row.at).toLocaleString()}>
                {ago(row.at)}
              </time>
            </span>
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
</section>

<style>
  .feed {
    padding: 16px 20px;
    background: var(--surface);
    border: 1px solid var(--card-border);
    border-radius: var(--r-lg);
    box-shadow: 0 1px 2px #0f172a0a;
  }
  header {
    padding-bottom: 6px;
  }
  h2 {
    margin: 0;
    font-family: var(--font-head);
    font-size: 15px;
    font-weight: 600;
    letter-spacing: -0.01em;
    color: var(--text);
  }
  .empty {
    margin: 0;
    padding: 8px 0;
    font-size: 13px;
    color: var(--text-3);
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  li {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 9px 0;
    border-top: 1px solid var(--surface-2);
  }
  li:first-child {
    border-top: 0;
  }
  .dot {
    width: 6px;
    height: 6px;
    margin-top: 6px;
    border-radius: 999px;
    background: var(--text-3);
    flex: none;
  }
  .dot.ok {
    background: var(--success);
  }
  .dot.bad {
    background: var(--danger);
  }
  .dot.warn {
    background: var(--warning);
  }
  .text {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .msg {
    font-size: 13px;
    line-height: 1.4;
    color: var(--text);
  }
  .msg a {
    color: inherit;
    font-weight: 500;
    text-decoration: none;
  }
  .msg a:hover {
    text-decoration: underline;
  }
  .attempt {
    margin-left: 4px;
    font-size: 11px;
    color: var(--text-3);
  }
  .detail {
    font-size: 12px;
    color: var(--text-2);
  }
  .when {
    font-size: 11px;
    color: var(--text-3);
  }
</style>
