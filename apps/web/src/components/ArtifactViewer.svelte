<script lang="ts">
  import ScreenGallery from '$components/ScreenGallery.svelte';
  import { artifact } from '$lib/remote/runs.remote';
  import type { RunView } from '$lib/services/run-view';

  let {
    artifacts,
    mergeRequestUrl
  }: { artifacts: RunView['artifacts']; mergeRequestUrl: string | null } = $props();

  let openId = $state<string | null>(null);
  const opened = $derived(openId ? artifact(openId) : null);

  // Screens are the only kind shown as pictures; the rest are text or links
  // (FR-077).
  const documents = $derived(artifacts.filter((a) => a.kind === 'document'));
  const screens = $derived(artifacts.filter((a) => a.kind === 'screen'));
  const commits = $derived(artifacts.filter((a) => a.kind === 'commits'));

  const LABEL: Record<string, string> = {
    document: 'Document',
    design_file: 'Design source',
    screen: 'Screen',
    commits: 'Commits',
    merge_request: 'Merge request'
  };
</script>

<section class="card">
  <h2 class="section">Artifacts</h2>

  {#if artifacts.length === 0 && !mergeRequestUrl}
    <p class="muted small">Nothing produced yet.</p>
  {/if}

  {#if documents.length > 0}
    <ul>
      {#each documents as doc (doc.id)}
        <li>
          <button type="button" onclick={() => (openId = openId === doc.id ? null : doc.id)}>
            <span>{doc.path}</span>
            <span class="muted small">v{doc.version} &middot; step {doc.stepIndex + 1}</span>
          </button>
          {#if openId === doc.id}
            {#if opened?.ready}
              <pre>{opened.current.content ?? '(empty)'}</pre>
            {:else}
              <p class="muted small">Loading…</p>
            {/if}
          {/if}
        </li>
      {/each}
    </ul>
  {/if}

  {#if screens.length > 0}
    <div class="gallery">
      <ScreenGallery {screens} heading="Screens" />
    </div>
  {/if}

  {#if commits.length > 0}
    <h3 class="section">Commits</h3>
    <ul>
      {#each commits as row (row.id)}
        <li><span class="muted small">{row.path}</span></li>
      {/each}
    </ul>
  {/if}

  {#if mergeRequestUrl}
    <h3 class="section">Merge request</h3>
    <!-- The system opens it; a human merges (FR-070) -->
    <a href={mergeRequestUrl} target="_blank" rel="noreferrer noopener">{mergeRequestUrl}</a>
    <p class="muted small">Review and merge on the provider, as usual.</p>
  {/if}
</section>

<style>
  /* The gallery brings its own card, so this one steps out of the way. */
  .gallery {
    margin: 12px -16px -16px;
  }
  ul {
    list-style: none;
    margin: 0 0 12px;
    padding: 0;
  }
  li {
    border-top: 1px solid var(--border);
  }
  li:first-child {
    border-top: 0;
  }
  button {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    width: 100%;
    padding: 10px 4px;
    border: 0;
    background: none;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  pre {
    margin: 0 0 10px;
    padding: 12px;
    background: var(--surface-2);
    border-radius: var(--r-sm);
    font-size: 12px;
    max-height: 360px;
    overflow: auto;
    white-space: pre-wrap;
  }
  h3 {
    margin-top: 12px;
  }
  a {
    overflow-wrap: anywhere;
  }
</style>
