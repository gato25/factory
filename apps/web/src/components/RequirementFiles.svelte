<script lang="ts">
  import { describeBytes } from '@factory/shared';
  import FilePicker from '$components/FilePicker.svelte';
  import Icon from '$components/Icon.svelte';
  import { attach, detach, ticketFiles } from '$lib/remote/tickets.remote';

  /**
   * The requirement documents a ticket carries, on the ticket's own page.
   *
   * Here rather than only on the create form because the case that actually
   * happens is somebody writing the ticket, and the brief arriving afterwards.
   * Without this, the only way to attach it is a second ticket.
   *
   * What it deliberately does NOT do is warn that a run is in flight. A run
   * reads its documents once, when its sandbox is built, so attaching one now
   * cannot disturb it — the same rule that already governs the pipeline and
   * the ceilings. The note below says so, because the question occurs to
   * everybody who uses this while a run is going.
   */

  let { ticketId, hasRun = false }: { ticketId: string; hasRun?: boolean } = $props();

  const files = $derived(ticketFiles(ticketId));
  let removing = $state<string | null>(null);
  let notice = $state<string | null>(null);

  const total = $derived(
    files.ready ? files.current.reduce((sum, file) => sum + file.bytes, 0) : 0
  );

  async function remove(id: string, name: string) {
    removing = id;
    try {
      const { removed } = await detach({ ticketId, fileId: id });
      notice = removed ? `${name} хасагдлаа.` : `${name} аль хэдийн байхгүй байсан.`;
    } finally {
      removing = null;
    }
  }
</script>

<section class="card">
  <header>
    <Icon name="book-open" size={15} />
    <h2>Шаардлага</h2>
    {#if files.ready && files.current.length > 0}
      <span class="count">{files.current.length} · {describeBytes(total)}</span>
    {/if}
  </header>

  {#if files.ready && files.current.length > 0}
    <ul>
      {#each files.current as file (file.id)}
        <li>
          <Icon name="file-text" size={14} />
          <span class="n">{file.name}</span>
          <span class="s">{describeBytes(file.bytes)}</span>
          <button
            type="button"
            disabled={removing === file.id}
            onclick={() => remove(file.id, file.name)}
            aria-label="{file.name}-ийг хасах"
          >
            <Icon name="x" size={14} />
          </button>
        </li>
      {/each}
    </ul>
  {:else if files.ready}
    <p class="empty">Хавсаргасан зүйл алга. Агентууд зөвхөн даалгаврын бичвэрээр ажиллана.</p>
  {/if}

  <!-- Same reason as the new-ticket form: a file input needs this to submit files. -->
  <form {...attach} enctype="multipart/form-data">
    <input type="hidden" name="ticketId" value={ticketId} />
    <FilePicker />
    <button class="add" type="submit">
      <Icon name="plus" size={14} />
      Хавсаргах
    </button>
  </form>

  {#if notice}<p class="notice">{notice}</p>{/if}

  {#if hasRun}
    <p class="note">
      Ажиллагаа эдгээрийг sandbox-оо байгуулах үедээ нэг л удаа уншина. Эндээс өөрчилсөн нь дараагийн
      оролдлогод нөлөөлөх бөгөөд явж байгаа нэгэнд нь биш.
    </p>
  {/if}
</section>

<style>
  .card {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 16px;
    border: 1px solid var(--card-border);
    border-radius: var(--r-md);
    background: var(--surface);
  }

  header {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  header :global(svg) {
    color: var(--text-2);
    flex: none;
  }
  h2 {
    flex: 1;
    margin: 0;
    font-size: 13px;
    font-weight: 600;
    color: var(--text);
  }
  .count {
    font-size: 11px;
    color: var(--text-3);
  }

  ul {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  li {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    border-radius: var(--r-sm);
    background: var(--surface-2);
    font-size: 12px;
  }
  li :global(svg) {
    color: var(--text-2);
    flex: none;
  }
  .n {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text);
  }
  .s {
    flex: none;
    color: var(--text-3);
  }
  li button {
    display: flex;
    padding: 2px;
    border: 0;
    border-radius: 4px;
    background: none;
    color: var(--text-3);
    cursor: pointer;
  }
  li button:hover:not(:disabled) {
    background: var(--danger-soft);
    color: var(--danger);
  }
  li button:disabled {
    opacity: 0.4;
    cursor: progress;
  }

  form {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .add {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 8px 12px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: var(--surface);
    font: inherit;
    font-size: 12px;
    font-weight: 500;
    color: var(--text);
    cursor: pointer;
  }
  .add:hover {
    background: var(--surface-2);
  }

  .empty,
  .note,
  .notice {
    margin: 0;
    font-size: 11px;
    color: var(--text-3);
    line-height: 1.5;
  }
  .notice {
    color: var(--text-2);
  }
</style>
