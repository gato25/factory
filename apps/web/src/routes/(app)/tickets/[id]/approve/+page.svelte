<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import Icon from '$components/Icon.svelte';
  import Markdown from '$components/Markdown.svelte';
  import ScreenGallery from '$components/ScreenGallery.svelte';
  import TicketHead from '$components/TicketHead.svelte';
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

  /** "docs/plan.md" → "plan", which is what the artboard's Edit button says. */
  const shortName = (path: string) => path.split('/').pop()?.replace(/\.\w+$/, '') ?? path;

  /** A decision is stored as a code; a person reads a word. */
  const DECISION: Record<string, string> = {
    approved: 'батлагдсан',
    changes_requested: 'өөрчлөлт хүссэн',
    cancelled: 'цуцлагдсан',
  };

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
  <p class="card">Ачааллаж байна…</p>
{:else if !view.current}
  <p class="card">Энэ даалгавар эхлээгүй байна.</p>
{:else if !detail?.ready}
  <p class="card">Хяналтын цэгийг ачааллаж байна…</p>
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
    costUsd={loaded.run.costUsd}
    status={paused
      ? { label: 'Таны баталгаажуулалт хүлээж буй', tone: 'warn' }
      : { label: 'Шийдэгдсэн', tone: 'ok' }}
  >
    {#snippet actions()}
      {#if paused && d.mayDecide}
        <form {...cancelRun}>
          <input type="hidden" name="runId" value={d.gate.runId} />
          <input type="hidden" name="stepIndex" value={d.gate.stepIndex} />
          <button class="secondary" type="submit" disabled={cancelRun.pending > 0}>
            <Icon name="circle-x" size={16} />
            <span>Ажиллагаа цуцлах</span>
          </button>
        </form>
      {/if}
      <a class="secondary" href="/tickets/{ticketId}">
        <Icon name="undo-2" size={16} />
        <span>Ажиллагаа руу буцах</span>
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
    <p class="card refused" role="alert">{refusal}</p>
  {/if}

  <!-- The banner names the checkpoint and says the pipeline is paused -->
  <section class="banner" class:decided={!paused}>
    <span class="mark"><Icon name="hand" size={22} /></span>
    <div class="tx">
      {#if paused}
        <p class="t">
          Хяналтын цэг:
          {d.gate.precedingIsDesign ? 'код бичихээс өмнө' : 'дамжлага үргэлжлэхээс өмнө'}
          {d.gate.precedingLabel ? `${shortName(d.gate.precedingLabel)}-ийн үр дүнг` : 'үүнийг'}
          хянана уу
        </p>
        <p class="s">
          {d.gate.precedingLabel ?? 'Өмнөх алхам'} ажлаа дуусгалаа. Та батлах, өөрчлөлт хүсэх, эсвэл
          баримтыг өөрөө засах хүртэл дамжлага {d.gate.stepIndex + 1}-р алхам дээр түр зогсоно
          (гүйцэтгэх үйлчилгээ барьж байна). Харин цуцлах нь орчныг суллаж, салбарыг хэвээр нь
          үлдээнэ.
        </p>
      {:else if d.gate.decided}
        <p class="t">
          Аль хэдийн шийдэгдсэн: {DECISION[d.gate.decided.decision] ?? d.gate.decided.decision}
        </p>
        <p class="s">
          {new Date(d.gate.decided.at).toLocaleString('mn-MN')}-нд. Энд хүлээгдэж буй зүйл алга.
        </p>
      {:else}
        <p class="t">Энэ ажиллагаа хяналтын цэгт хүлээгээгүй байна</p>
        <p class="s">Энд шийдэх зүйл алга.</p>
      {/if}
    </div>

    {#if paused}
      <div class="btns">
        {#if !d.mayDecide}
          <!-- Readable by anyone; decidable only by the gate's approvers (FR-064) -->
          <p class="s">Энэ хяналтын цэгийг та шийдэхгүй. Гэхдээ бүгдийг нь эндээс уншиж болно.</p>
        {:else}
          <!-- Submits the feedback box in the side column: one form, two
               places to press it. An empty note is refused by the server,
               which says what is missing better than a disabled button. -->
          <button
            class="secondary"
            type="submit"
            form="request-changes"
            disabled={requestChanges.pending > 0}
          >
            <Icon name="message-square" size={16} />
            <span>Өөрчлөлт хүсэх</span>
          </button>
          <form {...approve} class="inline">
            <input type="hidden" name="runId" value={d.gate.runId} />
            <input type="hidden" name="stepIndex" value={d.gate.stepIndex} />
            <button class="go" type="submit" disabled={approve.pending > 0}>
              <Icon name="check" size={16} />
              <span>Батлаад үргэлжлүүлэх</span>
            </button>
          </form>
        {/if}
      </div>
    {/if}
  </section>

  {#each [...approve.fields.allIssues() ?? [], ...(requestChanges.fields.allIssues() ?? [])] as issue (issue.message)}
    <p class="card refused" role="alert">{issue.message}</p>
  {/each}

  <!--
    A gate after a design step is a design review, and has a screen of its
    own that shows the screens properly (FR-064d).
  -->
  {#if d.gate.precedingIsDesign}
    <p class="card notice">
      Энэ хяналтын цэг дизайн алхмын дараа ирлээ.
      Дэлгэцүүдийг бүтэн хэмжээгээр нь харахын тулд
      <a href="/tickets/{ticketId}/design">дэлгэцүүдийг хянана уу</a>.
    </p>
  {/if}

  <div class="lower">
    <section class="doc">
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
              {#if item.editedByHuman}<span class="edited">засварласан</span>{/if}
            </button>
          {/each}
        </div>

        {#if openPath && openDoc?.ready && !editing}
          <div class="head-actions">
            <button type="button" class="link" onclick={() => (source = !source)}>
              {source ? 'Эмхэтгэсэн' : 'Эх бичвэр'}
            </button>
            {#if d.mayDecide && paused}
              <button
                type="button"
                class="secondary"
                onclick={() => {
                  draft = '';
                  editing = true;
                }}
              >
                <Icon name="pencil" size={16} />
                <span>{shortName(openPath)} засах</span>
              </button>
            {/if}
          </div>
        {/if}
      </header>

      <div class="doc-body">
        {#if screens.length > 0}
          <div class="screens"><ScreenGallery {screens} heading="Дэлгэцүүд" /></div>
        {/if}

        {#if readable.length === 0}
          <p class="quiet">Хараахан баримт алга — одоогоор дээрх дэлгэцүүд л байна.</p>
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
                <button type="button" class="secondary" onclick={() => (editing = false)}>
                  Өөрчлөлтийг болих
                </button>
                <button class="go" type="submit" disabled={!d.mayDecide}>
                  <Icon name="check" size={16} />
                  <span>Хадгалаад үргэлжлүүлэх</span>
                </button>
              </div>
              <p class="quiet">
                Хадгалахад шинэ хувилбар үүснэ. Өмнөх нь хадгалагдах бөгөөд үүний дараах алхам бүр
                таны хадгалсан хувилбарыг уншина.
              </p>
            </form>
          {:else if source}
            <pre>{openDoc.current.content ?? '(хоосон)'}</pre>
          {:else}
            <Markdown source={openDoc.current.content ?? ''} />
          {/if}
          <p class="quiet">Хувилбар {openDoc.current.version}</p>
        {:else if openPath}
          <p class="quiet">Ачааллаж байна…</p>
        {:else}
          <p class="quiet">Уншихын тулд баримтаа сонгоно уу.</p>
        {/if}
      </div>
    </section>

    <aside class="side">
      {#if paused && d.mayDecide}
        <section class="card">
          <h2>Өөрчлөлт хүсэх</h2>
          <p class="quiet">
            Таны тэмдэглэл {d.gate.precedingLabel ?? 'өмнөх алхам'} руу буцаж, бичсэнээ засаад дахин
            энд зогсоно.
          </p>
          <form {...requestChanges} id="request-changes" class="stack">
            <input type="hidden" name="runId" value={d.gate.runId} />
            <input type="hidden" name="stepIndex" value={d.gate.stepIndex} />
            <textarea
              name="feedback"
              rows="5"
              bind:value={draft}
              aria-label="Өөрчлөлт хүсэх — энэ бичвэр агент руу илгээгдэнэ"
              placeholder="Юу өөрчлөгдөх ёстой вэ, яагаад?"
            ></textarea>
            <button class="secondary wide" type="submit" disabled={requestChanges.pending > 0}>
              <Icon name="undo-2" size={16} />
              <span>{d.gate.precedingLabel ?? 'Агент'} руу буцаах</span>
            </button>
          </form>
        </section>
      {/if}

      <section class="card">
        <h2>Хүлээн авах шалгуур</h2>
        {#if d.ticket.acceptanceCriteria.length === 0}
          <p class="quiet">Нэг ч өгөгдөөгүй. Энэ бол чанарын хамгийн хүчтэй хөшүүрэг юм.</p>
        {:else}
          <ul class="criteria">
            {#each d.ticket.acceptanceCriteria as criterion (criterion)}
              <li>{criterion}</li>
            {/each}
          </ul>
        {/if}
        {#if d.ticket.uiRationale}
          <p class="quiet">
            {d.ticket.hasUi ? 'Интерфейсийн ажил' : 'Интерфейсийн ажил биш'} гэж ангилсан —
            {d.ticket.uiRationale}
          </p>
        {/if}
      </section>

      <section class="card">
        <h2>Явц</h2>
        <ol class="timeline">
          {#each d.timeline as entry (entry.at.toString() + entry.label)}
            <li class={entry.kind}>
              <Icon
                name={entry.kind === 'decision' ? 'circle-check' : 'check'}
                size={15}
              />
              <span class="what">
                {entry.label}
                {#if entry.detail}<span class="quiet">{entry.detail}</span>{/if}
              </span>
              <time>{new Date(entry.at).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })}</time>
            </li>
          {/each}
          {#if paused}
            <li class="now">
              <Icon name="hand" size={15} />
              <span class="what">Баталгаажуулалт хүлээж буй{d.mayDecide ? ' (та)' : ''}</span>
              <time></time>
            </li>
          {/if}
        </ol>
      </section>
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
  .tx {
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
  .inline {
    display: contents;
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
  button.link {
    padding: 0;
    border: 0;
    background: none;
    font-size: 12px;
    font-weight: 500;
    color: var(--accent-text);
  }
  button.link:hover {
    text-decoration: underline;
  }

  /* ---- the document ---- */
  .lower {
    display: flex;
    align-items: flex-start;
    gap: 24px;
  }
  .doc {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
    background: var(--surface);
    border: 1px solid var(--card-border);
    border-radius: var(--r-lg);
    box-shadow: 0 1px 2px #0f172a0a;
    overflow: hidden;
  }
  .doc > header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 10px 16px;
    border-bottom: 1px solid var(--border);
  }
  .tabs {
    display: flex;
    gap: 4px;
    flex-wrap: wrap;
  }
  .tabs button {
    padding: 6px 12px;
    border: 0;
    border-radius: var(--r-sm);
    background: none;
    font-size: 13px;
    font-weight: 500;
    color: var(--text-2);
  }
  .tabs button.on {
    background: var(--accent-soft);
    color: var(--accent-text);
  }
  .edited {
    margin-left: 6px;
    padding: 1px 6px;
    border-radius: 999px;
    background: var(--surface-2);
    font-size: 11px;
    color: var(--text-3);
  }
  .head-actions {
    display: flex;
    align-items: center;
    gap: 12px;
    flex: none;
  }

  .doc-body {
    padding: 16px 20px 20px;
    overflow-y: auto;
    max-height: 70vh;
  }
  .screens {
    margin-bottom: 16px;
  }
  .doc-body pre {
    margin: 0;
    padding: 14px;
    border-radius: var(--r-sm);
    background: var(--code-bg);
    color: var(--code-text);
    font-family: var(--font-mono);
    font-size: 12px;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .edit {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  /* ---- the side ---- */
  .side {
    display: flex;
    flex-direction: column;
    gap: 16px;
    width: 360px;
    flex: none;
  }
  .card {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 16px;
    background: var(--surface);
    border: 1px solid var(--card-border);
    border-radius: var(--r-lg);
    box-shadow: 0 1px 2px #0f172a0a;
  }
  .card h2 {
    margin: 0;
    font-family: var(--font-head);
    font-size: 15px;
    font-weight: 600;
    color: var(--text);
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

  .stack {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .criteria {
    margin: 0;
    padding-left: 18px;
    font-size: 13px;
    color: var(--text-2);
  }
  .criteria li {
    margin: 3px 0;
  }

  .timeline {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
  }
  .timeline li {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 7px 0;
    border-top: 1px solid var(--border);
    font-size: 13px;
    color: var(--text);
  }
  .timeline li:first-child {
    border-top: 0;
  }
  .timeline :global(svg) {
    color: var(--success);
    flex: none;
  }
  .timeline li.now :global(svg) {
    color: var(--warning);
  }
  .what {
    display: flex;
    flex-direction: column;
    gap: 1px;
    flex: 1;
    min-width: 0;
  }
  .timeline time {
    font-size: 11px;
    color: var(--text-3);
    flex: none;
  }

  .quiet {
    margin: 0;
    font-size: 12px;
    color: var(--text-2);
  }
  .refused {
    border-left: 3px solid var(--danger);
    margin: 0 0 16px;
    padding: 12px 16px;
    color: var(--danger);
  }
  .notice {
    border-left: 3px solid var(--accent);
    margin: 0 0 16px;
    padding: 12px 16px;
  }
  .errors {
    margin: 0;
    padding-left: 18px;
    color: var(--danger);
  }
  .row {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
  }

  @media (max-width: 1100px) {
    .lower {
      flex-direction: column;
    }
    .side {
      width: auto;
    }
    .banner {
      flex-wrap: wrap;
    }
  }
</style>
