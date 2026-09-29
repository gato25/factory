<script lang="ts">
  import { compactTokens } from '@factory/shared';
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import Icon from '$components/Icon.svelte';
  import { exact } from '$lib/format';
  import { duration } from '$lib/step-kind';
  import { m } from '$lib/i18n';
  import ScreenGallery from '$components/ScreenGallery.svelte';
  import TicketHead from '$components/TicketHead.svelte';
  import { agentName, stepTitle } from '$lib/default-names';
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

  /** The same file, as the provider serves it to download rather than to view. */
  const rawUrl = (url: string) => url.replace('/-/blob/', '/-/raw/').replace(/\/blob\//, '/raw/');

  const KIND_ICON: Record<string, string> = {
    agent: 'bot',
    design: 'pen-tool',
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
  <p class="tile">{m.designReview.loading}</p>
{:else if !view.current}
  <p class="tile">{m.designReview.notStarted}</p>
{:else if review?.error}
  <p class="tile tile--danger refused" role="alert">{(review.error as Error).message}</p>
{:else if !review?.ready}
  <p class="tile">{m.designReview.loadingDesign}</p>
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
    tokens={loaded.run.tokens.total}
    status={paused
      ? { label: m.designReview.waitingForDesignApproval, tone: 'pen' }
      : { label: m.designReview.decided, tone: 'ok' }}
  >
    {#snippet actions()}
      {#if paused && d.mayDecide}
        <form {...cancelRun}>
          <input type="hidden" name="runId" value={d.gate.runId} />
          <input type="hidden" name="stepIndex" value={d.gate.stepIndex} />
          <button class="btn btn--danger-soft" type="submit" title={m.approve.cancelExplain}>
            <Icon name="circle-x" size={14} />
            {m.designReview.cancelRun}
          </button>
        </form>
      {/if}
      <a class="btn btn--secondary" href="/tickets/{ticketId}">
        <Icon name="undo-2" size={14} />
        {m.designReview.backToTheRun}
      </a>
    {/snippet}
  </TicketHead>

  {@const refusal =
    approve.result?.problem ?? requestChanges.result?.problem ?? cancelRun.result?.problem}
  {#if refusal}
    <p class="tile tile--danger refused" role="alert">{refusal}</p>
  {/if}

  <section class="tile banner" class:tile--design={paused} class:decided={!paused}>
    <span class="orb orb--pen mark" aria-hidden="true"><Icon name="images" size={22} /></span>
    <div class="tx">
      {#if paused}
        <p class="t">{m.designReview.checkpoint}</p>
        <p class="s">
          {m.designReview.producedScreens(d.screens.length)}
          {#if d.noCodeYet}{m.designReview.nothingImplemented}{/if}
          {#if next[0]}{m.designReview.approveToContinue(stepTitle(next[0]))}{/if}
        </p>
      {:else if d.gate.decided}
        <p class="t">{m.designReview.alreadyDecided(m.approve.decision[d.gate.decided.decision as keyof typeof m.approve.decision] ?? d.gate.decided.decision)}</p>
        <p class="s">{m.designReview.decidedAt(exact(d.gate.decided.at))}</p>
      {:else}
        <p class="t">{m.designReview.notAtCheckpoint}</p>
        <p class="s">{m.designReview.nothingToDecide}</p>
      {/if}
    </div>

    {#if paused}
      <div class="btns">
        {#if !d.mayDecide}
          <!-- Readable by anyone; decidable only by the gate's approvers (FR-064) -->
          <p class="s">{m.designReview.notYoursToDecide}</p>
        {:else}
          <button
            class="btn changes"
            type="submit"
            form="request-changes"
            disabled={requestChanges.pending > 0}
          >
            <Icon name="message-square" size={14} />
            {m.designReview.requestChanges}
          </button>
          <form {...approve}>
            <input type="hidden" name="runId" value={d.gate.runId} />
            <input type="hidden" name="stepIndex" value={d.gate.stepIndex} />
            <button class="btn btn--pen" type="submit" disabled={approve.pending > 0}>
              <Icon name="check" size={15} />
              {m.designReview.approveAndContinue}
            </button>
          </form>
        {/if}
      </div>
    {/if}
  </section>

  {#each [...(approve.fields.allIssues() ?? []), ...(requestChanges.fields.allIssues() ?? [])] as issue (issue.message)}
    <p class="tile tile--danger refused" role="alert">{issue.message}</p>
  {/each}

  <div class="lower">
    <section class="tile gallery">
      <header class="gh">
        <div class="l">
          <h2>{m.designReview.screens}</h2>
          <span class="exported">{m.designReview.exported(d.screens.length)}</span>
        </div>
        {#if d.designSource}
          <div class="r">
            {#if d.designSource.url}
              <!-- The committed source, openable where it lives (FR-064e) -->
              <a
                class="btn btn--pen small-btn"
                href={d.designSource.url}
                title={d.designSource.path}
                target="_blank"
                rel="noreferrer noopener"
              >
                <Icon name="pen-tool" size={13} />
                {m.designReview.openDesignSource}
              </a>
              <a
                class="btn btn--secondary small-btn"
                href={rawUrl(d.designSource.url)}
                title={d.designSource.path}
                download
                target="_blank"
                rel="noreferrer noopener"
              >
                <Icon name="download" size={13} />
                {m.designReview.downloadSource}
              </a>
            {:else}
              <span class="quiet">
                {m.designReview.sourceNotLinkable(d.designSource.path)}
              </span>
            {/if}
          </div>
        {/if}
      </header>

      <ScreenGallery
        bare
        screens={d.screens}
        heading={m.designReview.designedScreens}
        note={m.designReview.galleryNote}
      />
    </section>

    <aside class="side">
      <!-- Why the design step ran at all (FR-100) -->
      <section class="tile side-tile">
        <div class="sh">
          <Icon name="pen-tool" size={15} />
          <h3>{m.designReview.whyDesigned}</h3>
        </div>
        {#if d.ticket.uiRationale}
          <p class="quote">“{d.ticket.uiRationale}”</p>
          <p class="by">
            {m.designReview.decidedBySpec(
              d.ticket.hasUi ? m.designReview.interfaceWork : m.designReview.notInterfaceWork,
            )}
          </p>
        {:else if d.ticket.classificationMissing}
          <p class="quiet warn-text">
            {m.designReview.classificationMissing}
          </p>
        {:else}
          <p class="quiet">{m.designReview.noReason}</p>
        {/if}
      </section>

      <!-- The criteria beside the screens, so they are read together (FR-064d) -->
      <section class="tile side-tile">
        <h3>{m.designReview.checkAgainst}</h3>
        {#if d.ticket.acceptanceCriteria.length === 0}
          <p class="quiet">{m.designReview.noAcceptance}</p>
        {:else}
          <ul class="criteria">
            {#each d.ticket.acceptanceCriteria as criterion (criterion)}
              <li><span class="check" aria-hidden="true"><Icon name="check" size={11} /></span><span>{criterion}</span></li>
            {/each}
          </ul>
        {/if}
      </section>

      {#if paused && d.mayDecide}
        <section class="tile side-tile">
          <h3>{m.designReview.requestChanges}</h3>
          <p class="quiet">
            {m.designReview.revisedNotRedrawn}
          </p>
          <form {...requestChanges} id="request-changes" class="stack">
            <input type="hidden" name="runId" value={d.gate.runId} />
            <input type="hidden" name="stepIndex" value={d.gate.stepIndex} />
            <textarea
              name="feedback"
              rows="4"
              aria-label={m.designReview.feedbackLabel}
              placeholder={m.designReview.feedbackPlaceholder}
            ></textarea>
            <button class="btn btn--pen wide" type="submit" disabled={requestChanges.pending > 0}>
              <Icon name="undo-2" size={15} />
              {m.designReview.sendBackToDesign}
            </button>
          </form>
        </section>
      {/if}

      {#if next.length > 0}
        <section class="tile side-tile">
          <h3>{m.designReview.afterYouApprove}</h3>
          {#each next as row (row.index)}
            <div class="n">
              <span class="orb orb--sm ic" aria-hidden="true"><Icon name={KIND_ICON[row.type] ?? 'bot'} size={14} /></span>
              <span class="tx">
                <span class="t">{row.type === 'agent' || row.type === 'design' ? agentName(row.label) : stepTitle(row)}</span>
                {#if row.model}<span class="s">{row.model}</span>{/if}
              </span>
            </div>
          {/each}
          <div class="n">
            <span class="orb orb--sm orb--mint ic" aria-hidden="true"><Icon name="git-pull-request" size={14} /></span>
            <span class="tx">
              <span class="t">{m.designReview.openMergeRequest}</span>
              <span class="s">{m.designReview.openMergeRequestNote}</span>
            </span>
          </div>
        </section>
      {/if}

      {#if step}
        <p class="quiet foot">
          {step.tokens
            ? m.designReview.stepCost(duration(step.durationS ?? 0), compactTokens(step.tokens))
            : m.designReview.stepTook(duration(step.durationS ?? 0))}
        </p>
      {/if}
    </aside>
  </div>
{/if}

<style>
  /* ---- the banner: pen.dev's checkpoint, and the two decisions ---- */
  .banner {
    display: flex;
    align-items: center;
    gap: 18px;
    margin-bottom: 20px;
    padding: 22px 26px;
  }
  .mark {
    width: 52px;
    height: 52px;
  }
  .banner.decided .mark {
    color: var(--text-3);
    background: var(--surface-2);
    box-shadow: none;
  }
  .banner .tx {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 5px;
    min-width: 0;
  }
  .banner .t {
    margin: 0;
    font-family: var(--font-head);
    font-size: 19px;
    font-weight: 600;
    letter-spacing: -0.3px;
    color: #173b7a;
  }
  .banner .s {
    margin: 0;
    font-size: var(--type-body);
    color: #2f5596;
  }
  .decided .t {
    color: var(--text);
  }
  .decided .s {
    color: var(--text-2);
  }
  .btns {
    display: flex;
    flex: none;
    align-items: center;
    gap: 10px;
  }
  .btns form {
    display: contents;
  }
  .btn.changes {
    color: #173b7a;
    background: #f4f8feb3;
    box-shadow: none;
  }
  :global(.btn.btn--danger-soft) {
    padding: 10px 14px;
    color: var(--danger-text);
    background: var(--danger-soft);
    box-shadow: none;
  }
  .btn.wide {
    width: 100%;
  }
  .small-btn {
    padding: 8px 12px;
    border-radius: 11px;
    font-size: var(--type-caption);
    font-weight: 700;
  }

  /* ---- the screens, and the column beside them ---- */
  .lower {
    display: flex;
    align-items: flex-start;
    gap: 20px;
  }
  .gallery {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 16px;
    min-width: 0;
    padding: 22px;
  }
  .gh {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 12px;
  }
  .gh .l,
  .gh .r {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .gh h2 {
    margin: 0;
    font-size: 18px;
    font-weight: 600;
    letter-spacing: -0.3px;
  }
  .exported {
    padding: 3px 9px;
    border-radius: var(--r-pill);
    font-size: var(--type-caption);
    font-weight: 700;
    color: var(--pen-text);
    background: var(--purple-soft);
  }

  .side {
    display: flex;
    flex: none;
    flex-direction: column;
    gap: 20px;
    width: 400px;
  }
  .side-tile {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 22px;
  }
  .sh {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--purple);
  }
  h3 {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
    letter-spacing: -0.2px;
    color: var(--text);
  }
  .quote {
    margin: 0;
    font-size: var(--type-body);
    line-height: 1.5;
  }
  .by {
    margin: 0;
    font: 12px/1.4 var(--font-mono);
    color: var(--text-3);
  }
  .criteria {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .criteria li {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: var(--type-body);
  }
  .check {
    display: grid;
    flex: none;
    place-items: center;
    width: 18px;
    height: 18px;
    border-radius: 6px;
    color: var(--text-inv);
    background: linear-gradient(180deg, var(--mint-from), var(--mint-to));
  }
  textarea {
    width: 100%;
    padding: 14px;
    border: 0;
    border-radius: 14px;
    font: var(--type-body) / 1.5 var(--font);
    color: var(--text);
    background: var(--surface-2);
    box-shadow: inset 0 1px 3px #3a2a1a1a;
    resize: vertical;
  }
  .stack {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .n {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .n + .n {
    padding-top: 6px;
  }
  .ic {
    width: 30px;
    height: 30px;
    box-shadow: none;
  }
  .n .tx {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .n .t {
    font-size: var(--type-body);
    font-weight: 600;
  }
  .n .s {
    font-size: var(--type-caption);
    color: var(--text-2);
  }
  .quiet {
    margin: 0;
    font-size: var(--type-body);
    color: var(--text-2);
  }
  .warn-text {
    color: var(--danger-text);
  }
  .foot {
    padding: 0 6px;
    font-size: var(--type-caption);
  }
  .refused {
    margin: 0 0 20px;
    padding: 14px 20px;
    color: var(--danger-text);
  }

  @media (max-width: 1100px) {
    .lower {
      flex-direction: column;
      align-items: stretch;
    }
    .side {
      width: 100%;
    }
    .banner {
      flex-wrap: wrap;
    }
  }
</style>
