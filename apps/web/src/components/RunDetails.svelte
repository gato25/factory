<script lang="ts">
  import QueuePosition from '$components/QueuePosition.svelte';
  import { position } from '$lib/remote/runs.remote';
  import type { RunView } from '$lib/services/run-view';

  let { view }: { view: RunView } = $props();

  const place = $derived(view.run.status === 'queued' ? position(view.run.id) : null);
</script>

<section class="card">
  <h2>Ажиллагааны мэдээлэл</h2>
  <dl>
    <dt>Дамжлага</dt>
    <dd>{view.pipeline.name} <span class="muted small">v{view.pipeline.version}</span></dd>

    <dt>Ажиллагаа</dt>
    <dd>
      {view.ticket.reference}-r{view.run.attempt}
      <span class="muted">({view.run.attempt}-р оролдлого)</span>
    </dd>

    <dt>Репозитори</dt>
    <dd>{view.repository.fullPath}</dd>

    <dt>Салбар</dt>
    <dd><code>{view.ticket.branchName}</code> → <code>{view.repository.defaultBranch}</code></dd>

    <dt>Тусгаарлагдсан орчин</dt>
    <dd>
      {#if view.run.containerId}
        <code>{view.run.containerId.slice(0, 12)}</code>
      {:else}
        <span class="muted">үүсээгүй</span>
      {/if}
    </dd>

    <!-- A reference identifying the execution on the execution service (FR-078) -->
    <dt>Гүйцэтгэл</dt>
    <dd>
      {#if view.run.orchestratorExecutionId}
        <code>{view.run.orchestratorExecutionId}</code>
      {:else}
        <span class="muted">эхлээгүй</span>
      {/if}
    </dd>

    <dt>Төсөв</dt>
    <dd>${view.run.costCeilingUsd}-ийн хязгаараас ${view.run.costUsd}</dd>
  </dl>

  {#if place?.ready}
    <!-- Runs beyond the concurrency ceiling wait, and see where (FR-082) -->
    <QueuePosition position={place.current} />
  {/if}

  {#if view.ticket.classificationMissing}
    <!-- FR-102: the warning is a field on the run, not a log line -->
    <p class="badge warn">
      Тодорхойлолтын алхам интерфейсийн талаар шийдвэр тэмдэглээгүй тул дизайн алгассан байна. Энэ
      даалгаварт дэлгэц хэрэгтэй байсан эсэхийг шалгана уу.
    </p>
  {:else if view.ticket.hasUi !== null}
    <p class="small muted">
      {view.ticket.hasUi ? 'Интерфейс өөрчилнө' : 'Интерфейс өөрчлөхгүй'}
      {#if view.ticket.uiRationale}— {view.ticket.uiRationale}{/if}
    </p>
  {/if}
</section>

<style>
  .card {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 16px;
    background: var(--surface);
    border: 1px solid var(--card-border);
    border-radius: var(--r-lg);
    box-shadow: 0 1px 2px #0f172a0a;
  }
  h2 {
    margin: 0;
    font-family: var(--font-head);
    font-size: 15px;
    font-weight: 600;
    color: var(--text);
  }
  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 8px 16px;
    margin: 0;
    font-size: 12px;
  }
  dt {
    color: var(--text-2);
  }
  dd {
    margin: 0;
    color: var(--text);
    text-align: right;
    overflow-wrap: anywhere;
  }
  code {
    background: var(--surface-2);
    padding: 1px 5px;
    border-radius: 4px;
    font-size: 11px;
  }
  p.badge {
    display: block;
    margin: 0;
    line-height: 1.5;
  }
</style>
