<script lang="ts">
  import { active } from '$lib/remote/runs.remote';

  const runs = $derived(active());
</script>

<section class="card">
  <h2 class="section">Active runs</h2>
  {#if !runs.ready}
    <p class="muted small">Loading…</p>
  {:else}
    {@const rows = runs.current}
      {#if rows.length === 0}
        <p class="muted small">Nothing running. Create a ticket to start a pipeline.</p>
      {:else}
        <ul>
          {#each rows as row (row.runId)}
            <li>
              <a href="/tickets/{row.ticketId}">
                <span class="who">
                  <strong>{row.reference}</strong> {row.title}
                  <span class="muted small">{row.repository} &middot; {row.pipeline}</span>
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
                <span class="badge {row.status === 'waiting_approval' ? 'warn' : 'live'}">
                  {row.status === 'waiting_approval' ? 'needs approval' : row.status}
                </span>
              </a>
            </li>
          {/each}
        </ul>
      {/if}
  {/if}
</section>

<style>
  ul { list-style: none; margin: 0; padding: 0; }
  li { border-top: 1px solid var(--line-2); }
  li:first-child { border-top: 0; }
  a {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 120px auto;
    gap: 12px;
    align-items: center;
    padding: 10px 2px;
    text-decoration: none;
    color: inherit;
  }
  .who { display: flex; flex-direction: column; min-width: 0; }
  .who span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .progress { display: flex; gap: 3px; }
  .seg {
    flex: 1;
    height: 6px;
    border-radius: 2px;
    background: var(--line-2);
  }
  .seg.done { background: var(--ok); }
  .seg.now { background: var(--accent); }
  @media (max-width: 720px) {
    a { grid-template-columns: 1fr; }
  }
</style>
