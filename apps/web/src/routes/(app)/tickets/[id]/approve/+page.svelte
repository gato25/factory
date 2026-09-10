<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import {
    approve,
    cancelRun,
    document as documentQuery,
    editAndApprove,
    gate,
    requestChanges
  } from '$lib/remote/approvals.remote';
  import ScreenGallery from '$components/ScreenGallery.svelte';
  import { subscribeToRun } from '$lib/events/subscribe';
  import { runForTicket } from '$lib/remote/runs.remote';

  const ticketId = $derived(page.params.id as string);
  const view = $derived(runForTicket(ticketId));

  let openPath = $state<string | null>(null);
  let editing = $state(false);
  let draft = $state('');

  const target = $derived(
    view.ready && view.current
      ? { runId: view.current.run.id, stepIndex: view.current.run.currentStepIndex ?? 0 }
      : null
  );
  const detail = $derived(target ? gate(target) : null);
  const openDoc = $derived(
    detail?.ready && openPath
      ? documentQuery(detail.current.artifacts.find((a) => a.path === openPath)?.id ?? '')
      : null
  );

  onMount(() => {
    let stop = () => {};
    void runForTicket(ticketId).then((loaded) => {
      if (!loaded) return;
      stop = subscribeToRun({
        target: loaded.run.id,
        onEvent: () => {
          void runForTicket(ticketId).refresh();
          if (target) void gate(target).refresh();
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
{:else if !detail?.ready}
  <p class="card">Loading the checkpoint…</p>
{:else}
  {@const d = detail.current}
  {@const paused = view.current.run.status === 'waiting_approval'}
  {@const screens = d.artifacts.filter((a) => a.kind === 'screen')}
  {@const readable = d.artifacts.filter((a) => a.kind !== 'screen')}

  <!-- The banner names the checkpoint and says the pipeline is paused -->
  <header class="card banner" class:decided={!paused}>
    <div>
      <h1>{d.ticket.reference} {d.ticket.title}</h1>
      {#if paused}
        <p>
          The pipeline is <strong>paused</strong> at step {d.gate.stepIndex + 1}
          {#if d.gate.precedingLabel}
            , after <strong>{d.gate.precedingLabel}</strong>
          {/if}. Nothing further runs until someone decides.
          {#if d.gate.precedingIsDesign}
            <strong>No code has been written yet.</strong>
          {/if}
        </p>
      {:else if d.gate.decided}
        <p>
          Already decided: <strong>{d.gate.decided.decision.replace('_', ' ')}</strong>
          on {new Date(d.gate.decided.at).toLocaleString()}.
        </p>
      {:else}
        <p>This run is not waiting at a checkpoint.</p>
      {/if}
    </div>
    <a class="back" href="/tickets/{ticketId}">Back to the run</a>
  </header>

  <!--
    A decision can be refused after the fact — someone decided first, most
    often. It is said here rather than beside the buttons, because a refusal
    is usually accompanied by the gate closing and the buttons going away.
  -->
  {@const refusal =
    approve.result?.problem ??
    requestChanges.result?.problem ??
    editAndApprove.result?.problem ??
    cancelRun.result?.problem}
  {#if refusal}
    <p class="card refused" role="alert">{refusal}</p>
  {/if}

  <!--
    A gate after a design step is a design review, and has a screen of its
    own that shows the screens properly (FR-064d).
  -->
  {#if d.gate.precedingIsDesign}
    <p class="card notice">
      This checkpoint follows a design step.
      <a href="/tickets/{ticketId}/design">Review the screens</a> to see them at full size.
    </p>
  {/if}

  <div class="layout">
    <section class="card">
      <h2 class="section">Produced so far</h2>
      {#if d.artifacts.length === 0}
        <p class="muted small">Nothing produced yet.</p>
      {:else}
        {#if screens.length > 0}
          <div class="screens">
            <ScreenGallery {screens} heading="Screens" />
          </div>
        {/if}

        <div class="tabs">
          {#each readable as item (item.id)}
            <button
              class:on={openPath === item.path}
              onclick={() => {
                openPath = item.path;
                editing = false;
              }}
            >
              {item.path}
              {#if item.editedByHuman}<span class="badge small">edited</span>{/if}
            </button>
          {/each}
        </div>

        {#if readable.length === 0}
          <p class="muted small">No documents yet — the screens above are what exists so far.</p>
        {:else if openPath && openDoc?.ready}
          {#if editing}
            <form {...editAndApprove}>
              <input type="hidden" name="runId" value={d.gate.runId} />
              <input type="hidden" name="stepIndex" value={d.gate.stepIndex} />
              <input type="hidden" name="path" value={openPath} />
              <textarea name="content" rows="20">{draft}</textarea>
              {#if editAndApprove.fields.allIssues()?.length}
                <ul class="errors" role="alert">
                  {#each editAndApprove.fields.allIssues() ?? [] as issue (issue.message)}
                    <li>{issue.message}</li>
                  {/each}
                </ul>
              {/if}
              <div class="row">
                <button type="button" onclick={() => (editing = false)}>Discard changes</button>
                <button class="primary" type="submit" disabled={!d.mayDecide}>
                  Save &amp; continue
                </button>
              </div>
              <p class="muted small">
                Saving writes a new version. The previous one is kept, and every step after this
                reads the version you saved.
              </p>
            </form>
          {:else}
            <pre>{openDoc.current.content ?? '(empty)'}</pre>
            <p class="muted small">
              v{openDoc.current.version}
              {#if d.mayDecide && paused}
                &middot;
                <button
                  class="link"
                  onclick={() => {
                    draft = openDoc.current.content ?? '';
                    editing = true;
                  }}>Edit this document</button
                >
              {/if}
            </p>
          {/if}
        {:else if openPath}
          <p class="muted small">Loading…</p>
        {:else}
          <p class="muted small">Choose a document to read it.</p>
        {/if}
      {/if}
    </section>

    <div class="side">
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
        {#if d.ticket.uiRationale}
          <p class="muted small">
            Classified as {d.ticket.hasUi ? 'interface work' : 'not interface work'} —
            {d.ticket.uiRationale}
          </p>
        {/if}
      </section>

      {#if paused}
        <section class="card">
          <h2 class="section">Decide</h2>
          {#if !d.mayDecide}
            <!-- Readable by anyone; decidable only by the gate's approvers (FR-064) -->
            <p class="muted small">
              This checkpoint is not yours to decide. You can read everything here.
            </p>
          {:else}
            <form {...approve} class="stack">
              <input type="hidden" name="runId" value={d.gate.runId} />
              <input type="hidden" name="stepIndex" value={d.gate.stepIndex} />
              {#if approve.fields.allIssues()?.length}
                <ul class="errors" role="alert">
                  {#each approve.fields.allIssues() ?? [] as issue (issue.message)}
                    <li>{issue.message}</li>
                  {/each}
                </ul>
              {/if}
              <button class="primary" type="submit" disabled={approve.pending > 0}>
                Approve &amp; continue
              </button>
            </form>

            <form {...requestChanges} class="stack">
              <input type="hidden" name="runId" value={d.gate.runId} />
              <input type="hidden" name="stepIndex" value={d.gate.stepIndex} />
              <label>
                <span class="muted small">Request changes — this text is sent to the agent</span>
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
              <button type="submit" disabled={requestChanges.pending > 0}>
                Request changes
              </button>
              <p class="muted small">
                {d.gate.precedingLabel ?? 'The previous step'} runs again with your feedback, then
                comes back here.
              </p>
            </form>

            <form {...cancelRun} class="stack">
              <input type="hidden" name="runId" value={d.gate.runId} />
              <input type="hidden" name="stepIndex" value={d.gate.stepIndex} />
              {#if cancelRun.fields.allIssues()?.length}
                <ul class="errors" role="alert">
                  {#each cancelRun.fields.allIssues() ?? [] as issue (issue.message)}
                    <li>{issue.message}</li>
                  {/each}
                </ul>
              {/if}
              <button class="danger" type="submit" disabled={cancelRun.pending > 0}>
                Cancel run
              </button>
              <p class="muted small">
                The sandbox is released. The branch pushed so far is left alone.
              </p>
            </form>
          {/if}
        </section>
      {/if}

      <section class="card">
        <h2 class="section">What has happened</h2>
        <ol class="timeline">
          {#each d.timeline as entry (entry.at.toString() + entry.label)}
            <li>
              <time class="muted small">{new Date(entry.at).toLocaleString()}</time>
              <span>{entry.label}</span>
              {#if entry.detail}<span class="muted small">{entry.detail}</span>{/if}
            </li>
          {/each}
        </ol>
      </section>
    </div>
  </div>
{/if}

<style>
  .banner {
    border-left: 3px solid var(--warn);
    margin-bottom: 16px;
    display: flex;
    justify-content: space-between;
    gap: 16px;
    align-items: flex-start;
  }
  .banner.decided {
    border-left-color: var(--line);
  }
  .banner h1 {
    margin: 0 0 6px;
    font-size: 18px;
  }
  .banner p {
    margin: 0;
  }
  .back {
    white-space: nowrap;
  }
  .layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 340px;
    gap: 16px;
    align-items: start;
  }
  .side {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .screens {
    margin: 0 -16px 12px;
  }
  .notice {
    border-left: 3px solid var(--accent);
    margin: 0 0 16px;
    padding: 12px 16px;
  }
  .tabs {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    margin-bottom: 12px;
  }
  .tabs button {
    padding: 6px 10px;
    border: 1px solid var(--line);
    border-radius: var(--r-sm);
    background: var(--surface);
    font: inherit;
    cursor: pointer;
  }
  .tabs button.on {
    border-color: var(--accent);
    background: #f3f5ff;
  }
  pre,
  textarea {
    width: 100%;
    box-sizing: border-box;
    margin: 0;
    padding: 12px;
    background: var(--line-2);
    border: 0;
    border-radius: var(--r-sm);
    font: 12px/1.6 ui-monospace, monospace;
    max-height: 460px;
    overflow: auto;
    white-space: pre-wrap;
  }
  textarea {
    background: var(--surface);
    border: 1px solid var(--line);
    resize: vertical;
  }
  .criteria {
    margin: 0;
    padding-left: 18px;
  }
  .stack {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding-bottom: 12px;
    border-bottom: 1px solid var(--line-2);
    margin-bottom: 12px;
  }
  .stack:last-of-type {
    border-bottom: 0;
    margin-bottom: 0;
    padding-bottom: 0;
  }
  .stack p {
    margin: 0;
  }
  button {
    padding: 9px 14px;
    border: 1px solid var(--line);
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
  button.danger {
    color: var(--bad);
    border-color: #f3c7c4;
  }
  button.link {
    border: 0;
    background: none;
    padding: 0;
    color: var(--accent);
    text-decoration: underline;
    cursor: pointer;
    font: inherit;
  }
  .row {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
  }
  .errors {
    margin: 0;
    padding-left: 18px;
    color: var(--bad);
  }
  .refused {
    margin: 0 0 16px;
    padding: 12px 16px;
    border-left: 3px solid var(--bad);
    color: var(--bad);
  }
  .timeline {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .timeline li {
    display: flex;
    flex-direction: column;
    padding: 8px 0;
    border-top: 1px solid var(--line-2);
  }
  .timeline li:first-child {
    border-top: 0;
  }
  @media (max-width: 1000px) {
    .layout {
      grid-template-columns: 1fr;
    }
  }
</style>
