<script lang="ts">
  import Icon from '$components/Icon.svelte';
  import { agentName } from '$lib/default-names';
  import { m } from '$lib/i18n';
  import type { RunView } from '$lib/services/run-view';
  import { requestReference } from '$lib/state-words';

  /**
   * Artboard 06's "Үр дүн" tile: what the run has produced so far, one row
   * each — its documents, its screens, its commits — and the merge request
   * that ends it, dimmed until it is opened (FR-020). A row opens the
   * artifact tab on the left, where the thing itself can be read; the merge
   * request opens on the provider, where a person reviews and merges it.
   */
  let {
    view,
    onOpen,
  }: {
    view: RunView;
    /** Show the produced thing in the artifact tab. */
    onOpen: () => void;
  } = $props();

  const documents = $derived(view.artifacts.filter((a) => a.kind === 'document'));
  const screens = $derived(view.artifacts.filter((a) => a.kind === 'screen'));
  const commits = $derived(view.artifacts.filter((a) => a.kind === 'commits'));
  const count = $derived(
    documents.length + (screens.length > 0 ? 1 : 0) + (commits.length > 0 ? 1 : 0),
  );

  const PURPOSE: Record<string, string> = {
    'docs/spec.md': m.artifacts.purposeSpec,
    'docs/plan.md': m.artifacts.purposePlan,
    'docs/tasks.md': m.artifacts.purposeTasks,
  };
  const ICON: Record<string, string> = {
    'docs/spec.md': 'file-text',
    'docs/plan.md': 'map',
    'docs/tasks.md': 'list-checks',
  };
  /** Who made it: the agent of the step that wrote it. */
  const byStep = (index: number) => {
    const step = view.steps[index];
    return step ? agentName(step.label) : '';
  };
  const fileName = (path: string) => path.split('/').pop() ?? path;
</script>

<section class="tile results" aria-labelledby="run-results">
  <header class="head">
    <h2 id="run-results">{m.runResults.heading}</h2>
    <span class="c">{m.runResults.count(count)}</span>
  </header>

  {#if count === 0}
    <p class="empty">{m.artifacts.empty}</p>
  {/if}

  {#each documents as doc (doc.id)}
    <button type="button" class="row" onclick={onOpen} title={doc.path}>
      <span class="mini"><Icon name={ICON[doc.path] ?? 'file-text'} size={14} /></span>
      <span class="tx">
        <span class="t">{fileName(doc.path)}</span>
        <span class="s">{PURPOSE[doc.path] ?? m.artifacts.purposeOther} · {byStep(doc.stepIndex)}</span>
      </span>
      <Icon name="external-link" size={14} />
    </button>
  {/each}

  {#if screens.length > 0}
    <button type="button" class="row" onclick={onOpen}>
      <span class="mini pen"><Icon name="pen-tool" size={14} /></span>
      <span class="tx">
        <span class="t">{m.runResults.screens(screens.length)}</span>
        <span class="s">{m.runResults.screensFrom}</span>
      </span>
      <Icon name="external-link" size={14} />
    </button>
  {/if}

  {#if commits.length > 0}
    <button type="button" class="row" onclick={onOpen}>
      <span class="mini"><Icon name="git-commit-horizontal" size={14} /></span>
      <span class="tx">
        <span class="t">{m.runResults.commits(commits.length)}</span>
        <span class="s">{view.ticket.branchName ?? ''}</span>
      </span>
      <Icon name="external-link" size={14} />
    </button>
  {/if}

  <!-- The system opens it; a person merges it (FR-070). -->
  {#if view.ticket.mergeRequestUrl}
    <a class="row" href={view.ticket.mergeRequestUrl} target="_blank" rel="noreferrer noopener">
      <span class="mini mint"><Icon name="git-pull-request" size={14} /></span>
      <span class="tx">
        <span class="t">{m.runResults.mergeRequest(requestReference(view.ticket.mergeRequestUrl))}</span>
        <span class="s">{m.runResults.mergeRequestOpened}</span>
      </span>
      <Icon name="external-link" size={14} />
    </a>
  {:else}
    <div class="row waiting">
      <span class="mini quiet"><Icon name="git-pull-request" size={14} /></span>
      <span class="tx">
        <span class="t">{m.stepTracker.mergeRequest}</span>
        <span class="s">{m.runResults.mergeRequestPending}</span>
      </span>
    </div>
  {/if}
</section>

<style>
  .results {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 22px;
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-bottom: 6px;
  }
  h2 {
    margin: 0;
    font-size: 18px;
    font-weight: 600;
    letter-spacing: -0.3px;
  }
  .c,
  .empty {
    font-size: var(--type-caption);
    color: var(--text-2);
  }
  .empty {
    margin: 0;
    font-size: var(--type-body);
  }
  .row {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    padding: 10px 12px;
    border: 0;
    border-radius: 14px;
    font: inherit;
    text-align: left;
    text-decoration: none;
    color: var(--text-3);
    background: var(--surface-2);
    cursor: pointer;
  }
  .row:hover {
    box-shadow: inset 0 0 0 2px var(--accent-soft);
  }
  .row.waiting {
    cursor: default;
    background: #f4f2ef99;
  }
  .row.waiting:hover {
    box-shadow: none;
  }
  .mini {
    display: grid;
    flex: none;
    place-items: center;
    width: 30px;
    height: 30px;
    border-radius: 10px;
    color: var(--text-inv);
    background: linear-gradient(180deg, var(--accent-from), var(--accent-to));
  }
  .mini.pen {
    background: linear-gradient(180deg, var(--pen-from), var(--pen-to));
  }
  .mini.mint {
    background: linear-gradient(180deg, var(--mint-from), var(--mint-to));
  }
  .mini.quiet {
    color: var(--text-3);
    background: var(--border);
  }
  .tx {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .t {
    overflow: hidden;
    font-size: var(--type-body);
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text);
  }
  .s {
    overflow: hidden;
    font-size: var(--type-caption);
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-2);
  }
</style>
