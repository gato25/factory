<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import Icon from '$components/Icon.svelte';
  import ScreenGallery from '$components/ScreenGallery.svelte';
  import TicketHead from '$components/TicketHead.svelte';
  import { subscribeToRun } from '$lib/events/subscribe';
  import { approve, cancelRun, design, requestChanges } from '$lib/remote/approvals.remote';
  import { runForTicket } from '$lib/remote/runs.remote';

  /**
   * Screen 14 — Design Review, built to `design.pen`: the shared ticket head,
   * an amber banner carrying the two decisions, the screens as a gallery, and
   * a 340px column saying why the design step ran at all, what to check the
   * screens against, and what happens after you approve.
   *
   * A gate after a design step shows every screen as an image openable at
   * full size, the criteria beside them, why the ticket was classified as
   * interface work, and that no code has been written yet (FR-064d). It also
   * offers a link that opens the committed design source (FR-064e).
   */
  const ticketId = $derived(page.params.id as string);
  const view = $derived(runForTicket(ticketId));

  const target = $derived(
    view.ready && view.current
      ? { runId: view.current.run.id, stepIndex: view.current.run.currentStepIndex ?? 0 }
      : null,
  );
  const review = $derived(target ? design(target) : null);

  /** The steps after the gate, which is what approving sets going. */
  const next = $derived(
    view.ready && view.current && review?.ready
      ? view.current.steps.filter((step) => step.index > review.current.gate.stepIndex)
      : [],
  );

  const KIND_ICON: Record<string, string> = {
    agent: 'bot',
    design: 'palette',
    checkpoint: 'hand',
    shell: 'terminal',
    notify: 'bell',
  };

  onMount(() => {
    let stop = () => {};
    void runForTicket(ticketId).then((loaded) => {
      if (!loaded) return;
      stop = subscribeToRun({
        target: loaded.run.id,
        onEvent: () => {
          void runForTicket(ticketId).refresh();
          if (target) void design(target).refresh();
        },
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
  {@const loaded = view.current}
  {@const paused = loaded.run.status === 'waiting_approval'}
  {@const step = loaded.steps.find((row) => row.index === d.gate.precedingStepIndex)}

  <TicketHead
    {ticketId}
    repositoryName={loaded.repository.name}
    reference={d.ticket.reference}
    title={d.ticket.title}
    branchName={loaded.ticket.branchName}
    createdByName={loaded.ticket.createdByName}
    startedAt={loaded.run.startedAt}
    costUsd={loaded.run.costUsd}
    status={paused
      ? { label: 'Waiting for design approval', tone: 'warn' }
      : { label: 'Decided', tone: 'ok' }}
  >
    {#snippet actions()}
      {#if paused && d.mayDecide}
        <form {...cancelRun}>
          <input type="hidden" name="runId" value={d.gate.runId} />
          <input type="hidden" name="stepIndex" value={d.gate.stepIndex} />
          <button class="secondary" type="submit">
            <Icon name="circle-x" size={16} />
            <span>Cancel run</span>
          </button>
        </form>
      {/if}
      <a class="secondary" href="/tickets/{ticketId}">
        <Icon name="undo-2" size={16} />
        <span>Back to the run</span>
      </a>
    {/snippet}
  </TicketHead>

  {@const refusal =
    approve.result?.problem ?? requestChanges.result?.problem ?? cancelRun.result?.problem}
  {#if refusal}
    <p class="card refused" role="alert">{refusal}</p>
  {/if}

  <section class="banner" class:decided={!paused}>
    <span class="mark"><Icon name="palette" size={22} /></span>
    <div class="tx">
      {#if paused}
        <p class="t">Checkpoint: review the screens before any code is written</p>
        <p class="s">
          The design step produced {d.screens.length} screen{d.screens.length === 1 ? '' : 's'}
          with the pen.dev CLI.
          {#if d.noCodeYet}Nothing has been implemented yet.{/if}
          {#if next[0]}{`Approve to continue to ${next[0].label}.`}{/if}
        </p>
      {:else if d.gate.decided}
        <p class="t">Already decided: {d.gate.decided.decision.replace('_', ' ')}</p>
        <p class="s">On {new Date(d.gate.decided.at).toLocaleString()}. Nothing is waiting here.</p>
      {:else}
        <p class="t">This run is not waiting at a design checkpoint</p>
        <p class="s">Nothing here needs deciding.</p>
      {/if}
    </div>

    {#if paused}
      <div class="btns">
        {#if !d.mayDecide}
          <!-- Readable by anyone; decidable only by the gate's approvers (FR-064) -->
          <p class="s">This checkpoint is not yours to decide. You can read everything here.</p>
        {:else}
          <button
            class="secondary"
            type="submit"
            form="request-changes"
            disabled={requestChanges.pending > 0}
          >
            <Icon name="message-square" size={16} />
            <span>Request changes</span>
          </button>
          <form {...approve}>
            <input type="hidden" name="runId" value={d.gate.runId} />
            <input type="hidden" name="stepIndex" value={d.gate.stepIndex} />
            <button class="go" type="submit" disabled={approve.pending > 0}>
              <Icon name="check" size={16} />
              <span>Approve &amp; continue</span>
            </button>
          </form>
        {/if}
      </div>
    {/if}
  </section>

  {#each [...(approve.fields.allIssues() ?? []), ...(requestChanges.fields.allIssues() ?? [])] as issue (issue.message)}
    <p class="card refused" role="alert">{issue.message}</p>
  {/each}

  <div class="lower">
    <section class="card gallery">
      <header class="gh">
        <div class="l">
          <h2>Screens</h2>
          <span class="badge pink">
            <span class="dot"></span>
            {d.screens.length} exported
          </span>
        </div>
        {#if d.designSource}
          <div class="r">
            {#if d.designSource.url}
              <!-- The committed source, openable where it lives (FR-064e) -->
              <a
                class="secondary"
                href={d.designSource.url}
                title={d.designSource.path}
                target="_blank"
                rel="noreferrer noopener"
              >
                <Icon name="external-link" size={16} />
                <span>Open the design source</span>
              </a>
            {:else}
              <span class="quiet">
                {d.designSource.path} is committed to the branch; this repository's address is not
                one we can build a file link for.
              </span>
            {/if}
          </div>
        {/if}
      </header>

      <ScreenGallery
        screens={d.screens}
        heading="Designed screens"
        note="Each one opens at full size. Use the arrow keys to move between them."
      />
    </section>

    <aside class="side">
      <!-- Why the design step ran at all (FR-100) -->
      <section class="card">
        <div class="sh">
          <Icon name="palette" size={16} />
          <h3>Why this ticket was designed</h3>
        </div>
        {#if d.ticket.uiRationale}
          <p class="quote">“{d.ticket.uiRationale}”</p>
          <p class="by">
            Decided by the specification step · classified as
            {d.ticket.hasUi ? 'interface work' : 'not interface work'}
          </p>
        {:else if d.ticket.classificationMissing}
          <p class="quiet warn-text">
            The specification step produced no usable decision about whether this ticket changes
            the interface, so it was treated as not changing it.
          </p>
        {:else}
          <p class="quiet">No reason was recorded.</p>
        {/if}
      </section>

      <!-- The criteria beside the screens, so they are read together (FR-064d) -->
      <section class="card">
        <h3>Check the screens against</h3>
        {#if d.ticket.acceptanceCriteria.length === 0}
          <p class="quiet">None were given. That is the biggest quality lever there is.</p>
        {:else}
          <ul class="criteria">
            {#each d.ticket.acceptanceCriteria as criterion (criterion)}
              <li><Icon name="square-check" size={14} /><span>{criterion}</span></li>
            {/each}
          </ul>
        {/if}
      </section>

      {#if paused && d.mayDecide}
        <section class="card">
          <h3>Request changes</h3>
          <p class="quiet">
            The design is revised rather than redrawn, and comes back here.
          </p>
          <form {...requestChanges} id="request-changes" class="stack">
            <input type="hidden" name="runId" value={d.gate.runId} />
            <input type="hidden" name="stepIndex" value={d.gate.stepIndex} />
            <textarea
              name="feedback"
              rows="4"
              aria-label="Request changes — this text is sent to the design tool"
              placeholder="What should change, and why?"
            ></textarea>
            <button class="secondary wide" type="submit" disabled={requestChanges.pending > 0}>
              <Icon name="undo-2" size={16} />
              <span>Send back to the design step</span>
            </button>
          </form>
        </section>
      {/if}

      {#if next.length > 0}
        <section class="card">
          <h3>After you approve</h3>
          {#each next as row (row.index)}
            <div class="n">
              <span class="ic"><Icon name={KIND_ICON[row.type] ?? 'bot'} size={13} /></span>
              <span class="tx">
                <span class="t">{row.label}</span>
                {#if row.model}<span class="s">{row.model}</span>{/if}
              </span>
            </div>
          {/each}
          <div class="n">
            <span class="ic ok"><Icon name="git-pull-request" size={13} /></span>
            <span class="tx">
              <span class="t">Open merge request</span>
              <span class="s">Branch pushed, merge request created, ticket closed</span>
            </span>
          </div>
        </section>
      {/if}

      {#if step}
        <p class="quiet foot">
          The design step took {step.durationS ?? 0}s and cost ${step.costUsd}.
        </p>
      {/if}
    </aside>
  </div>
{/if}

<style>
  /* ---- the banner ---- */
  .banner {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 16px 20px;
    border-radius: var(--r-lg);
    background: var(--warning-soft);
    margin-bottom: 16px;
  }
  .banner.decided {
    background: var(--surface-2);
  }
  .mark {
    display: grid;
    place-items: center;
    flex: none;
    color: var(--warning);
  }
  .banner.decided .mark {
    color: var(--text-3);
  }
  .banner .tx {
    display: flex;
    flex-direction: column;
    gap: 3px;
    flex: 1;
    min-width: 0;
  }
  .t {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
    color: var(--text);
  }
  .s {
    margin: 0;
    font-size: 12px;
    color: var(--text-2);
  }
  .btns {
    display: flex;
    align-items: center;
    gap: 10px;
    flex: none;
  }

  /* ---- buttons ---- */
  button,
  a.secondary {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 10px 16px;
    border-radius: var(--r-sm);
    font: inherit;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    text-decoration: none;
  }
  .secondary {
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text);
  }
  .secondary :global(svg) {
    color: var(--text-2);
  }
  .secondary:hover:not(:disabled) {
    border-color: var(--accent);
  }
  .secondary.wide {
    width: 100%;
  }
  /* Approve is the one button that lets work continue. */
  .go {
    border: 1px solid var(--success);
    background: var(--success);
    color: var(--text-inv);
    font-weight: 600;
  }
  button:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  /* ---- layout ---- */
  .lower {
    display: flex;
    align-items: flex-start;
    gap: 24px;
  }
  .card {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 16px;
    background: var(--surface);
    border: 1px solid var(--card-border);
    border-radius: var(--r-lg);
    box-shadow: 0 1px 2px #0f172a0a;
  }
  .gallery {
    flex: 1;
    min-width: 0;
  }
  /* The gallery brings its own card; inside this one it steps out of the way. */
  .gallery :global(.card) {
    padding: 0;
    border: 0;
    box-shadow: none;
    background: none;
  }
  .side {
    display: flex;
    flex-direction: column;
    gap: 16px;
    width: 340px;
    flex: none;
  }

  .gh {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    flex-wrap: wrap;
  }
  .gh .l {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .gh .r {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  h2 {
    margin: 0;
    font-family: var(--font-head);
    font-size: 16px;
    font-weight: 600;
    color: var(--text);
  }
  h3 {
    margin: 0;
    font-family: var(--font-head);
    font-size: 14px;
    font-weight: 600;
    color: var(--text);
  }
  .sh {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .sh :global(svg) {
    color: var(--design);
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
  .badge.pink {
    background: var(--design-soft);
    color: var(--design);
  }
  .dot {
    width: 6px;
    height: 6px;
    border-radius: 999px;
    background: currentcolor;
    flex: none;
  }

  .quote {
    margin: 0;
    font-size: 13px;
    line-height: 1.6;
    color: var(--text-2);
  }
  .by {
    margin: 0;
    font-size: 11px;
    color: var(--text-3);
  }

  .criteria {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .criteria li {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    font-size: 13px;
    color: var(--text-2);
  }
  .criteria :global(svg) {
    color: var(--text-3);
    flex: none;
    margin-top: 2px;
  }

  .n {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .n .ic {
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    border-radius: 6px;
    background: var(--surface-2);
    color: var(--text-2);
    flex: none;
  }
  .n .ic.ok {
    background: var(--success-soft);
    color: var(--success);
  }
  .n .tx {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }
  .n .t {
    font-size: 13px;
    font-weight: 500;
    color: var(--text);
  }
  .n .s {
    font-size: 11px;
    color: var(--text-3);
  }

  .stack {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  textarea {
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: var(--surface);
    font: inherit;
    font-size: 13px;
    width: 100%;
    resize: vertical;
  }

  .quiet {
    margin: 0;
    font-size: 12px;
    color: var(--text-2);
  }
  .warn-text {
    color: var(--warning);
  }
  .foot {
    text-align: right;
    color: var(--text-3);
  }
  .refused {
    border-left: 3px solid var(--danger);
    margin: 0 0 16px;
    padding: 12px 16px;
    color: var(--danger);
  }
  .failure {
    border-left: 3px solid var(--danger);
    padding: 12px 16px;
    color: var(--danger);
  }

  @media (max-width: 1100px) {
    .lower {
      flex-direction: column;
    }
    .side {
      width: auto;
      align-self: stretch;
    }
    .banner {
      flex-wrap: wrap;
    }
  }
</style>
