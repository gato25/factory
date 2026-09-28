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
    note,
    bare = false,
  }: {
    screens: { id: string; path: string; screenName: string | null; version: number }[];
    heading?: string;
    note?: string;
    /** Inside a tile that has its own heading: every screen large, two to a row. */
    bare?: boolean;
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

{#snippet grid()}
  {#if note}<p class="note">{note}</p>{/if}
  {#if screens.length === 0}
    <p class="empty">{m.gallery.empty}</p>
  {:else}
    <ul class="grid" class:large={bare}>
      {#each screens as screen, index (screen.id)}
        <li>
          <button type="button" onclick={() => (openIndex = index)}>
            <span class="frame">
              <img src="/api/artifacts/{screen.id}/image" alt={label(screen)} loading="lazy" />
            </span>
            <span class="caption">
              <span class="name">{label(screen)}</span>
              <span class="file">{screen.path.split('/').pop()}{#if screen.version > 1}
                  · v{screen.version}{/if}</span
              >
            </span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
{/snippet}

<!--
  Bare inside a tile that already names the screens (the design review);
  otherwise a block of its own, with its heading.
-->
{#if bare}
  {@render grid()}
{:else}
  <section class="block">
    <h2>{heading} <span class="count">{screens.length}</span></h2>
    {@render grid()}
  </section>
{/if}

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
        <span class="where">{m.gallery.position((openIndex ?? 0) + 1, screens.length)}</span>
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
    <footer><code>{open.path}</code></footer>
  </div>
{/if}

<style>
  .block h2 {
    margin: 0 0 12px;
    font-size: 16px;
    font-weight: 600;
  }
  .count {
    font-weight: 500;
    color: var(--text-3);
  }
  .note,
  .empty {
    margin: 0 0 12px;
    font-size: var(--type-caption);
    color: var(--text-2);
  }
  .empty {
    font-size: var(--type-body);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 12px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .grid.large {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 16px;
  }
  .grid button {
    display: flex;
    flex-direction: column;
    gap: 10px;
    width: 100%;
    padding: 0;
    border: 0;
    font: inherit;
    text-align: left;
    color: inherit;
    background: none;
    cursor: pointer;
  }
  .frame {
    display: block;
    overflow: hidden;
    border-radius: 16px;
    background: linear-gradient(180deg, #ffffff, #f7f5f2);
    box-shadow: 0 8px 18px var(--shadow-depth);
  }
  .grid button:hover .frame,
  .grid button:focus-visible .frame {
    box-shadow:
      0 0 0 3px var(--purple-soft),
      0 8px 18px var(--shadow-depth);
  }
  .grid img {
    display: block;
    width: 100%;
    aspect-ratio: 4 / 3;
    object-fit: cover;
    object-position: top;
  }
  .large img {
    aspect-ratio: 16 / 10;
  }
  .caption {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    min-width: 0;
  }
  .name {
    overflow: hidden;
    font-size: var(--type-body);
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .file {
    flex: none;
    font: 12px/1.3 var(--font-mono);
    color: var(--text-3);
  }

  .viewer {
    position: fixed;
    inset: 0;
    z-index: 20;
    display: flex;
    flex-direction: column;
    padding: 12px 16px 16px;
    color: #fff;
    background: rgba(22, 20, 15, 0.94);
  }
  .viewer header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    font-size: var(--type-body);
  }
  .where,
  .viewer footer {
    font-size: var(--type-caption);
    color: #d8d2c8;
  }
  .where {
    margin-left: 8px;
  }
  .close {
    padding: 4px 8px;
    border: 0;
    font: inherit;
    font-size: 18px;
    color: #fff;
    background: none;
    cursor: pointer;
  }
  .stage {
    display: flex;
    flex: 1;
    align-items: center;
    gap: 12px;
    min-height: 0;
  }
  .stage img {
    flex: 1;
    min-width: 0;
    max-height: 100%;
    object-fit: contain;
  }
  .nav {
    padding: 12px 14px;
    border: 0;
    border-radius: var(--r-sm);
    font: inherit;
    font-size: 26px;
    line-height: 1;
    color: #fff;
    background: rgba(255, 255, 255, 0.12);
    cursor: pointer;
  }
  .nav:disabled {
    cursor: default;
    opacity: 0.3;
  }
  .viewer footer {
    margin-top: 10px;
  }
</style>
