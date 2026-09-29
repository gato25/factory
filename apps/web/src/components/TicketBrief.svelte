<script lang="ts">
  import Icon from '$components/Icon.svelte';
  import Markdown from '$components/Markdown.svelte';
  import { m } from '$lib/i18n';
  import { ticketFiles } from '$lib/remote/tickets.remote';

  /**
   * What the person gave when they made the ticket: the description, the
   * criteria the result is judged by, and the documents they attached.
   *
   * It was written once, on the form, and nothing afterwards showed it. The
   * run page had a title, and the criteria appeared only at a checkpoint; the
   * description was on no screen at all, and an attached specification was a
   * name and a size in a tab. Somebody who had just started a ticket could not
   * see what they had asked for, which is the first thing they look for.
   *
   * The documents are named here and read in full in their own tab
   * (`RequirementFiles`); `onOpenDocuments` is how this points there. Where
   * that tab is already on the screen (a ticket not yet started) it is left
   * out, and the documents are simply below.
   */
  let {
    ticketId,
    description,
    criteria,
    onOpenDocuments,
  }: {
    ticketId: string;
    description: string | null;
    criteria: string[];
    onOpenDocuments?: () => void;
  } = $props();

  const written = $derived((description ?? '').trim());
  const list = $derived(criteria.map((line) => line.trim()).filter(Boolean));
  const files = $derived(ticketFiles(ticketId));
  const attached = $derived(files.ready ? files.current : []);
</script>

<section class="tile brief" aria-labelledby="brief-{ticketId}" data-brief>
  <header>
    <Icon name="lightbulb" size={15} />
    <h2 id="brief-{ticketId}">{m.brief.heading}</h2>
  </header>

  {#if written}
    <div class="part">
      <h3>{m.newTicket.description}</h3>
      <div class="text" data-brief-description><Markdown source={written} /></div>
    </div>
  {/if}

  {#if list.length > 0}
    <div class="part">
      <h3>{m.newTicket.acceptance}</h3>
      <ul class="criteria" data-brief-criteria>
        {#each list as criterion, index (index)}
          <li>
            <Icon name="circle-check" size={15} />
            <span>{criterion}</span>
          </li>
        {/each}
      </ul>
    </div>
  {/if}

  {#if onOpenDocuments && attached.length > 0}
    <div class="part">
      <h3>{m.newTicket.files}</h3>
      <ul class="docs" data-brief-documents>
        {#each attached as file (file.id)}
          <li>
            <Icon name="file-text" size={14} />
            <span>{file.name}</span>
          </li>
        {/each}
      </ul>
      <button type="button" class="read" onclick={onOpenDocuments}>
        {m.brief.readDocuments}
        <Icon name="arrow-right" size={14} />
      </button>
    </div>
  {/if}

  {#if !written && list.length === 0 && attached.length === 0}
    <p class="empty">{m.brief.empty}</p>
  {/if}
</section>

<style>
  .brief {
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 20px 22px;
  }

  header {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  header :global(svg) {
    flex: none;
    color: var(--accent-text);
  }
  h2 {
    margin: 0;
    font: 700 var(--type-body-lg) / 1.2 var(--font-head);
    color: var(--text);
  }

  .part {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  h3 {
    margin: 0;
    font: 600 var(--type-caption) / 1.2 var(--font);
    letter-spacing: 0.02em;
    color: var(--text-3);
  }

  .text {
    --markdown-size: var(--type-body);
    overflow-wrap: anywhere;
  }

  ul {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .criteria li {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    font-size: var(--type-body);
    line-height: 1.45;
    color: var(--text);
  }
  .criteria li :global(svg) {
    flex: none;
    margin-top: 2px;
    color: var(--text-3);
  }
  .criteria span {
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .docs li {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    border-radius: 10px;
    font-size: var(--type-body);
    background: var(--surface-2);
    color: var(--text);
  }
  .docs li :global(svg) {
    flex: none;
    color: var(--text-2);
  }
  .docs span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .read {
    display: inline-flex;
    align-items: center;
    align-self: flex-start;
    gap: 6px;
    padding: 4px 0;
    border: 0;
    background: none;
    font: 600 var(--type-body) / 1.2 var(--font);
    color: var(--accent-text);
    cursor: pointer;
  }
  .read:hover {
    text-decoration: underline;
  }

  .empty {
    margin: 0;
    font-size: var(--type-body);
    color: var(--text-3);
  }
</style>
