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
        <!--
          No advice here about creating a ticket: whether that would work
          depends on whether the workspace is configured, which the notice
          above this list answers. Telling somebody to do a thing that cannot
          work is worse than saying nothing.
        -->
        <p class="muted small">Nothing running.</p>
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
                <!--
                  A waiting run says where it is rather than just "queued":
                  the number is the only part a reader can act on (FR-082).
                -->
                <span
                  class="badge {row.status === 'waiting_approval' || row.queuePosition !== null
                    ? 'warn'
                    : 'live'}"
                >
                  {#if row.queuePosition !== null}
                    position {row.queuePosition} in the queue
                  {:else if row.status === 'waiting_approval'}
                    needs approval
                  {:else}
                    {row.status}
                  {/if}
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
