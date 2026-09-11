<script lang="ts">
  import { activity } from '$lib/remote/runs.remote';

  const feed = $derived(activity());

  // Derived from the rows that already record what happened, rather than
  // duplicated into a table of its own (FR-073).
  const TEXT: Record<string, string> = {
    mr_opened: 'merge request opened',
    run_failed: 'run failed',
    gate_reached: 'checkpoint reached',
    run_cancelled: 'run cancelled',
    ticket_created: 'ticket created'
  };
  const TONE: Record<string, string> = {
    mr_opened: 'ok',
    run_failed: 'bad',
    gate_reached: 'warn',
    run_cancelled: '',
    ticket_created: ''
  };
</script>

<section class="card">
  <h2 class="section">Recent activity</h2>
  {#if !feed.ready}
    <p class="muted small">Loading…</p>
  {:else}
    {@const rows = feed.current}
      {#if rows.length === 0}
        <p class="muted small">Nothing has happened yet.</p>
      {:else}
        <ul>
          {#each rows as row (row.runId)}
            <li>
              <span class="badge {TONE[row.kind]}">{TEXT[row.kind]}</span>
              <a href="/tickets/{row.ticketId}">{row.reference} {row.title}</a>
              {#if row.attempt > 1}<span class="muted small">attempt {row.attempt}</span>{/if}
              <time class="muted small" datetime={new Date(row.at).toISOString()}>
                {new Date(row.at).toLocaleString()}
              </time>
              {#if row.kind === 'run_failed' && row.detail}
                <span class="detail muted small">{row.detail}</span>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
  {/if}
</section>

<style>
  ul { list-style: none; margin: 0; padding: 0; }
  li {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    padding: 8px 2px;
    border-top: 1px solid var(--border);
  }
  li:first-child { border-top: 0; }
  a { color: inherit; }
  .detail { flex-basis: 100%; }
</style>
