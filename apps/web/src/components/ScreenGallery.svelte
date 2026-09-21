<script lang="ts">
  import { m } from '$lib/i18n';
  /**
   * The screens a design step produced, as thumbnails that open full size
   * with next and previous (FR-077). The images come from a conventional
   * route rather than a query, because an `<img src>` is the browser
   * fetching a URL (contracts/ui-data.md).
   */
  let {
    screens,
    heading = m.gallery.heading,
    note
  }: {
    screens: { id: string; path: string; screenName: string | null; version: number }[];
    heading?: string;
    note?: string;
  } = $props();

  let openIndex = $state<number | null>(null);
  const open = $derived(openIndex === null ? null : (screens[openIndex] ?? null));

  const label = (screen: { screenName: string | null; path: string }) =>
    screen.screenName || (screen.path.split('/').pop() ?? screen.path);

  function step(by: number) {
    if (openIndex === null || screens.length === 0) return;
    openIndex = (openIndex + by + screens.length) % screens.length;
  }

  function onKey(event: KeyboardEvent) {
    if (openIndex === null) return;
    if (event.key === 'Escape') openIndex = null;
    if (event.key === 'ArrowRight') step(1);
    if (event.key === 'ArrowLeft') step(-1);
  }
</script>

<svelte:window onkeydown={onKey} />

<section class="card">
  <h2 class="section">{heading} <span class="muted">{screens.length}</span></h2>
  {#if note}<p class="muted small note">{note}</p>{/if}

  {#if screens.length === 0}
    <p class="muted small">{m.gallery.empty}</p>
  {:else}
    <ul class="grid">
      {#each screens as screen, index (screen.id)}
        <li>
          <button type="button" onclick={() => (openIndex = index)}>
            <img src="/api/artifacts/{screen.id}/image" alt={label(screen)} loading="lazy" />
            <span class="caption small">
              {label(screen)}
              {#if screen.version > 1}<span class="badge small">v{screen.version}</span>{/if}
            </span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</section>

{#if open}
  <!-- Full size, with next and previous. Escape and the arrow keys work too. -->
  <div
    class="viewer"
    role="dialog"
    aria-modal="true"
    aria-label={label(open)}
    tabindex="-1"
  >
    <header>
      <span>
        {label(open)}
        <span class="muted small">{(openIndex ?? 0) + 1} of {screens.length}</span>
      </span>
      <button type="button" class="close" onclick={() => (openIndex = null)} aria-label={m.gallery.close}>
        ✕
      </button>
    </header>
    <div class="stage">
      <button
        type="button"
        class="nav"
        onclick={() => step(-1)}
        aria-label={m.gallery.previous}
        disabled={screens.length < 2}>‹</button
      >
      <img src="/api/artifacts/{open.id}/image" alt={label(open)} />
      <button
        type="button"
        class="nav"
        onclick={() => step(1)}
        aria-label={m.gallery.next}
        disabled={screens.length < 2}>›</button
      >
    </div>
    <footer class="muted small"><code>{open.path}</code></footer>
  </div>
{/if}

<style>
  .note { margin: 0 0 10px; }
  .grid {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: 10px;
  }
  .grid button {
    display: flex;
    flex-direction: column;
    gap: 6px;
    width: 100%;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: var(--surface);
    font: inherit;
    cursor: pointer;
    overflow: hidden;
    text-align: left;
  }
  .grid img {
    display: block;
    width: 100%;
    aspect-ratio: 4 / 3;
    object-fit: cover;
    object-position: top;
    background: var(--surface-2);
  }
  .caption {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 8px 8px;
  }
  .viewer {
    position: fixed;
    inset: 0;
    z-index: 20;
    display: flex;
    flex-direction: column;
    background: rgba(16, 18, 24, 0.94);
    color: #fff;
    padding: 12px 16px 16px;
  }
  .viewer header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
  }
  .viewer header .muted { color: #b9bfcc; }
  .close {
    border: 0;
    background: none;
    color: #fff;
    font: inherit;
    font-size: 18px;
    cursor: pointer;
    padding: 4px 8px;
  }
  .stage {
    flex: 1;
    min-height: 0;
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .stage img {
    flex: 1;
    min-width: 0;
    max-height: 100%;
    object-fit: contain;
  }
  .nav {
    border: 0;
    background: rgba(255, 255, 255, 0.12);
    color: #fff;
    font: inherit;
    font-size: 26px;
    line-height: 1;
    padding: 12px 14px;
    border-radius: var(--r-sm);
    cursor: pointer;
  }
  .nav:disabled { opacity: 0.3; cursor: default; }
  .viewer footer { margin-top: 10px; color: #b9bfcc; }
</style>
