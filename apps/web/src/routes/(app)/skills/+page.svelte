<script lang="ts">
  import Icon from '$components/Icon.svelte';
  import Markdown from '$components/Markdown.svelte';
  import { m } from '$lib/i18n';
  import { ago, exact } from '$lib/format';
  import { create, history, remove, save, skill, skills } from '$lib/remote/skills.remote';

  /**
   * Screen 11 — Skills, built to `design.pen`: a 400px list tile beside a
   * filling editor tile, 20px apart (specs/004-bento-redesign FR-023). The
   * editor's head carries the name, how many agents hold it, the path the
   * file takes inside a run, and three actions — history, delete, save.
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

<header class="page-head">
  <div class="text">
    <h1>{m.skills.heading}</h1>
    <p class="lede">{m.skills.lede}</p>
  </div>
  <button
    type="button"
    class="btn"
    onclick={() => {
      creating = true;
      showHistory = false;
      notice = null;
    }}
  >
    <Icon name="plus" size={15} />{m.skills.newSkill}
  </button>
</header>

<div class="wrap">
  <section class="tile list" aria-label={m.skills.heading}>
    <label class="search">
      <Icon name="search" size={14} />
      <input placeholder={m.skills.search} bind:value={filter} aria-label={m.skills.search} />
    </label>

    {#if list.error}
      <p class="state error" role="alert">{(list.error as Error).message}</p>
    {:else if !list.ready}
      <p class="state">{m.skills.loading}</p>
    {:else if shown.length === 0}
      <p class="state">{list.current.length === 0 ? m.skills.empty : m.skills.noMatch}</p>
    {:else}
      <ul>
        {#each shown as item (item.id)}
          {@const on = openId === item.id && !creating}
          <li>
            <button
              type="button"
              class="sk"
              class:on
              aria-current={on ? 'true' : undefined}
              onclick={() => choose(item.id)}
            >
              <span class="orb-sq" class:pen={!on} class:idle={item.agentCount === 0} aria-hidden="true">
                <Icon name="sparkles" size={15} />
              </span>
              <span class="tx">
                <span class="n">{item.name}</span>
                <span class="d">{item.description}</span>
              </span>
              <span class="u">{m.skills.agentCount(item.agentCount)}</span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <section class="tile editor">
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
              <h2 class="name">{creating ? m.skills.newSkill : (s?.name ?? '')}</h2>
              {#if s}
                <!-- How much depends on it, at the point of changing it (FR-043a) -->
                <span class="used">{m.skills.usedBy(s.agents.length)}</span>
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
                class="chip-btn"
                aria-pressed={showHistory}
                onclick={() => {
                  showHistory = !showHistory;
                  readingVersion = null;
                }}
              >
                <Icon name="history" size={13} />{m.skills.history}
              </button>
            {/if}
            {#if !creating && s?.mayChange}
              <button
                type="button"
                class="chip-btn danger"
                onclick={async () => {
                  const outcome = await remove(s.id);
                  notice = ('problem' in outcome ? outcome.problem : outcome.message) ?? null;
                  if (!('problem' in outcome)) {
                    openId = null;
                    showHistory = false;
                  }
                }}
              >
                <Icon name="trash-2" size={13} />{m.skills.delete}
              </button>
            {/if}
            {#if mayChange}
              <button type="submit" class="btn small" disabled={action.pending > 0}>
                <Icon name="check" size={13} />{creating ? m.skills.createSkill : m.skills.saveSkill}
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
          <label class="f name-field">
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
            <button type="button" class="chip-btn" onclick={() => (showHistory = false)}>
              <Icon name="undo-2" size={12} />{m.skills.backToContent}
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
                  <li class="state">{m.skills.noHistory}</li>
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
                      class="btn btn--secondary restore"
                      onclick={() => {
                        draft = {
                          name: picked.name,
                          description: picked.description,
                          content: picked.content,
                        };
                        notice = m.skills.putBackNotice(picked.version);
                        showHistory = false;
                      }}
                    >
                      <Icon name="undo-2" size={14} />{m.skills.putBack(picked.version)}
                    </button>
                  {/if}
                {/if}
              </div>
            </div>
          {/if}
        {:else}
          <div class="ed-label">
            <span>{m.skills.content}</span>
            <button type="button" class="chip-btn" aria-pressed={preview} onclick={() => (preview = !preview)}>
              <Icon name={preview ? 'code' : 'eye'} size={12} />{preview ? m.skills.source : m.skills.preview}
            </button>
          </div>

          {#if preview}
            <div class="preview"><Markdown source={draft.content} /></div>
          {:else}
            <!-- The dark code surface: a gutter of line numbers, a highlighted
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
                  data-overlay
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
  .page-head {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 20px;
    flex-wrap: wrap;
    padding: 4px 4px 0;
    margin-bottom: 20px;
  }
  .text {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }
  h1 {
    margin: 0;
    font-family: var(--font-head);
    font-size: 30px;
    font-weight: 600;
    letter-spacing: -0.6px;
    color: var(--text);
  }
  .lede {
    margin: 0;
    max-width: 90ch;
    font-size: var(--type-body);
    color: var(--text-2);
  }

  .wrap {
    display: flex;
    gap: 20px;
    align-items: stretch;
    min-height: calc(100vh - 220px);
  }
  .tile {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .list {
    width: 400px;
    flex: none;
    gap: 8px;
    padding: 22px;
  }
  .editor {
    flex: 1;
    padding: 26px;
  }

  /* ---- the list ---- */
  .search {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 4px;
    padding: 0 12px;
    border-radius: 12px;
    background: #f4f2ef;
    color: var(--text-3);
  }
  .search:focus-within {
    outline: 2px solid var(--accent);
  }
  .search input {
    flex: 1;
    min-width: 0;
    padding: 10px 0;
    border: 0;
    background: none;
    font: inherit;
    font-size: var(--type-body);
    color: var(--text);
  }
  .search input:focus {
    outline: none;
  }
  ul {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .sk {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    padding: 11px 12px;
    border: 1.5px solid transparent;
    border-radius: 14px;
    background: none;
    font: inherit;
    text-align: left;
    color: inherit;
    cursor: pointer;
  }
  .sk:hover {
    background: #f4f2ef;
  }
  .sk.on {
    border-color: var(--accent);
    background: var(--accent-soft);
  }
  .orb-sq {
    display: grid;
    flex: none;
    place-items: center;
    width: 32px;
    height: 32px;
    border-radius: 10px;
    color: var(--text-inv);
    background: linear-gradient(180deg, var(--accent-from), var(--accent-to));
  }
  .orb-sq.pen {
    background: linear-gradient(180deg, var(--pen-from), var(--pen-to));
  }
  .orb-sq.idle {
    opacity: 0.5;
  }
  .sk .tx {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .sk .n {
    overflow: hidden;
    font-family: var(--font-mono);
    font-size: var(--type-body);
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text);
  }
  .sk .d {
    overflow: hidden;
    font-size: var(--type-caption);
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-2);
  }
  .u {
    flex: none;
    padding: 2px 8px;
    border-radius: var(--r-pill);
    font-family: var(--font-head);
    font-size: var(--type-caption);
    font-weight: 600;
    color: var(--text-2);
    background: #f4f2ef;
  }
  .sk.on .u {
    background: #fff;
  }
  .state {
    margin: 0;
    padding: 10px 4px;
    font-size: var(--type-body);
    color: var(--text-2);
  }
  .state.error {
    color: var(--danger-text);
  }

  /* ---- the editor ---- */
  .sheet {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 16px;
    min-height: 0;
  }
  .h {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    flex-wrap: wrap;
  }
  .l {
    display: flex;
    flex: 1 1 320px;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }
  .nr {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }
  .name {
    margin: 0;
    font-family: var(--font-mono);
    font-size: 22px;
    font-weight: 600;
    color: var(--text);
    overflow-wrap: anywhere;
  }
  .used {
    padding: 4px 10px;
    border-radius: var(--r-pill);
    font-size: var(--type-caption);
    font-weight: 700;
    color: var(--accent-text);
    background: var(--accent-soft);
  }
  .path {
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--type-caption);
    color: var(--text-3);
  }
  .b {
    display: flex;
    flex: none;
    align-items: center;
    gap: 8px;
  }
  .chip-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 9px 13px;
    border: 0;
    border-radius: 11px;
    background: #f4f2ef;
    font: inherit;
    font-size: var(--type-caption);
    font-weight: 600;
    color: var(--text);
    cursor: pointer;
  }
  .chip-btn :global(svg) {
    color: var(--text-2);
  }
  .chip-btn:hover,
  .chip-btn[aria-pressed='true'] {
    background: #ebe8e4;
  }
  .chip-btn.danger {
    color: var(--danger-text);
    background: var(--danger-soft);
  }
  .chip-btn.danger :global(svg) {
    color: var(--danger);
  }
  .btn.small {
    padding: 9px 14px;
  }

  .meta {
    display: flex;
    gap: 14px;
  }
  .f {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }
  .f.name-field {
    flex: none;
    width: 220px;
  }
  .f > span,
  .ed-label > span {
    font-size: var(--type-caption);
    font-weight: 600;
    color: var(--text-2);
  }
  .f input {
    padding: 10px 12px;
    border: 1px solid transparent;
    border-radius: 12px;
    background: #f4f2ef;
    font: inherit;
    font-size: var(--type-body);
    color: var(--text);
  }
  .f.name-field input {
    font-family: var(--font-mono);
  }
  .f input:focus {
    border-color: var(--accent);
    outline: none;
  }
  .f input:read-only {
    color: var(--text-2);
  }
  .ed-label {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  .ed-label .chip-btn {
    padding: 5px 10px;
    border-radius: var(--r-pill);
    color: var(--text-2);
  }

  .banner {
    margin: 0;
    padding: 12px 16px;
    border-radius: 14px;
    font-size: var(--type-body);
    color: var(--text);
    background: #f4f2ef;
  }
  ul.banner {
    padding-left: 34px;
  }
  .banner.bad {
    color: var(--danger-text);
    background: var(--danger-soft);
  }
  .banner.good {
    color: var(--success-text);
    background: var(--success-soft);
  }

  /* ---- the code surface ---- */
  .code {
    display: flex;
    flex: 1;
    min-height: 360px;
    padding: 18px 0;
    border-radius: 18px;
    background: linear-gradient(180deg, var(--code-bg), #2a2521);
    overflow: auto;
    font-family: var(--font-mono);
    font-size: 13px;
    line-height: 21px;
    color: #f2eee8;
  }
  .gutter {
    position: sticky;
    left: 0;
    display: flex;
    flex-direction: column;
    padding: 0 14px 0 18px;
    background: var(--code-bg);
    color: #9c9286;
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
    padding-right: 18px;
  }
  .pane pre {
    margin: 0;
    font: inherit;
    white-space: pre;
  }
  .head {
    font-weight: 600;
    color: #f8b98f;
  }
  .pane textarea {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    margin: 0;
    padding: 0 18px 0 0;
    border: 0;
    background: none;
    font: inherit;
    white-space: pre;
    overflow: hidden;
    resize: none;
    color: transparent;
    caret-color: #f2eee8;
  }
  .pane textarea:focus {
    outline: none;
  }
  .pane textarea::selection {
    background: #f26b1d55;
  }
  .preview {
    flex: 1;
    min-height: 360px;
    padding: 18px 22px;
    border-radius: 18px;
    background: #f4f2ef;
    overflow: auto;
  }

  /* ---- history ---- */
  .history {
    display: flex;
    flex: 1;
    gap: 16px;
    min-height: 360px;
  }
  .versions {
    width: 260px;
    flex: none;
    gap: 4px;
  }
  .versions button {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 9px 10px;
    border: 1.5px solid transparent;
    border-radius: 12px;
    background: none;
    font: inherit;
    text-align: left;
    color: inherit;
    cursor: pointer;
  }
  .versions button:hover {
    background: #f4f2ef;
  }
  .versions button.on {
    border-color: var(--accent);
    background: var(--accent-soft);
  }
  .versions .v {
    font-family: var(--font-mono);
    font-size: var(--type-body);
    font-weight: 600;
    color: var(--accent-text);
  }
  .versions .tx {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
  }
  .versions .n {
    font-size: var(--type-body);
    color: var(--text);
  }
  .versions .d {
    font-size: var(--type-caption);
    color: var(--text-2);
  }
  .reading {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 12px;
    min-width: 0;
  }
  .reading .code {
    flex-direction: column;
    padding: 18px;
  }
  .ln {
    display: flex;
    gap: 14px;
  }
  .ln .no {
    min-width: 2ch;
    color: #9c9286;
    text-align: right;
    user-select: none;
  }
  .ln .c {
    white-space: pre-wrap;
  }
  .restore {
    align-self: flex-start;
  }

  @media (max-width: 1100px) {
    .wrap {
      flex-direction: column;
    }
    .list {
      width: auto;
    }
    .meta {
      flex-direction: column;
    }
    .f.name-field {
      width: auto;
    }
  }
</style>
