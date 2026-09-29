<script lang="ts">
  import Markdown from '$components/Markdown.svelte';
  import { m } from '$lib/i18n';
  import { ticketFile } from '$lib/remote/tickets.remote';

  /**
   * The text of one attached document, read when it is opened.
   *
   * A requirement document was stored, handed to every agent, and never shown
   * to the person who attached it: the list said a name and a size, and the
   * only way to see what a run had been given was to open the file again on
   * their own machine. Markdown is rendered as Markdown; anything else — CSV,
   * JSON, plain text — is shown as written, because a table of numbers read
   * as prose is worse than the numbers.
   */
  let { ticketId, fileId }: { ticketId: string; fileId: string } = $props();

  const file = $derived(ticketFile({ ticketId, fileId }));
  const markdown = $derived(
    file.ready && file.current ? /\.(md|markdown)$/i.test(file.current.name) : false
  );
</script>

<div class="view" data-file-view>
  {#if file.error || (file.ready && !file.current)}
    <p class="quiet">{m.files.gone}</p>
  {:else if !file.ready}
    <p class="quiet">{m.files.loading}</p>
  {:else if file.current && markdown}
    <Markdown source={file.current.content} />
  {:else if file.current}
    <pre>{file.current.content}</pre>
  {/if}
</div>

<style>
  .view {
    --markdown-size: var(--type-body);
    max-height: 420px;
    overflow: auto;
    padding: 14px 16px;
    border-radius: 12px;
    background: var(--surface);
    box-shadow: inset 0 1px 3px var(--shadow-depth);
  }
  .quiet {
    margin: 0;
    font-size: var(--type-body);
    color: var(--text-3);
  }
  pre {
    margin: 0;
    font: var(--type-body) / 1.6 var(--font-mono);
    color: var(--text);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
</style>
