<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import ScreenGallery from '$components/ScreenGallery.svelte';
  import { subscribeToRun } from '$lib/events/subscribe';
  import { approve, cancelRun, design, requestChanges } from '$lib/remote/approvals.remote';
  import { runForTicket } from '$lib/remote/runs.remote';

  /**
   * Screen 14 — Design Review. A gate that follows a design step shows every
   * screen as an image openable at full size, the acceptance criteria beside
   * them, why the ticket was classified as interface work, and that no code
   * has been written yet (FR-064d). It also offers a link that opens the
   * committed design source (FR-064e).
   */
  const ticketId = $derived(page.params.id as string);
  const view = $derived(runForTicket(ticketId));

  const target = $derived(
    view.ready && view.current
      ? { runId: view.current.run.id, stepIndex: view.current.run.currentStepIndex ?? 0 }
      : null
  );
  const review = $derived(target ? design(target) : null);

  onMount(() => {
    let stop = () => {};
    void runForTicket(ticketId).then((loaded) => {
      if (!loaded) return;
      stop = subscribeToRun({
        target: loaded.run.id,
        onEvent: () => {
          void runForTicket(ticketId).refresh();
          if (target) void design(target).refresh();
        }
      });
    });
    return () => stop();
  });
</script>

{#if !view.ready}
  <p class="card">Loading…</p>
{:else if !view.current}
  <p class="card">This ticket has not been started.</p>
{:else if review?.error}
  <p class="card failure" role="alert">{(review.error as Error).message}</p>
{:else if !review?.ready}
  <p class="card">Loading the design…</p>
{:else}
  {@const d = review.current}
  {@const paused = view.current.run.status === 'waiting_approval'}

  <header class="card banner" class:decided={!paused}>
    <div>
      <h1>{d.ticket.reference} {d.ticket.title}</h1>
      {#if paused}
        <p>
          The pipeline is <strong>paused</strong> for design review.
          {#if d.noCodeYet}
            <strong>No code has been written yet</strong> — nothing after the design step has run.
          {/if}
        </p>
      {:else if d.gate.decided}
        <p>
          Already decided: <strong>{d.gate.decided.decision.replace('_', ' ')}</strong>
          on {new Date(d.gate.decided.at).toLocaleString()}.
        </p>
      {/if}
      <!-- Why the design step ran at all (FR-100) -->
      {#if d.ticket.uiRationale}
        <p class="small muted">
          Classified as {d.ticket.hasUi ? 'interface work' : 'not interface work'} —
          {d.ticket.uiRationale}
        </p>
      {:else if d.ticket.classificationMissing}
        <p class="small warn-text">
          The specification step produced no usable decision about whether this ticket changes the
          interface, so it was treated as not changing it.
        </p>
      {/if}
    </div>
    <div class="links">
      {#if d.designSource?.url}
        <!-- The committed source, openable in the design service (FR-064e) -->
        <a class="source" href={d.designSource.url} target="_blank" rel="noreferrer">
          Open the design source
        </a>
      {/if}
      <a class="back" href="/tickets/{ticketId}">Back to the run</a>
    </div>
  </header>

  <div class="layout">
    <div class="column">
      <ScreenGallery
        screens={d.screens}
        heading="Designed screens"
        note="Each one opens at full size. Use the arrow keys to move between them."
      />
      {#if d.designSource}
        <section class="card">
          <h2 class="section">Design source</h2>
          <p class="small">
            <code>{d.designSource.path}</code> is committed to the run's branch, so the design
            travels with the code and a later ticket can revise it rather than redraw it.
          </p>
          {#if !d.designSource.url}
            <p class="muted small">
              This repository's address is not one we can build a file link for.
            </p>
          {/if}
        </section>
      {/if}
    </div>

    <div class="side">
      <!-- The criteria beside the screens, so they are read together (FR-064d) -->
      <section class="card">
        <h2 class="section">Acceptance criteria</h2>
        {#if d.ticket.acceptanceCriteria.length === 0}
          <p class="muted small">None were given. That is the biggest quality lever there is.</p>
        {:else}
          <ul class="criteria">
            {#each d.ticket.acceptanceCriteria as criterion (criterion)}
              <li>{criterion}</li>
            {/each}
          </ul>
        {/if}
      </section>

      {#if paused}
        <section class="card">
          <h2 class="section">Decide</h2>
          {#if !d.mayDecide}
            <p class="muted small">
              This checkpoint is not yours to decide. You can read everything here.
            </p>
          {:else}
            <form {...approve} class="stack">
              <input type="hidden" name="runId" value={d.gate.runId} />
              <input type="hidden" name="stepIndex" value={d.gate.stepIndex} />
              <button class="primary" type="submit" disabled={approve.pending > 0}>
                Approve &amp; build it
              </button>
            </form>

            <form {...requestChanges} class="stack">
              <input type="hidden" name="runId" value={d.gate.runId} />
              <input type="hidden" name="stepIndex" value={d.gate.stepIndex} />
              <label>
                <span class="muted small">
                  Request changes — this text is sent to the design tool
                </span>
                <textarea name="feedback" rows="4" placeholder="What should change, and why?"
                ></textarea>
              </label>
              {#if requestChanges.fields.allIssues()?.length}
                <ul class="errors" role="alert">
                  {#each requestChanges.fields.allIssues() ?? [] as issue (issue.message)}
                    <li>{issue.message}</li>
                  {/each}
                </ul>
              {/if}
              <button type="submit" disabled={requestChanges.pending > 0}>Request changes</button>
              <p class="muted small">
                The design is revised rather than redrawn, and comes back here.
              </p>
            </form>

            <form {...cancelRun} class="stack">
              <input type="hidden" name="runId" value={d.gate.runId} />
              <input type="hidden" name="stepIndex" value={d.gate.stepIndex} />
              <button class="danger" type="submit">Cancel run</button>
            </form>
          {/if}
        </section>
      {/if}
    </div>
  </div>
{/if}

<style>
  .banner {
    border-left: 3px solid var(--warning);
    margin-bottom: 16px;
    display: flex;
    justify-content: space-between;
    gap: 16px;
    align-items: flex-start;
  }
  .banner.decided { border-left-color: var(--border); }
  .banner h1 { margin: 0 0 6px; font-size: 18px; }
  .banner p { margin: 0 0 4px; }
  .warn-text { color: #8a6100; }
  .links { display: flex; flex-direction: column; gap: 6px; align-items: flex-end; }
  .source {
    padding: 7px 14px;
    border-radius: var(--r-sm);
    background: var(--surface);
    border: 1px solid var(--border);
    text-decoration: none;
    color: inherit;
    white-space: nowrap;
  }
  .back { white-space: nowrap; }
  .layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 340px;
    gap: 16px;
    align-items: start;
  }
  .column, .side { display: flex; flex-direction: column; gap: 16px; }
  .criteria { margin: 0; padding-left: 18px; }
  .stack {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding-bottom: 12px;
    border-bottom: 1px solid var(--border);
    margin-bottom: 12px;
  }
  .stack:last-of-type { border-bottom: 0; margin-bottom: 0; padding-bottom: 0; }
  .stack p { margin: 0; }
  textarea {
    width: 100%;
    box-sizing: border-box;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    font: inherit;
    resize: vertical;
  }
  button {
    padding: 9px 14px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: var(--surface);
    font: inherit;
    cursor: pointer;
  }
  button.primary {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
    font-weight: 600;
  }
  button.danger { color: var(--danger); border-color: #f3c7c4; }
  .errors { margin: 0; padding-left: 18px; color: var(--danger); }
  .failure { border-left: 3px solid var(--danger); }
  @media (max-width: 1000px) {
    .layout { grid-template-columns: 1fr; }
  }
</style>
