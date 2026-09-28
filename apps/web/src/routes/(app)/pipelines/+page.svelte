<script lang="ts">
  import Icon from '$components/Icon.svelte';
  import { pipelineDescription, pipelineName } from '$lib/default-names';
  import { m } from '$lib/i18n';
  import { create, duplicate, pipelines } from '$lib/remote/pipelines.remote';

  /**
   * The pipelines list. It has no artboard of its own
   * (specs/004-bento-redesign T071), so it is drawn from the kit: a tile per
   * pipeline with its bar of steps — the same bar the creation form draws for
   * a pipeline card — its version and who uses it, and a tile to make a new
   * one.
   */
  const list = $derived(pipelines());
  let notice = $state<string | null>(null);
</script>

<header class="page-head">
  <h1>{m.pipelines.heading}</h1>
  <p class="lede">{m.pipelines.lede}</p>
</header>

{#if notice}<p class="tile notice" role="status">{notice}</p>{/if}

{#if list.error}
  <p class="tile tile--danger failure" role="alert">{(list.error as Error).message}</p>
{:else if !list.ready}
  <p class="tile">{m.pipelines.loading}</p>
{:else}
  {#if list.current.length === 0}
    <p class="tile">{m.pipelines.empty}</p>
  {:else}
    <ul class="grid">
      {#each list.current as item (item.id)}
        {@const segments = item.stepCount + 1}
        <li class="tile item">
          <a class="open" href="/pipelines/{item.id}">
            <span class="top">
              <span class="name">{pipelineName(item.name)}</span>
              <span class="count">{m.newTicket.stepCount(segments)}</span>
            </span>
            <span class="bar" aria-hidden="true">
              {#each Array.from({ length: segments }) as _, i (i)}<span class="seg"></span>{/each}
            </span>
            {#if item.description}
              <span class="d">{pipelineDescription(item.name, item.description)}</span>
            {/if}
          </a>
          <span class="foot">
            <span class="chip">{m.pipeline.version(item.currentVersion)}</span>
            <!-- How many repositories use it, before anyone changes it (FR-030) -->
            <span class="chip">
              <Icon name="folder-git-2" size={12} />{m.pipeline.usedBy(item.repositoriesUsing)}
            </span>
            <span class="grow"></span>
            <button
              type="button"
              class="btn btn--secondary small"
              onclick={async () => {
                const result = await duplicate(item.id);
                notice = ('problem' in result ? result.problem : result.message) ?? null;
              }}
            >
              <Icon name="copy" size={13} />{m.pipelines.duplicate}
            </button>
          </span>
        </li>
      {/each}
    </ul>
  {/if}

  <form {...create} class="tile new">
    <h2>{m.pipelines.newPipeline}</h2>
    <div class="fields">
      <label class="field">
        <span class="label">{m.pipelines.name}</span>
        <input name="name" placeholder={m.pipelines.namePlaceholder} required />
      </label>
      <label class="field">
        <span class="label">{m.pipelines.whatItIsFor}</span>
        <input name="description" placeholder={m.pipelines.descriptionPlaceholder} />
      </label>
    </div>
    {#if create.fields.allIssues()?.length}
      <ul class="errors" role="alert">
        {#each create.fields.allIssues() ?? [] as issue (issue.message)}
          <li>{issue.message}</li>
        {/each}
      </ul>
    {/if}
    {#if create.result && 'problem' in create.result}
      <p class="errors" role="alert">{create.result.problem}</p>
    {/if}
    <div class="row">
      <button class="btn" type="submit" disabled={create.pending > 0}>
        <Icon name="plus" size={14} />{m.pipelines.create}
      </button>
    </div>
  </form>
{/if}

<style>
  .page-head {
    margin-bottom: 20px;
    padding: 8px 4px 0;
  }
  h1 {
    margin: 0;
    font-size: 30px;
    font-weight: 600;
    letter-spacing: -0.6px;
  }
  .lede {
    margin: 6px 0 0;
    color: var(--text-2);
  }
  .notice,
  .failure {
    margin: 0 0 20px;
    padding: 14px 20px;
  }
  .failure {
    color: var(--danger-text);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: 20px;
    margin: 0 0 20px;
    padding: 0;
    list-style: none;
  }
  .item {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .open {
    display: flex;
    flex-direction: column;
    gap: 10px;
    text-decoration: none;
    color: inherit;
  }
  .open:hover .name {
    text-decoration: underline;
  }
  .top {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
  }
  .name {
    overflow: hidden;
    font-family: var(--font-head);
    font-size: 18px;
    font-weight: 600;
    letter-spacing: -0.3px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .count {
    flex: none;
    font-family: var(--font-head);
    font-size: var(--type-caption);
    font-weight: 600;
    color: var(--text-2);
  }
  .bar {
    display: flex;
    gap: 3px;
  }
  .seg {
    flex: 1;
    height: 5px;
    border-radius: 3px;
    background: linear-gradient(90deg, var(--accent-from), var(--accent-to));
  }
  .d {
    font-size: var(--type-body);
    color: var(--text-2);
  }
  .foot {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }
  .grow {
    flex: 1;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 5px 10px;
    border-radius: var(--r-pill);
    font-size: var(--type-caption);
    font-weight: 500;
    color: var(--text-2);
    background: var(--surface-2);
  }
  .btn.small {
    padding: 8px 12px;
  }
  .new {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .new h2 {
    margin: 0;
    font-size: 18px;
    font-weight: 600;
  }
  .fields {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 16px;
  }
  .row {
    display: flex;
    justify-content: flex-end;
  }
  .errors {
    margin: 0;
    padding: 12px 16px 12px 32px;
    border-radius: 12px;
    color: var(--danger-text);
    background: var(--danger-soft);
  }
  @media (max-width: 800px) {
    .fields {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
