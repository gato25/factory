<script lang="ts">
  import Icon from '$components/Icon.svelte';
  import ScreenGallery from '$components/ScreenGallery.svelte';
  import { openDesign } from '$lib/remote/run-actions.remote';
  import { artifact } from '$lib/remote/runs.remote';
  import type { RunView } from '$lib/services/run-view';

  /**
   * `design.pen`'s Artifacts card: one grey row per thing the run produced,
   * with what it is under its name, and the screens as a pink block of their
   * own because they are the one kind shown as pictures (FR-077).
   *
   * A row that does not exist yet is still listed, greyed, saying when it
   * will: "Created when implement finishes" tells you nothing is missing.
   */
  let {
    artifacts,
    mergeRequestUrl,
    branchName = null,
    runId = null,
  }: {
    artifacts: RunView['artifacts'];
    mergeRequestUrl: string | null;
    branchName?: string | null;
    /** Needed to open a design: the execution service works per run. */
    runId?: string | null;
  } = $props();

  /**
   * Opening the design source in the desktop application.
   *
   * A `.pen` is the one artifact this page cannot show. The screens above are
   * pictures of it; this is the thing you edit. pen.dev registers no link a
   * browser can follow, so the execution service hands the file to whatever
   * the machine opens `.pen` with — which means this does something only
   * while that service is on the same machine as this browser. When it is
   * not, it says so here rather than appearing to work.
   */
  let opening = $state<string | null>(null);
  let openNote = $state<string | null>(null);

  async function openInPen(path: string) {
    if (!runId) return;
    opening = path;
    openNote = null;
    try {
      const said = await openDesign({ runId, path });
      openNote = said.ok ? null : said.message;
    } catch (error) {
      openNote = error instanceof Error ? error.message : 'Нээж чадсангүй.';
    } finally {
      opening = null;
    }
  }

  let openId = $state<string | null>(null);
  const opened = $derived(openId ? artifact(openId) : null);

  const documents = $derived(artifacts.filter((a) => a.kind === 'document'));
  const screens = $derived(artifacts.filter((a) => a.kind === 'screen'));
  const designFiles = $derived(artifacts.filter((a) => a.kind === 'design_file'));
  const commits = $derived(artifacts.filter((a) => a.kind === 'commits'));

  /** What a document is for, in the words the artboard uses. */
  const PURPOSE: Record<string, string> = {
    'docs/spec.md': 'Шаардлага',
    'docs/plan.md': 'Архитектур ба өөрчлөх файлууд',
    'docs/tasks.md': 'Дараалсан даалгаврууд',
  };
  const purposeOf = (path: string) => PURPOSE[path] ?? 'Ажиллагаанаас гарсан';
</script>

<section class="card">
  <h2>Үр дүн</h2>

  {#if artifacts.length === 0 && !mergeRequestUrl}
    <p class="empty">Хараахан юу ч гараагүй байна.</p>
  {/if}

  {#each documents as doc (doc.id)}
    <button
      type="button"
      class="row"
      aria-expanded={openId === doc.id}
      onclick={() => (openId = openId === doc.id ? null : doc.id)}
    >
      <Icon name="file-text" size={16} />
      <span class="tx">
        <span class="n">{doc.path}</span>
        <span class="s">{purposeOf(doc.path)} · v{doc.version} · {doc.stepIndex + 1}-р алхам</span>
      </span>
      <Icon name={openId === doc.id ? 'chevron-down' : 'chevron-right'} size={14} />
    </button>
    {#if openId === doc.id}
      {#if opened?.ready}
        <pre>{opened.current.content ?? '(хоосон)'}</pre>
      {:else}
        <p class="empty">Ачааллаж байна…</p>
      {/if}
    {/if}
  {/each}

  {#if screens.length > 0}
    <div class="screens">
      <div class="head">
        <Icon name="images" size={16} />
        <span class="tx">
          <span class="n">{screens.length} дэлгэц</span>
          <span class="s">docs/design/screens</span>
        </span>
      </div>
      <ScreenGallery {screens} heading="Дэлгэцүүд" />
      {#each designFiles as source (source.id)}
        <p class="foot">
          <Icon name="pen-tool" size={12} />
          <span>{source.path} хадгалагдсан</span>
          {#if runId}
            <button
              type="button"
              class="open"
              onclick={() => openInPen(source.path)}
              disabled={opening === source.path}
            >
              {opening === source.path ? 'Нээж байна…' : 'pen.dev дээр нээх'}
            </button>
          {/if}
        </p>
      {/each}
      {#if openNote}
        <p class="foot note">{openNote}</p>
      {/if}
    </div>
  {/if}

  {#if commits.length > 0}
    {#each commits as row (row.id)}
      <div class="row static">
        <Icon name="git-commit-horizontal" size={16} />
        <span class="tx">
          <span class="n">{row.path}</span>
          {#if branchName}<span class="s">{branchName} дээр</span>{/if}
        </span>
      </div>
    {/each}
  {/if}

  <!-- The system opens it; a human merges (FR-070) -->
  {#if mergeRequestUrl}
    <a class="row" href={mergeRequestUrl} target="_blank" rel="noreferrer noopener">
      <Icon name="git-pull-request" size={16} />
      <span class="tx">
        <span class="n">Нэгтгэх хүсэлт</span>
        <span class="s">Урьдын адил үйлчилгээн дээрээ хянаж нэгтгэнэ</span>
      </span>
      <Icon name="external-link" size={14} />
    </a>
  {:else}
    <div class="row waiting">
      <Icon name="git-pull-request" size={16} />
      <span class="tx">
        <span class="n">Нэгтгэх хүсэлт</span>
        <span class="s">Сүүлийн алхам дуусахад үүснэ</span>
      </span>
    </div>
  {/if}
</section>

<style>
  .card {
    display: flex;
    flex-direction: column;
    gap: 7px;
    padding: 16px;
    background: var(--surface);
    border: 1px solid var(--card-border);
    border-radius: var(--r-lg);
    box-shadow: 0 1px 2px #0f172a0a;
  }
  h2 {
    margin: 0 0 3px;
    font-family: var(--font-head);
    font-size: 15px;
    font-weight: 600;
    color: var(--text);
  }

  .row {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    padding: 7px;
    border: 0;
    border-radius: var(--r-sm);
    background: var(--surface-2);
    font: inherit;
    text-align: left;
    text-decoration: none;
    color: inherit;
    cursor: pointer;
  }
  .row.static,
  .row.waiting {
    cursor: default;
  }
  .row.waiting {
    background: none;
  }
  button.row:hover,
  a.row:hover {
    background: var(--accent-soft);
  }
  .row > :global(svg) {
    flex: none;
    color: var(--accent-text);
  }
  .row.waiting > :global(svg) {
    color: var(--text-3);
  }
  .tx {
    display: flex;
    flex-direction: column;
    gap: 1px;
    flex: 1;
    min-width: 0;
  }
  .n {
    font-size: 13px;
    font-weight: 500;
    color: var(--text);
  }
  .s {
    font-size: 11px;
    color: var(--text-3);
  }
  .tx span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .row.waiting .n {
    color: var(--text-3);
  }

  /* Screens get their own block, in the design's pink. */
  .screens {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 9px;
    border-radius: var(--r-sm);
    background: var(--design-soft);
  }
  .screens .head {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .screens .head :global(svg) {
    color: var(--design);
    flex: none;
  }
  .foot {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0;
    font-size: 11px;
    color: var(--accent-text);
  }
  .foot :global(svg) {
    color: var(--text-3);
  }
  /* Sits at the end of the line the design source is named on, so the thing
     it opens is the thing it is next to. */
  .open {
    margin-left: auto;
    padding: 3px 8px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: var(--surface);
    color: var(--text-1);
    font: inherit;
    font-size: 11px;
    cursor: pointer;
  }
  .open:hover:not(:disabled) {
    background: var(--surface-2);
  }
  .open:disabled {
    cursor: default;
    color: var(--text-3);
  }
  /* Why nothing opened — on this machine, or not on this machine at all. */
  .note {
    color: var(--text-3);
  }

  pre {
    margin: 0;
    padding: 12px;
    background: var(--surface-2);
    border-radius: var(--r-sm);
    font-size: 12px;
    max-height: 360px;
    overflow: auto;
    white-space: pre-wrap;
  }
  .empty {
    margin: 0;
    font-size: 12px;
    color: var(--text-3);
  }
</style>
