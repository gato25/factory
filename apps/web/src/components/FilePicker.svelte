<script lang="ts">
  import {
    ACCEPTED_EXTENSIONS,
    checkFile,
    describeBytes,
    MAX_FILE_BYTES,
    MAX_FILES
  } from '@factory/shared';
  import Icon from '$components/Icon.svelte';
  import { m } from '$lib/i18n';

  /**
   * Picking requirement documents to attach to a ticket.
   *
   * The list of what was picked is the point. A bare file input shows
   * "3 files" and nothing else, so somebody who picked the wrong one finds out
   * after submitting — or, worse, after a run has read it.
   *
   * The refusals here are the same ones the server applies, from the same
   * module. That is not belt-and-braces: the server's copy is the boundary and
   * the only one that counts, and this one exists so a person learns about a
   * problem while they are still looking at the file they picked.
   */

  /**
   * `id` is what a label points at. The field's NAME is not a prop: it is
   * `files[]`, and has to be. The forms this sits in are SvelteKit remote
   * forms, which read a field as a list only when its name ends in `[]`.
   * Named `files`, a `multiple` input made the form throw "cannot contain
   * duplicated keys" the moment two documents were picked — the whole page
   * became a 500 and the ticket was never created — and, in development, an
   * error on every pick even for one.
   */
  let { id = 'files' }: { id?: string } = $props();

  let input = $state<HTMLInputElement | null>(null);
  let picked = $state<File[]>([]);
  let problems = $state<string[]>([]);

  const accept = ACCEPTED_EXTENSIONS.join(',');
  const total = $derived(picked.reduce((sum, file) => sum + file.size, 0));

  async function review(files: File[]) {
    const found: string[] = [];
    for (const file of files) {
      // Size first, so an enormous file is refused without being read into
      // memory to check whether it is text.
      if (file.size > MAX_FILE_BYTES) {
        found.push(
          `${file.name} is ${describeBytes(file.size)}, and the limit for one file is ${describeBytes(MAX_FILE_BYTES)}.`
        );
        continue;
      }
      const problem = checkFile({ name: file.name, content: await file.text() });
      if (problem) found.push(problem.message);
    }
    if (files.length > MAX_FILES) {
      found.push(`A ticket can carry ${MAX_FILES} files, and you picked ${files.length}.`);
    }
    problems = found;
  }

  async function onPick(event: Event) {
    const chosen = [...((event.target as HTMLInputElement).files ?? [])];
    picked = chosen;
    await review(chosen);
  }

  /**
   * Removing one before submitting.
   *
   * A file input's list cannot be edited, so it is rebuilt: without this, the
   * only way to drop one wrongly-picked file is to pick every file again.
   */
  async function drop(index: number) {
    const kept = picked.filter((_, at) => at !== index);
    const transfer = new DataTransfer();
    for (const file of kept) transfer.items.add(file);
    if (input) input.files = transfer.files;
    picked = kept;
    await review(kept);
  }
</script>

<div class="picker">
  <input
    bind:this={input}
    type="file"
    {id}
    name="files[]"
    {accept}
    multiple
    onchange={onPick}
  />

  {#if picked.length > 0}
    <ul class="picked">
      {#each picked as file, index (`${file.name}-${index}`)}
        <li>
          <Icon name="file-text" size={14} />
          <span class="n">{file.name}</span>
          <span class="s">{describeBytes(file.size)}</span>
          <button type="button" onclick={() => drop(index)} aria-label={m.files.remove(file.name)}>
            <Icon name="x" size={14} />
          </button>
        </li>
      {/each}
    </ul>
    <p class="total">{picked.length} file{picked.length === 1 ? '' : 's'}, {describeBytes(total)}</p>
  {/if}

  {#each problems as problem (problem)}
    <p class="problem"><Icon name="triangle-alert" size={14} />{problem}</p>
  {/each}
</div>

<style>
  .picker {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  /* The bento field: the inset surface every input on the form sits in, and
     the browser's own button drawn as the kit's secondary one. */
  input[type='file'] {
    width: 100%;
    padding: 10px 12px;
    border: 0;
    border-radius: 12px;
    font: var(--type-body) / 1.4 var(--font);
    color: var(--text-2);
    background: var(--surface-2);
    box-shadow: inset 0 1px 3px #3a2a1a1a;
  }
  input[type='file']::file-selector-button {
    margin-right: 12px;
    padding: 7px 14px;
    border: 0;
    border-radius: 10px;
    font: 600 var(--type-body) / 1.2 var(--font);
    color: var(--text);
    background: var(--surface);
    box-shadow: 0 1px 2px var(--shadow-depth);
    cursor: pointer;
  }
  input[type='file']:focus-visible {
    box-shadow: var(--focus-ring);
  }

  .picked {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .picked li {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-radius: 12px;
    font-size: var(--type-body);
    background: var(--surface-2);
  }
  .picked :global(svg) {
    flex: none;
    color: var(--text-2);
  }
  .picked .n {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text);
  }
  .picked .s {
    flex: none;
    font-size: var(--type-caption);
    color: var(--text-3);
  }
  .picked button {
    display: flex;
    padding: 4px;
    border: 0;
    border-radius: 8px;
    color: var(--text-3);
    background: none;
    cursor: pointer;
  }
  .picked button:hover {
    color: var(--danger-text);
    background: var(--danger-soft);
  }

  .total {
    margin: 0;
    font-size: var(--type-caption);
    color: var(--text-3);
  }

  .problem {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0;
    font-size: var(--type-caption);
    color: var(--danger-text);
  }
  .problem :global(svg) {
    flex: none;
  }
</style>
