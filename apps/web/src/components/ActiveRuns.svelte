<script lang="ts">
  import { active } from '$lib/remote/runs.remote';

  /**
   * The design's Active Runs card: a header carrying the name and a way out
   * to the whole board, then one row per run — what it is, how far it has
   * got, and what it is doing — at 16px by 22px with a hairline between.
   *
   * The progress column is a fixed 180px in the design, and that matters:
   * ragged progress bars cannot be compared down the column, which is the
   * only reason to show four of them at once.
   */
  const runs = $derived(active());
</script>

<section class="card runs">
  <header>
    <h2>Active runs</h2>
    <a href="/tickets">View all tickets →</a>
  </header>

  {#if !runs.ready}
    <p class="empty muted small">Loading…</p>
  {:else if runs.current.length === 0}
    <!--
      No advice here about creating a ticket: whether that would work depends
      on whether the workspace is configured, which the notice above this
      list answers. Telling somebody to do a thing that cannot work is worse
      than saying nothing.
    -->
    <p class="empty muted small">Nothing running.</p>
  {:else}
    {#each runs.current as row (row.runId)}
      <a class="run" href="/tickets/{row.ticketId}">
        <span class="info">
          <span class="title-row">
            <span class="id">{row.reference}</span>
            <span class="title">{row.title}</span>
          </span>
          <span class="repo">{row.repository}</span>
        </span>

        <!-- Progress through the pipeline, coloured by state (FR-072) -->
        <span class="progress" aria-label="progress">
          {#each row.stepLabels as label, i (label + i)}
            <span
              class="seg"
              class:done={row.currentStepIndex !== null && i < row.currentStepIndex}
              class:now={i === row.currentStepIndex}
              title={label}
            ></span>
          {/each}
        </span>

        <!--
          A waiting run says where it is rather than just "queued": the number
          is the only part a reader can act on (FR-082).
        -->
        <span
          class="badge {row.status === 'waiting_approval' || row.queuePosition !== null
            ? 'warn'
            : 'live'}"
        >
          <span class="dot"></span>
          {#if row.queuePosition !== null}
            position {row.queuePosition} in the queue
          {:else if row.status === 'waiting_approval'}
            needs approval
          {:else}
            {row.stepLabels[row.currentStepIndex ?? 0] ?? row.status}
          {/if}
        </span>
      </a>
    {/each}
  {/if}
</section>

<style>
  .runs {
    flex: 1;
    min-width: 0;
    padding: 0;
    border-radius: var(--r-lg);
    border-color: var(--card-border);
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 18px 20px;
    border-bottom: 1px solid var(--border);
  }
  h2 {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
    color: var(--text);
  }
  header a {
    font-size: 13px;
    font-weight: 500;
    color: var(--accent-text);
    text-decoration: none;
    white-space: nowrap;
  }

  .empty {
    padding: 16px 22px;
  }

  .run {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 16px 22px;
    border-bottom: 1px solid var(--border);
    text-decoration: none;
    color: inherit;
  }
  .run:last-child {
    border-bottom: 0;
  }
  .run:hover {
    background: var(--surface-2);
  }

  .info {
    display: flex;
    flex-direction: column;
    gap: 4px;
    flex: 1;
    min-width: 0;
  }
  .title-row {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .id {
    font-size: 12px;
    color: var(--text-3);
    flex: none;
  }
  .title {
    font-size: 14px;
    font-weight: 600;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .repo {
    font-size: 12px;
    color: var(--text-2);
  }

  /* Fixed, so four runs' progress can be read down the column. */
  .progress {
    display: flex;
    gap: 4px;
    width: 180px;
    flex: none;
  }
  .seg {
    flex: 1;
    height: 6px;
    border-radius: 3px;
    background: var(--surface-2);
  }
  .seg.done {
    background: var(--success);
  }
  .seg.now {
    background: var(--accent);
  }

  .badge {
    flex: none;
    font-size: 12px;
    font-weight: 600;
    padding: 4px 10px;
  }
  .dot {
    width: 6px;
    height: 6px;
    border-radius: 999px;
    background: currentcolor;
    flex: none;
  }

  @media (max-width: 720px) {
    .run {
      flex-wrap: wrap;
    }
    .progress {
      width: 100%;
    }
  }
</style>
