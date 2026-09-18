<script lang="ts">
  import {
    ACCEPTED_EXTENSIONS,
    checkFile,
    describeBytes,
    MAX_FILE_BYTES,
    MAX_FILES
  } from '@factory/shared';
  import Icon from '$components/Icon.svelte';

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

  let { name = 'files' }: { name?: string } = $props();

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
          `${file.name} нь ${describeBytes(file.size)} байна, нэг файлын хязгаар ${describeBytes(MAX_FILE_BYTES)}.`
        );
        continue;
      }
      const problem = checkFile({ name: file.name, content: await file.text() });
      if (problem) found.push(problem.message);
    }
    if (files.length > MAX_FILES) {
      found.push(`Нэг даалгавар ${MAX_FILES} файл дийлнэ, та ${files.length}-ыг сонгожээ.`);
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
    id={name}
    {name}
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
          <button type="button" onclick={() => drop(index)} aria-label="{file.name}-ийг хасах">
            <Icon name="x" size={14} />
          </button>
        </li>
      {/each}
    </ul>
    <p class="total">{picked.length} файл, {describeBytes(total)}</p>
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

  input[type='file'] {
    padding: 10px 12px;
    border: 1px dashed var(--border);
    border-radius: var(--r-sm);
    background: var(--surface);
    font: inherit;
    font-size: 13px;
    color: var(--text-2);
    width: 100%;
  }
  input[type='file']:focus {
    outline: 2px solid var(--accent-soft);
    border-color: var(--accent);
  }

  .picked {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .picked li {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: var(--surface-2);
    font-size: 12px;
  }
  .picked :global(svg) {
    color: var(--text-2);
    flex: none;
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
    color: var(--text-3);
    flex: none;
  }
  .picked button {
    display: flex;
    padding: 2px;
    border: 0;
    border-radius: 4px;
    background: none;
    color: var(--text-3);
    cursor: pointer;
  }
  .picked button:hover {
    background: var(--danger-soft);
    color: var(--danger);
  }

  .total {
    margin: 0;
    font-size: 11px;
    color: var(--text-3);
  }

  .problem {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0;
    font-size: 12px;
    color: var(--danger);
  }
  .problem :global(svg) {
    flex: none;
  }
</style>
