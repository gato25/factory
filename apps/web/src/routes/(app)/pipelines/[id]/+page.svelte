<script lang="ts">
  import type { Step } from '@factory/shared';
  import { page } from '$app/state';
  import PipelineBuilder from '$components/PipelineBuilder.svelte';
  import { agents } from '$lib/remote/agents.remote';
  import { duplicate, pipeline, save } from '$lib/remote/pipelines.remote';
  import { members } from '$lib/remote/workspace.remote';
  import { problemsWith } from '$lib/services/pipeline-validate';

  /**
   * Screen 08 — Pipeline Builder. The vertical flow, the step palette, drag
   * to reorder, and a + on each connector. Everything here edits a draft;
   * saving writes a new version and leaves runs in flight alone (FR-027).
   */
  const id = $derived(page.params.id as string);
  const detail = $derived(pipeline(id));
  const agentList = $derived(agents());
  const memberList = $derived(members());

  /** The draft. Seeded from the saved version, then owned by this screen. */
  let draft = $state<Step[] | null>(null);
  let loadedVersion = $state<number | null>(null);
  let notice = $state<string | null>(null);

  $effect(() => {
    if (!detail.ready) return;
    // Re-seed when the saved version changes underneath us, not on every
    // refresh, or a keystroke would be undone by the query it triggered.
    if (loadedVersion !== detail.current.currentVersion) {
      draft = structuredClone(detail.current.steps);
      loadedVersion = detail.current.currentVersion;
    }
  });

  const steps = $derived(draft ?? []);
  const problems = $derived(draft ? problemsWith(draft) : []);
  const dirty = $derived(
    detail.ready && draft
      ? JSON.stringify(draft) !== JSON.stringify(detail.current.steps)
      : false
  );
</script>

{#if detail.error}
  <p class="card failure" role="alert">{(detail.error as Error).message}</p>
{:else if !detail.ready || draft === null}
  <p class="card">Loading the pipeline…</p>
{:else}
  {@const p = detail.current}

  <header class="card head">
    <div>
      <p class="small muted"><a href="/pipelines">Pipelines</a></p>
      <h1>{p.name}</h1>
      <p class="small muted">
        Version {p.currentVersion}
        <!-- How many repositories use it, before anyone changes it (FR-030) -->
        &middot; used by {p.repositoriesUsing} repositor{p.repositoriesUsing === 1
          ? 'y'
          : 'ies'}
        {#if p.runsInFlight > 0}
          &middot; {p.runsInFlight} run{p.runsInFlight === 1 ? '' : 's'} in flight
        {/if}
      </p>
    </div>
    <div class="actions">
      {#if !p.mayChange}
        <span class="badge small">
          {p.ownerId ? 'Someone else owns this' : 'Shipped default'} — you can use it, not change it
        </span>
      {/if}
      <button
        type="button"
        onclick={async () => {
          const result = await duplicate(p.id);
          notice = ('problem' in result ? result.problem : result.message) ?? null;
        }}>Duplicate</button
      >
    </div>
  </header>

  {#if notice}<p class="card notice" role="status">{notice}</p>{/if}

  {#if p.runsInFlight > 0 && dirty}
    <!-- SC-010: editing changes the behaviour of zero runs already in flight -->
    <p class="card notice" role="status">
      {p.runsInFlight} run{p.runsInFlight === 1 ? '' : 's'} on this pipeline
      {p.runsInFlight === 1 ? 'is' : 'are'} in flight. Saving does not affect
      {p.runsInFlight === 1 ? 'it' : 'them'}: each continues on the version it started with.
    </p>
  {/if}

  {#if save.result && 'problem' in save.result && save.result.problem}
    <p class="card failure" role="alert">{save.result.problem}</p>
  {:else if save.result && 'message' in save.result}
    <p class="card notice" role="status">{save.result.message}</p>
  {/if}

  <PipelineBuilder
    bind:steps={draft}
    agents={agentList.ready ? agentList.current : []}
    members={memberList.ready ? memberList.current : []}
    {problems}
    editable={p.mayChange}
  />

  {#if p.mayChange}
    <!-- Saving is a form, so it does not depend on JavaScript any more than
         approving does. The draft rides along as JSON. -->
    <form {...save} class="card saver">
      <input type="hidden" name="pipelineId" value={p.id} />
      <input type="hidden" name="steps" value={JSON.stringify(steps)} />
      <div class="saver-row">
        <span class="small muted">
          {#if problems.length > 0}
            {problems.length} thing{problems.length === 1 ? '' : 's'} to fix before this can be
            saved.
          {:else if dirty}
            Saving writes version {p.currentVersion + 1}.
          {:else}
            Nothing to save.
          {/if}
        </span>
        <button
          class="primary"
          type="submit"
          disabled={!dirty || problems.length > 0 || save.pending > 0}
        >
          Save as version {p.currentVersion + 1}
        </button>
      </div>
      {#if save.fields.allIssues()?.length}
        <ul class="errors" role="alert">
          {#each save.fields.allIssues() ?? [] as issue (issue.message)}
            <li>{issue.message}</li>
          {/each}
        </ul>
      {/if}
    </form>
  {/if}
{/if}

<style>
  .head {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 16px;
    flex-wrap: wrap;
    margin-bottom: 16px;
  }
  .head p { margin: 0 0 4px; }
  h1 { margin: 0 0 4px; font-size: 20px; }
  .actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .notice { border-left: 3px solid var(--accent); margin-bottom: 16px; padding: 12px 16px; }
  .failure { border-left: 3px solid var(--danger); margin-bottom: 16px; padding: 12px 16px; }
  .saver { margin-top: 16px; }
  .saver-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }
  button {
    padding: 8px 14px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: var(--surface);
    font: inherit;
    cursor: pointer;
  }
  button.primary {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
    font-weight: 600;
  }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
  .errors { margin: 8px 0 0; padding-left: 18px; color: var(--danger); }
</style>
