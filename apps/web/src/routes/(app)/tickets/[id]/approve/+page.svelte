<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import Icon from '$components/Icon.svelte';
  import { exact } from '$lib/format';
  import { m } from '$lib/i18n';
  import Markdown from '$components/Markdown.svelte';
  import ScreenGallery from '$components/ScreenGallery.svelte';
  import TicketHead from '$components/TicketHead.svelte';
  import { agentName, stepName } from '$lib/default-names';
  import {
    approve,
    cancelRun,
    document as documentQuery,
    editAndApprove,
    gate,
    requestChanges,
  } from '$lib/remote/approvals.remote';
  import { subscribeToRun } from '$lib/events/subscribe';
  import { runForTicket } from '$lib/remote/runs.remote';

  /**
   * Screen 07 — Approval Checkpoint, built to `design.pen`: the same ticket
   * head as the run, an amber banner naming the checkpoint and carrying the
   * two decisions, then the document with a tab per artefact beside a 360px
   * column holding the feedback box and the timeline.
   *
   * Approve is green rather than blue: it is the one button here that lets
   * work continue, and the artboard colours it as such.
   */
  const ticketId = $derived(page.params.id as string);
  const view = $derived(runForTicket(ticketId));

  let openPath = $state<string | null>(null);
  let editing = $state(false);
  let draft = $state('');
  let source = $state(false);

  const target = $derived(
    view.ready && view.current
      ? { runId: view.current.run.id, stepIndex: view.current.run.currentStepIndex ?? 0 }
      : null,
  );
  const detail = $derived(target ? gate(target) : null);
  const openDoc = $derived(
    detail?.ready && openPath
      ? documentQuery(detail.current.artifacts.find((a) => a.path === openPath)?.id ?? '')
      : null,
  );

  /** "docs/plan.md" → "plan", for a document the product does not name. */
  const shortName = (path: string) => path.split('/').pop()?.replace(/\.\w+$/, '') ?? path;

  /** What the artboard's Edit button calls a document: "Төлөвлөгөө засах". */
  const DOCUMENT: Record<string, string> = {
    'spec.md': m.defaults.agents.spec.step,
    'plan.md': m.defaults.agents.plan.step,
    'tasks.md': m.defaults.agents.tasks.step,
  };
  const documentName = (path: string) => DOCUMENT[path.split('/').pop() ?? path] ?? shortName(path);

  /** The first readable document, so the screen opens on something. */
  $effect(() => {
    if (!detail?.ready || openPath !== null) return;
    const first = detail.current.artifacts.find((a) => a.kind !== 'screen');
    if (first) openPath = first.path;
  });

  onMount(() => {
    let stop = () => {};
    void runForTicket(ticketId).then((loaded) => {
      if (!loaded) return;
      stop = subscribeToRun({
        target: loaded.run.id,
        onEvent: () => {
          void runForTicket(ticketId).refresh();
          if (target) void gate(target).refresh();
        },
      });
    });
    return () => stop();
  });
</script>

{#if !view.ready}
  <p class="tile">{m.approve.loading}</p>
{:else if !view.current}
  <p class="tile">{m.approve.notStarted}</p>
{:else if !detail?.ready}
  <p class="tile">{m.approve.loadingCheckpoint}</p>
{:else}
  {@const d = detail.current}
  {@const loaded = view.current}
  {@const paused = loaded.run.status === 'waiting_approval'}
  {@const screens = d.artifacts.filter((a) => a.kind === 'screen')}
  {@const readable = d.artifacts.filter((a) => a.kind !== 'screen')}

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
      ? { label: m.approve.waitingForYourApproval, tone: 'warn' }
      : { label: m.approve.decided, tone: 'ok' }}
  >
    {#snippet actions()}
      {#if paused && d.mayDecide}
        <form {...cancelRun}>
          <input type="hidden" name="runId" value={d.gate.runId} />
          <input type="hidden" name="stepIndex" value={d.gate.stepIndex} />
          <button
            class="btn btn--danger-soft"
            type="submit"
            title={m.approve.cancelExplain}
            disabled={cancelRun.pending > 0}
          >
            <Icon name="circle-x" size={14} />
            {m.approve.cancelRun}
          </button>
        </form>
      {/if}
      <a class="btn btn--secondary" href="/tickets/{ticketId}">
        <Icon name="undo-2" size={14} />
        {m.approve.backToTheRun}
      </a>
    {/snippet}
  </TicketHead>

  <!--
    A decision can be refused after the fact — someone decided first, most
    often. It is said above the banner, because a refusal usually arrives
    with the gate closing and the buttons going away.
  -->
  {@const refusal =
    approve.result?.problem ??
    requestChanges.result?.problem ??
    editAndApprove.result?.problem ??
    cancelRun.result?.problem}
  {#if refusal}
    <p class="tile tile--danger refused" role="alert">{refusal}</p>
  {/if}

  <!-- The banner names the checkpoint and says the pipeline is paused -->
  <section class="tile banner" class:tile--approval={paused} class:decided={!paused}>
    <span class="orb orb--amber mark" aria-hidden="true"><Icon name="hand" size={22} /></span>
    <div class="tx">
      {#if paused}
        <p class="t">
          {m.approve.checkpointReview(
            d.gate.precedingLabel
              ? m.approve.checkpointThe(stepName(d.gate.precedingLabel).toLowerCase())
              : m.approve.checkpointThis,
            d.gate.precedingIsDesign
              ? m.approve.beforeAnyCode
              : m.approve.beforePipelineContinues,
          )}
        </p>
        <p class="s">
          {m.approve.pausedExplain(
            d.gate.precedingLabel ? agentName(d.gate.precedingLabel) : m.approve.thePreviousStep,
            d.gate.stepIndex + 1,
          )}
        </p>
      {:else if d.gate.decided}
        <p class="t">
          {m.approve.alreadyDecided(m.approve.decision[d.gate.decided.decision as keyof typeof m.approve.decision] ?? d.gate.decided.decision)}
        </p>
        <p class="s">{m.approve.decidedAt(exact(d.gate.decided.at))}</p>
      {:else}
        <p class="t">{m.approve.notAtCheckpoint}</p>
        <p class="s">{m.approve.nothingToDecide}</p>
      {/if}
    </div>

    {#if paused}
      <div class="btns">
        {#if !d.mayDecide}
          <!-- Readable by anyone; decidable only by the gate's approvers (FR-064) -->
          <p class="s">{m.approve.notYoursToDecide}</p>
        {:else}
          <!-- Submits the feedback box in the side column: one form, two
               places to press it. An empty note is refused by the server,
               which says what is missing better than a disabled button. -->
          <button
            class="btn changes"
            type="submit"
            form="request-changes"
            disabled={requestChanges.pending > 0}
          >
            <Icon name="message-square" size={14} />
            {m.approve.requestChanges}
          </button>
          <form {...approve} class="inline">
            <input type="hidden" name="runId" value={d.gate.runId} />
            <input type="hidden" name="stepIndex" value={d.gate.stepIndex} />
            <button class="btn btn--amber" type="submit" disabled={approve.pending > 0}>
              <Icon name="check" size={15} />
              {m.approve.approveAndContinue}
            </button>
          </form>
        {/if}
      </div>
    {/if}
  </section>

  {#each [...approve.fields.allIssues() ?? [], ...(requestChanges.fields.allIssues() ?? [])] as issue (issue.message)}
    <p class="tile tile--danger refused" role="alert">{issue.message}</p>
  {/each}

  <!--
    A gate after a design step is a design review, and has a screen of its
    own that shows the screens properly (FR-064d).
  -->
  {#if d.gate.precedingIsDesign}
    <p class="tile tile--design notice">
      {m.approve.followsDesign}
      <a href="/tickets/{ticketId}/design">{m.approve.reviewTheScreens}</a>
      {m.approve.toSeeFullSize}
    </p>
  {/if}

  <div class="lower">
    <section class="tile doc">
      <header>
        <div class="tabs">
          {#each readable as item (item.id)}
            <button
              type="button"
              aria-label={item.path}
              class:on={openPath === item.path}
              onclick={() => {
                openPath = item.path;
                editing = false;
              }}
            >
              {item.path.split('/').pop()}
              {#if item.editedByHuman}<span class="edited">{m.approve.edited}</span>{/if}
            </button>
          {/each}
        </div>

        {#if openPath && openDoc?.ready && !editing}
          <div class="head-actions">
            <button type="button" class="link" onclick={() => (source = !source)}>
              {source ? m.approve.rendered : m.approve.source}
            </button>
            {#if d.mayDecide && paused}
              <button
                type="button"
                class="btn btn--secondary"
                onclick={() => {
                  draft = '';
                  editing = true;
                }}
              >
                <Icon name="pencil" size={13} />
                {m.approve.edit(documentName(openPath))}
              </button>
            {/if}
          </div>
        {/if}
      </header>

      <div class="doc-body">
        {#if screens.length > 0}
          <div class="screens"><ScreenGallery {screens} heading={m.approve.screens} /></div>
        {/if}

        {#if readable.length === 0}
          <p class="quiet">{m.approve.noDocuments}</p>
        {:else if openPath && openDoc?.ready}
          {#if editing}
            <form {...editAndApprove} class="edit">
              <input type="hidden" name="runId" value={d.gate.runId} />
              <input type="hidden" name="stepIndex" value={d.gate.stepIndex} />
              <input type="hidden" name="path" value={openPath} />
              <textarea name="content" rows="20">{openDoc.current.content ?? ''}</textarea>
              {#if editAndApprove.fields.allIssues()?.length}
                <ul class="errors" role="alert">
                  {#each editAndApprove.fields.allIssues() ?? [] as issue (issue.message)}
                    <li>{issue.message}</li>
                  {/each}
                </ul>
              {/if}
              <div class="row">
                <button type="button" class="btn btn--secondary" onclick={() => (editing = false)}>
                  {m.approve.discardChanges}
                </button>
                <button class="btn btn--amber" type="submit" disabled={!d.mayDecide}>
                  <Icon name="check" size={15} />
                  {m.approve.saveAndContinue}
                </button>
              </div>
              <p class="quiet">
                {m.approve.savingNote}
              </p>
            </form>
          {:else if source}
            <pre>{openDoc.current.content ?? m.approve.empty}</pre>
          {:else}
            <Markdown source={openDoc.current.content ?? ''} />
          {/if}
          <p class="quiet">{m.approve.version(openDoc.current.version)}</p>
        {:else if openPath}
          <p class="quiet">{m.approve.loading}</p>
        {:else}
          <p class="quiet">{m.approve.chooseDocument}</p>
        {/if}
      </div>
    </section>

    <aside class="side">
      {#if paused && d.mayDecide}
        <section class="tile side-tile">
          <h2>{m.approve.requestChanges}</h2>
          <p class="quiet">
            {m.approve.sentBackTo(
              d.gate.precedingLabel ? agentName(d.gate.precedingLabel) : m.approve.thePreviousStep,
              d.gate.precedingLabel ? stepName(d.gate.precedingLabel).toLowerCase() : m.approve.theWork,
            )}
          </p>
          <form {...requestChanges} id="request-changes" class="stack">
            <input type="hidden" name="runId" value={d.gate.runId} />
            <input type="hidden" name="stepIndex" value={d.gate.stepIndex} />
            <textarea
              name="feedback"
              rows="5"
              bind:value={draft}
              aria-label={m.approve.feedbackLabel}
              placeholder={m.approve.feedbackPlaceholder}
            ></textarea>
            <button class="btn wide" type="submit" disabled={requestChanges.pending > 0}>
              <Icon name="undo-2" size={15} />
              {m.approve.sendBackTo(d.gate.precedingLabel ? agentName(d.gate.precedingLabel) : m.approve.theAgent)}
            </button>
          </form>
        </section>
      {/if}

      <section class="tile side-tile">
        <h2>{m.approve.acceptance}</h2>
        {#if d.ticket.acceptanceCriteria.length === 0}
          <p class="quiet">{m.approve.noAcceptance}</p>
        {:else}
          <ul class="criteria">
            {#each d.ticket.acceptanceCriteria as criterion (criterion)}
              <li>{criterion}</li>
            {/each}
          </ul>
        {/if}
        {#if d.ticket.uiRationale}
          <p class="quiet">
            {m.approve.classifiedAs(
              d.ticket.hasUi ? m.approve.interfaceWork : m.approve.notInterfaceWork,
              d.ticket.uiRationale,
            )}
          </p>
        {/if}
      </section>

      <section class="tile side-tile">
        <h2>{m.approve.timeline}</h2>
        <ol class="timeline">
          {#each d.timeline as entry (entry.at.toString() + entry.label)}
            <li class={entry.kind}>
              <span class="orb ev" aria-hidden="true"><Icon name="check" size={13} /></span>
              <span class="what">
                {entry.label}
                {#if entry.detail}<span class="quiet">{entry.detail}</span>{/if}
              </span>
              <time datetime={new Date(entry.at).toISOString()}
                >{new Date(entry.at).toLocaleTimeString('en-GB', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}</time
              >
            </li>
          {/each}
          {#if paused}
            <li class="now">
              <span class="orb orb--amber ev" aria-hidden="true"><Icon name="hand" size={13} /></span>
              <span class="what"
                >{m.approve.waitingForApproval}{d.mayDecide
                  ? m.approve.waitingForApprovalYou
                  : ''}</span
              >
              <time></time>
            </li>
          {/if}
        </ol>
      </section>
    </aside>
  </div>
{/if}

<style>
  /* ---- the banner: the checkpoint, and the two decisions ---- */
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
  .tx {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 5px;
    min-width: 0;
  }
  .t {
    margin: 0;
    font-family: var(--font-head);
    font-size: 19px;
    font-weight: 600;
    letter-spacing: -0.3px;
    color: #4a3a00;
  }
  .s {
    margin: 0;
    font-size: var(--type-body);
    color: #7a6310;
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
  .inline {
    display: contents;
  }
  :global(.btn.btn--amber) {
    font-weight: 700;
    color: var(--on-amber);
    background: linear-gradient(180deg, var(--amber), #d9a200);
    box-shadow: 0 4px 12px #d9a2004d;
  }
  :global(.btn.btn--danger-soft) {
    padding: 10px 14px;
    color: var(--danger-text);
    background: var(--danger-soft);
    box-shadow: none;
  }
  .btn.changes {
    color: #4a3a00;
    background: #fffbeab3;
    box-shadow: none;
  }
  .btn.wide {
    width: 100%;
  }
  button.link {
    padding: 0;
    border: 0;
    font: 500 var(--type-body) / 1.3 var(--font);
    color: var(--accent-text);
    background: none;
    cursor: pointer;
  }
  button.link:hover {
    text-decoration: underline;
  }

  /* ---- the document and the column beside it ---- */
  .lower {
    display: flex;
    align-items: flex-start;
    gap: 20px;
  }
  .doc {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 16px;
    min-width: 0;
    padding: 0;
    overflow: hidden;
  }
  .doc > header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
    padding: 16px 20px 0;
  }
  .tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    padding: 4px;
    border-radius: 12px;
    background: var(--accent-soft);
  }
  .tabs button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 7px 14px;
    border: 0;
    border-radius: 9px;
    font: 400 var(--type-caption) / 1.3 var(--font-mono);
    color: var(--text-2);
    background: none;
    cursor: pointer;
  }
  .tabs button.on {
    font-weight: 600;
    color: var(--text);
    background: var(--surface);
    box-shadow: 0 2px 6px var(--shadow-depth);
  }
  .edited {
    padding: 1px 7px;
    border-radius: var(--r-pill);
    font: 600 var(--type-caption) / 1.3 var(--font);
    color: var(--warning-text);
    background: var(--warning-soft);
  }
  .head-actions {
    display: flex;
    align-items: center;
    gap: 14px;
  }
  .doc-body {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 4px 28px 24px;
  }
  .screens {
    margin-bottom: 8px;
  }
  .doc-body pre {
    margin: 0;
    padding: 16px;
    overflow: auto;
    border-radius: 14px;
    font: 13px/1.6 var(--font-mono);
    white-space: pre-wrap;
    color: var(--code-text);
    background: var(--code-bg);
  }
  .edit {
    display: flex;
    flex-direction: column;
    gap: 12px;
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
    gap: 12px;
  }
  .side-tile h2 {
    margin: 0;
    font-size: 18px;
    font-weight: 600;
    letter-spacing: -0.3px;
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
  .edit textarea {
    font: 13px/1.6 var(--font-mono);
  }
  .stack {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .criteria {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin: 0;
    padding-left: 18px;
  }
  .criteria li {
    font-size: var(--type-body);
    line-height: 1.5;
  }
  .timeline {
    display: flex;
    flex-direction: column;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .timeline li {
    display: flex;
    align-items: center;
    gap: 12px;
    padding-top: 14px;
  }
  .timeline li:first-child {
    padding-top: 0;
  }
  .ev {
    width: 26px;
    height: 26px;
    box-shadow: none;
  }
  .what {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    font-size: var(--type-body);
    font-weight: 500;
    line-height: 1.4;
  }
  .now .what {
    font-weight: 700;
    color: var(--warning-text);
  }
  .timeline time {
    flex: none;
    font-family: var(--font-head);
    font-size: var(--type-caption);
    font-weight: 600;
    color: var(--text-3);
  }
  .quiet {
    margin: 0;
    font-size: var(--type-body);
    color: var(--text-2);
  }
  .what .quiet {
    font-size: var(--type-caption);
  }
  .refused,
  .notice {
    margin: 0 0 20px;
    padding: 14px 20px;
  }
  .refused {
    color: var(--danger-text);
  }
  .notice {
    color: var(--pen-text);
  }
  .notice a {
    font-weight: 600;
    color: var(--pen-text);
  }
  .errors {
    margin: 0;
    padding: 12px 16px 12px 32px;
    border-radius: 12px;
    color: var(--danger-text);
    background: var(--danger-soft);
  }
  .row {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
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
