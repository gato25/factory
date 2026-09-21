<script lang="ts">
  import Icon from '$components/Icon.svelte';
  import Markdown from '$components/Markdown.svelte';
  import { m } from '$lib/i18n';
  import { ago, exact } from '$lib/format';
  import { create, history, remove, save, skill, skills } from '$lib/remote/skills.remote';

  /**
   * Screen 11 — Skills, built to `design.pen`'s artboard: a 340px list beside
   * a filling editor, 24px apart. The editor's header carries the name, how
   * many agents hold it, the path the file takes inside a run, and three
   * actions — History, Delete, Save skill.
   *
   * The content field is the design's dark pane with line numbers. It is a
   * real textarea laid over a highlighted copy of the same text, so what you
   * see and what you type stay one thing rather than two.
   *
   * Read `bun scripts/design/report.ts "11 Skills"` beside this file.
   */

  let { data }: { data: { user: { id: string } } } = $props();

  const list = $derived(skills());

  let openId = $state<string | null>(null);
  let creating = $state(false);
  let filter = $state('');
  let notice = $state<string | null>(null);
  let showHistory = $state(false);
  let readingVersion = $state<number | null>(null);
  let preview = $state(false);

  const open = $derived(openId && !creating ? skill(openId) : null);
  const versions = $derived(openId && !creating && showHistory ? history(openId) : null);
  // Read through deriveds rather than off `versions` in the markup: closing
  // the panel makes `versions` null while its blocks are still on screen,
  // and a template reading `versions.current` then throws on the way out.
  const versionList = $derived(versions?.ready ? versions.current : []);
  const chosen = $derived(versionList.find((v) => v.version === readingVersion) ?? null);

  const shown = $derived(
    list.ready
      ? list.current.filter((item) =>
          filter
            ? `${item.name} ${item.description}`.toLowerCase().includes(filter.toLowerCase())
            : true,
        )
      : [],
  );

  /**
   * What the fields hold. Seeded from whatever is open, then owned by the
   * person typing — `draftOf` remembers which skill it was seeded from, so a
   * refresh after saving does not throw away what they have written since.
   */
  let draft = $state({ name: '', description: '', content: '' });
  let draftOf = $state<string | null>(null);

  $effect(() => {
    const loaded = open?.ready ? open.current : null;
    const key = creating ? 'new' : (loaded?.id ?? null);
    if (key === draftOf) return;
    draftOf = key;
    draft = creating
      ? { name: '', description: '', content: '' }
      : {
          name: loaded?.name ?? '',
          description: loaded?.description ?? '',
          content: loaded?.content ?? '',
        };
    readingVersion = null;
    preview = false;
  });

  // The artboard opens with a skill in the editor, not on an empty panel —
  // and with nothing to open, on a blank new one, so there is always a way
  // forward.
  $effect(() => {
    if (!list.ready || openId !== null || creating) return;
    const first = list.current[0];
    if (first) openId = first.id;
    else creating = true;
  });

  const lines = $derived(draft.content.split('\n'));
  const isHeading = (line: string) => line.trimStart().startsWith('#');

  const mayChange = $derived(creating || (open?.ready ? open.current.mayChange : false));
  const action = $derived(creating ? create : save);
  const issues = $derived(creating ? create.fields.allIssues() : save.fields.allIssues());
  const result = $derived(creating ? create.result : save.result);

  // A save answers whatever notice prompted it — "version 1 is in the
  // editor, it is not saved until you save it" must not still be on screen
  // once it has been saved.
  $effect(() => {
    if (result) notice = null;
  });

  function choose(id: string) {
    openId = id;
    creating = false;
    showHistory = false;
    notice = null;
  }
</script>

<div class="wrap">
  <section class="panel list">
    <header>
      <div class="title">
        <h2>{m.skills.heading}</h2>
        <button
          type="button"
          class="new"
          onclick={() => {
            creating = true;
            showHistory = false;
            notice = null;
          }}
        >
          <Icon name="plus" size={14} />
          <span>{m.skills.new}</span>
        </button>
      </div>
      <p>
        {m.skills.lede}
      </p>
      <label class="search">
        <Icon name="search" size={14} />
        <input placeholder={m.skills.search} bind:value={filter} aria-label={m.skills.search} />
      </label>
    </header>

    {#if list.error}
      <p class="state error" role="alert">{(list.error as Error).message}</p>
    {:else if !list.ready}
      <p class="state">{m.skills.loading}</p>
    {:else if shown.length === 0}
      <p class="state">
        {list.current.length === 0 ? m.skills.empty : m.skills.noMatch}
      </p>
    {:else}
      <ul>
        {#each shown as item (item.id)}
          <li>
            <button
              type="button"
              class="sk"
              class:on={openId === item.id && !creating}
              onclick={() => choose(item.id)}
            >
              <Icon name="sparkles" size={16} />
              <span class="tx">
                <span class="n">{item.name}</span>
                <span class="d">{item.description}</span>
              </span>
              <span class="u">{item.agentCount} agent{item.agentCount === 1 ? '' : 's'}</span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <section class="panel editor">
    {#if !creating && openId && !open?.ready}
      <p class="state">{m.skills.loadingOne}</p>
    {:else if !creating && !openId}
      <p class="state">{m.skills.pickOne}</p>
    {:else}
      {@const s = open?.ready ? open.current : null}
      <form {...action} class="sheet">
        {#if !creating && s}
          <input type="hidden" name="skillId" value={s.id} />
        {/if}

        <header class="h">
          <div class="l">
            <div class="nr">
              <span class="name">{creating ? m.skills.newSkill : (s?.name ?? '')}</span>
              {#if s}
                <!-- How much depends on it, at the point of changing it (FR-043a) -->
                <span class="badge">
                  <span class="dot"></span>
                  {m.skills.usedBy(s.agents.length)}
                </span>
              {/if}
            </div>
            <p class="path" title={s ? exact(s.updatedAt) : undefined}>
              {#if creating}
                {m.skills.savedTo}
              {:else if s}
                .claude/skills/{s.name}/SKILL.md {m.skills.lastEdited(ago(s.updatedAt))}
                {#if s.updatedByName}{m.skills.by(s.updatedByName)}{/if}
                <!-- Whose it is, where there is something to say: a shipped
                     default belongs to nobody, and another member's is
                     readable but not yours to change (FR-006b, FR-006c). -->
                {#if s.isDefault}
                  {m.skills.shipped}
                {:else if s.ownerId !== data.user.id && s.ownerName}
                  {m.skills.ownedBy(s.ownerName)}
                {/if}
              {/if}
            </p>
          </div>

          <div class="b">
            {#if !creating && s}
              <button
                type="button"
                class="secondary"
                aria-pressed={showHistory}
                onclick={() => {
                  showHistory = !showHistory;
                  readingVersion = null;
                }}
              >
                <Icon name="history" size={16} />
                <span>{m.skills.history}</span>
              </button>
            {/if}
            {#if !creating && s?.mayChange}
              <button
                type="button"
                class="secondary danger"
                onclick={async () => {
                  const outcome = await remove(s.id);
                  notice = ('problem' in outcome ? outcome.problem : outcome.message) ?? null;
                  if (!('problem' in outcome)) {
                    openId = null;
                    showHistory = false;
                  }
                }}
              >
                <Icon name="trash-2" size={16} />
                <span>{m.skills.delete}</span>
              </button>
            {/if}
            {#if mayChange}
              <button type="submit" class="primary" disabled={action.pending > 0}>
                <Icon name="save" size={16} />
                <span>{creating ? m.skills.createSkill : m.skills.saveSkill}</span>
              </button>
            {/if}
          </div>
        </header>

        {#if notice}<p class="banner" role="status">{notice}</p>{/if}
        {#if issues?.length}
          <ul class="banner bad" role="alert">
            {#each issues as issue (issue.message)}
              <li>{issue.message}</li>
            {/each}
          </ul>
        {:else if result && 'problem' in result}
          <p class="banner bad" role="alert">{result.problem}</p>
        {:else if result && 'message' in result}
          <p class="banner good" role="status">{result.message}</p>
        {/if}

        <div class="meta">
          <label class="f name">
            <span>{m.skills.name}</span>
            <input name="name" bind:value={draft.name} readonly={!mayChange} required />
          </label>
          <label class="f">
            <span>{m.skills.descriptionLabel}</span>
            <input
              name="description"
              bind:value={draft.description}
              readonly={!mayChange}
              required
              placeholder={m.skills.descriptionPlaceholder}
            />
          </label>
        </div>

        {#if showHistory && versions}
          <div class="ed-label">
            <span>{m.skills.history}</span>
            <button type="button" class="link" onclick={() => (showHistory = false)}>
              Back to the content
            </button>
          </div>
          {#if versions?.error}
            <p class="state error" role="alert">{(versions.error as Error).message}</p>
          {:else if !versions?.ready}
            <p class="state">{m.skills.loadingHistory}</p>
          {:else}
            <div class="history">
              <ul class="versions">
                {#each versionList as version (version.version)}
                  <li>
                    <button
                      type="button"
                      class:on={readingVersion === version.version}
                      onclick={() =>
                        (readingVersion =
                          readingVersion === version.version ? null : version.version)}
                    >
                      <span class="v">v{version.version}</span>
                      <span class="tx">
                        <span class="n">{version.name}</span>
                        <span class="d">
                          <time title={exact(version.createdAt)}>{ago(version.createdAt)}</time>
                          {#if version.authorName}{m.skills.by(version.authorName)}{/if}
                        </span>
                      </span>
                      {#if version.current}<span class="u">{m.skills.current}</span>{/if}
                    </button>
                  </li>
                {/each}
                {#if versionList.length === 0}
                  <li class="state">
                    {m.skills.noHistory}
                  </li>
                {/if}
              </ul>

              <div class="reading">
                {#if chosen === null}
                  <p class="state">{m.skills.pickVersion}</p>
                {:else}
                  <div class="code" data-testid="version-content">
                    {#each chosen.content.split('\n') as line, i (i)}
                      <div class="ln">
                        <span class="no">{i + 1}</span>
                        <span class="c" class:head={isHeading(line)}>{line}</span>
                      </div>
                    {/each}
                  </div>
                  {#if mayChange && !chosen.current}
                    {@const picked = chosen}
                    <button
                      type="button"
                      class="secondary restore"
                      onclick={() => {
                        draft = {
                          name: picked.name,
                          description: picked.description,
                          content: picked.content,
                        };
                        notice =
                          `Version ${picked.version} is in the editor. It is not saved until ` +
                          'you save it, and saving it makes a new version rather than ' +
                          'rewriting the old one.';
                        showHistory = false;
                      }}
                    >
                      <Icon name="undo-2" size={16} />
                      <span>Put version {picked.version} in the editor</span>
                    </button>
                  {/if}
                {/if}
              </div>
            </div>
          {/if}
        {:else}
          <div class="ed-label">
            <span>{m.skills.content}</span>
            <button type="button" class="link" onclick={() => (preview = !preview)}>
              {preview ? m.skills.source : m.skills.preview}
            </button>
          </div>

          {#if preview}
            <div class="preview"><Markdown source={draft.content} /></div>
          {:else}
            <!-- The design's dark pane: a gutter of line numbers, a highlighted
                 copy of the text, and the real field laid exactly over it. -->
            <div class="code editing">
              <div class="gutter" aria-hidden="true">
                {#each lines as _line, i (i)}<span>{i + 1}</span>{/each}
              </div>
              <div class="pane">
                <pre aria-hidden="true">{#each lines as line, i (i)}<span
                      class:head={isHeading(line)}>{line}</span
                    >{#if i < lines.length - 1}{'\n'}{/if}{/each}</pre>
                <textarea
                  name="content"
                  aria-label={m.skills.content}
                  spellcheck="false"
                  readonly={!mayChange}
                  bind:value={draft.content}
                ></textarea>
              </div>
            </div>
          {/if}
        {/if}
      </form>
    {/if}
  </section>
</div>

<style>
  .wrap {
    display: flex;
    gap: 24px;
    align-items: stretch;
    /* The artboard's body fills the screen below the 72px top bar. */
    min-height: calc(100vh - 128px);
  }

  .panel {
    display: flex;
    flex-direction: column;
    background: var(--surface);
    border: 1px solid var(--card-border);
    border-radius: var(--r-lg);
    box-shadow: 0 1px 2px #0f172a0a;
    overflow: hidden;
  }
  .list {
    width: 340px;
    flex: none;
  }
  .editor {
    flex: 1;
    min-width: 0;
  }

  /* ---- the list ---- */
  .list > header {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 16px;
    border-bottom: 1px solid var(--border);
  }
  .title {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .list h2 {
    margin: 0;
    font-family: var(--font-head);
    font-size: 16px;
    font-weight: 600;
    color: var(--text);
  }
  .list > header p {
    margin: 0;
    font-size: 12px;
    color: var(--text-2);
  }
  .new {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 5px 10px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: var(--surface);
    font: inherit;
    font-size: 12px;
    font-weight: 500;
    color: var(--text);
    cursor: pointer;
  }
  .new:hover {
    border-color: var(--accent);
    color: var(--accent-text);
  }

  .search {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-radius: var(--r-sm);
    background: var(--surface-2);
    color: var(--text-3);
  }
  .search input {
    flex: 1;
    min-width: 0;
    border: 0;
    background: none;
    font: inherit;
    font-size: 13px;
    color: var(--text);
  }
  .search input:focus {
    outline: none;
  }
  .search input::placeholder {
    color: var(--text-3);
  }

  .list ul {
    list-style: none;
    margin: 0;
    padding: 0;
    overflow-y: auto;
  }
  .sk {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    padding: 12px 16px;
    border: 0;
    border-bottom: 1px solid var(--border);
    background: none;
    font: inherit;
    text-align: left;
    cursor: pointer;
    color: var(--purple);
  }
  .sk:hover {
    background: var(--surface-2);
  }
  .sk.on {
    background: var(--accent-soft);
    border-bottom-color: transparent;
    color: var(--accent-text);
  }
  .sk .tx {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1;
    min-width: 0;
  }
  .sk .n {
    font-size: 13px;
    font-weight: 600;
    color: var(--text);
  }
  .sk.on .n {
    color: var(--accent-text);
  }
  .sk .d,
  .sk .u {
    font-size: 11px;
    color: var(--text-3);
  }
  .sk .d {
    font-size: 12px;
    color: var(--text-2);
  }
  .sk .n {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* Two lines, then stop: the design's descriptions are one line, and a long
     one should wrap rather than disappear behind an ellipsis. */
  .sk .d {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow: hidden;
  }
  .sk .u {
    flex: none;
  }

  /* ---- the editor ---- */
  .sheet {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }
  .h {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 14px 20px;
    border-bottom: 1px solid var(--border);
  }
  .l {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1;
    min-width: 0;
  }
  .nr {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }
  .name {
    font-family: var(--font-mono);
    font-size: 17px;
    font-weight: 600;
    color: var(--text);
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    flex: none;
    padding: 4px 10px;
    border-radius: 999px;
    background: var(--surface-2);
    font-size: 12px;
    color: var(--text-2);
  }
  .dot {
    width: 6px;
    height: 6px;
    border-radius: 999px;
    background: currentcolor;
    flex: none;
  }
  .path {
    margin: 0;
    font-size: 12px;
    color: var(--text-3);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .b {
    display: flex;
    align-items: center;
    gap: 10px;
    flex: none;
  }

  .b button,
  .restore {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 10px 16px;
    border-radius: var(--r-sm);
    font: inherit;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
  }
  .secondary {
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text);
  }
  .secondary :global(svg) {
    color: var(--text-2);
  }
  .secondary:hover {
    border-color: var(--accent);
  }
  .secondary[aria-pressed='true'] {
    background: var(--accent-soft);
    border-color: var(--accent-soft);
    color: var(--accent-text);
  }
  /* The artboard draws Delete as an ordinary secondary button. It says what
     it is on approach rather than shouting from rest. */
  .secondary.danger:hover,
  .secondary.danger:hover :global(svg) {
    border-color: var(--danger);
    color: var(--danger);
  }
  .primary {
    border: 1px solid var(--accent);
    background: var(--accent);
    color: var(--text-inv);
    font-weight: 600;
  }
  .primary:disabled {
    opacity: 0.6;
    cursor: progress;
  }

  .meta {
    display: flex;
    gap: 16px;
    padding: 16px 20px;
  }
  .f {
    display: flex;
    flex-direction: column;
    gap: 6px;
    flex: 1;
    min-width: 0;
  }
  .f.name {
    width: 260px;
    flex: none;
  }
  .f span {
    font-size: 12px;
    font-weight: 600;
    color: var(--text);
  }
  .f input {
    padding: 9px 12px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: var(--surface);
    font: inherit;
    font-size: 13px;
    color: var(--text);
  }
  .f.name input {
    font-family: var(--font-mono);
  }
  .f input:read-only {
    background: var(--surface-2);
    color: var(--text-2);
  }

  .ed-label {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 20px 8px;
    font-size: 12px;
    font-weight: 600;
    color: var(--text);
  }
  .link {
    border: 0;
    background: none;
    padding: 0;
    font: inherit;
    font-size: 12px;
    font-weight: 500;
    color: var(--accent-text);
    cursor: pointer;
  }
  .link:hover {
    text-decoration: underline;
  }

  /* ---- the dark pane ---- */
  .code {
    flex: 1;
    min-height: 240px;
    display: flex;
    padding: 14px 0;
    background: var(--code-bg);
    overflow: auto;
    font-family: var(--font-mono);
    font-size: 12px;
    line-height: 20px;
  }
  .gutter {
    position: sticky;
    left: 0;
    display: flex;
    flex-direction: column;
    padding: 0 16px 0 20px;
    background: var(--code-bg);
    color: var(--code-line);
    text-align: right;
    user-select: none;
  }
  .gutter span {
    min-width: 2ch;
  }
  .pane {
    position: relative;
    min-width: calc(100% - 56px);
    width: max-content;
    padding-right: 20px;
  }
  .pane pre {
    margin: 0;
    font: inherit;
    white-space: pre;
    color: var(--code-text);
  }
  .pane pre .head {
    color: var(--code-accent);
  }
  .pane textarea {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    margin: 0;
    padding: 0 20px 0 0;
    border: 0;
    background: none;
    font: inherit;
    white-space: pre;
    overflow: hidden;
    resize: none;
    color: transparent;
    caret-color: var(--code-text);
  }
  .pane textarea:focus {
    outline: none;
  }
  .pane textarea::selection {
    background: #1d4ed855;
  }

  /* The read-only rendering the history uses: the same pane, no field. */
  .code .ln {
    display: flex;
    gap: 16px;
    padding: 0 20px;
  }
  .code .ln .no {
    min-width: 2ch;
    text-align: right;
    color: var(--code-line);
    user-select: none;
  }
  .code .ln .c {
    color: var(--code-text);
    white-space: pre;
  }
  .code .ln .c.head {
    color: var(--code-accent);
  }
  .code:not(.editing) {
    flex-direction: column;
    display: block;
  }

  .preview {
    flex: 1;
    min-height: 240px;
    padding: 4px 20px 20px;
    overflow-y: auto;
  }

  /* ---- history ---- */
  .history {
    display: flex;
    flex: 1;
    min-height: 0;
    border-top: 1px solid var(--border);
  }
  .versions {
    list-style: none;
    margin: 0;
    padding: 0;
    width: 260px;
    flex: none;
    border-right: 1px solid var(--border);
    overflow-y: auto;
  }
  .versions > li > button {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 10px 16px;
    border: 0;
    border-bottom: 1px solid var(--border);
    background: none;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .versions button.on {
    background: var(--accent-soft);
  }
  .versions .v {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text-2);
    flex: none;
  }
  .versions .tx {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1;
    min-width: 0;
  }
  .versions .n {
    font-size: 13px;
    color: var(--text);
  }
  .versions .d {
    font-size: 11px;
    color: var(--text-3);
  }
  .versions .u {
    font-size: 11px;
    color: var(--accent-text);
    flex: none;
  }
  .reading {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
  }
  .restore {
    margin: 12px 20px;
    align-self: flex-start;
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text);
  }

  /* ---- shared ---- */
  .state {
    margin: 0;
    padding: 20px;
    font-size: 13px;
    color: var(--text-2);
  }
  .state.error {
    color: var(--danger);
  }
  .banner {
    margin: 0;
    padding: 10px 20px;
    border-bottom: 1px solid var(--border);
    font-size: 13px;
    color: var(--text-2);
  }
  ul.banner {
    padding-left: 40px;
  }
  .banner.bad {
    color: var(--danger);
    background: var(--danger-soft);
  }
  .banner.good {
    color: var(--success);
    background: var(--success-soft);
  }

  @media (max-width: 1000px) {
    .wrap {
      flex-direction: column;
      min-height: 0;
    }
    .list {
      width: auto;
    }
    .meta {
      flex-direction: column;
    }
    .f.name {
      width: auto;
    }
    .history {
      flex-direction: column;
    }
    .versions {
      width: auto;
      border-right: 0;
      border-bottom: 1px solid var(--border);
    }
  }
</style>
