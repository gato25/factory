<script lang="ts">
  import { active } from '$lib/remote/runs.remote';

  /**
   * The design's Active Runs card: a header carrying the name, how many, and
   * a way out to the whole board, then one row per run — what it is, how far
   * it has got, and what it is doing — at 14px by 20px with the softest
   * divider between.
   *
   * The progress column is a fixed 180px in the design, and that matters:
   * ragged progress bars cannot be compared down the column, which is the
   * only reason to show four of them at once. The bars are 4px, not 6: at
   * that weight they read as a measure rather than as four coloured pills.
   */
  const runs = $derived(active());
</script>

<section class="runs">
  <header>
    <span class="title-row">
      <h2>Идэвхтэй ажиллагаа</h2>
      {#if runs.ready && runs.current.length > 0}
        <span class="count">{runs.current.length}</span>
      {/if}
    </span>
    <a href="/tickets">Бүх даалгавар →</a>
  </header>

  {#if !runs.ready}
    <p class="empty">Ачааллаж байна…</p>
  {:else if runs.current.length === 0}
    <!--
      No advice here about creating a ticket: whether that would work depends
      on whether the workspace is configured, which the notice above this
      list answers. Telling somebody to do a thing that cannot work is worse
      than saying nothing.
    -->
    <p class="empty">Ажиллаж буй зүйл алга.</p>
  {:else}
    {#each runs.current as row (row.runId)}
      <a class="run" href="/tickets/{row.ticketId}">
        <span class="info">
          <span class="name">
            <span class="id">{row.reference}</span>
            <span class="title">{row.title}</span>
          </span>
          <span class="repo">{row.repository}</span>
        </span>

        <!-- Progress through the pipeline, coloured by state (FR-072) -->
        <span class="progress" aria-label="явц">
          {#each row.stepLabels as label, i (label + i)}
            <span
              class="seg"
              class:done={row.currentStepIndex !== null && i < row.currentStepIndex}
              class:now={i === row.currentStepIndex && row.status !== 'waiting_approval'}
              class:waiting={i === row.currentStepIndex && row.status === 'waiting_approval'}
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
            дараалалд {row.queuePosition}-рт
          {:else if row.status === 'waiting_approval'}
            батлах шаардлагатай
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
    padding: 16px 20px;
    border-bottom: 1px solid var(--border);
  }
  .title-row {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }
  h2 {
    margin: 0;
    font-family: var(--font-head);
    font-size: 15px;
    font-weight: 600;
    letter-spacing: -0.01em;
    color: var(--text);
  }
  .count {
    padding: 2px 8px;
    border-radius: 999px;
    background: var(--surface-2);
    font-family: var(--font-mono);
    font-size: 12px;
    font-weight: 600;
    color: var(--text-2);
  }
  header a {
    font-size: 13px;
    font-weight: 500;
    color: var(--accent-text);
    text-decoration: none;
    white-space: nowrap;
  }

  .empty {
    margin: 0;
    padding: 16px 20px;
    font-size: 13px;
    color: var(--text-3);
  }

  .run {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 14px 20px;
    border-bottom: 1px solid var(--surface-2);
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
    gap: 3px;
    flex: 1;
    min-width: 0;
  }
  .name {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .id {
    font-family: var(--font-mono);
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
    gap: 3px;
    width: 180px;
    flex: none;
  }
  .seg {
    flex: 1;
    height: 4px;
    border-radius: 2px;
    background: var(--surface-2);
  }
  .seg.done {
    background: var(--success);
  }
  .seg.now {
    background: var(--accent);
  }
  .seg.waiting {
    background: var(--warning);
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
