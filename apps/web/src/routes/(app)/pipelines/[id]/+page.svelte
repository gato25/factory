<script lang="ts">
  import type { Step } from '@factory/shared';
  import { page } from '$app/state';
  import Icon from '$components/Icon.svelte';
  import { pipelineName, stepTitle } from '$lib/default-names';
  import { modelName } from '$lib/format';
  import { m } from '$lib/i18n';
  import PipelineBuilder from '$components/PipelineBuilder.svelte';
  import { agents } from '$lib/remote/agents.remote';
  import { duplicate, pipeline, preflight, rename, save } from '$lib/remote/pipelines.remote';
  import { members } from '$lib/remote/workspace.remote';
  import { problemsWith } from '$lib/services/pipeline-validate';

  /**
   * Screen 08 — Pipeline Builder, built to `design.pen`: a crumb, the name
   * with a pencil beside it and how many repositories use it, then the
   * canvas and the palette, with Duplicate and Test run on the right.
   *
   * Everything on the canvas edits a draft; saving writes a new version and
   * leaves runs in flight alone (FR-027).
   */
  const id = $derived(page.params.id as string);
  const detail = $derived(pipeline(id));
  const agentList = $derived(agents());
  const memberList = $derived(members());

  /** The draft. Seeded from the saved version, then owned by this screen. */
  let draft = $state<Step[] | null>(null);
  let loadedVersion = $state<number | null>(null);
  let notice = $state<string | null>(null);
  let renaming = $state(false);
  let newName = $state('');
  let showPreflight = $state(false);

  const dry = $derived(showPreflight ? preflight(id) : null);
  const dryRun = $derived(dry?.ready ? dry.current : null);

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
  <p class="tile tile--danger failure" role="alert">{(detail.error as Error).message}</p>
{:else if !detail.ready || draft === null}
  <p class="tile">{m.pipeline.loading}</p>
{:else}
  {@const p = detail.current}

  <header class="head">
    <div class="l">
      <p class="crumb">
        <a href="/pipelines">{m.pipeline.breadcrumb}</a>
        <Icon name="chevron-right" size={14} />
        <span>{pipelineName(p.name)}</span>
      </p>

      <div class="name-row">
        {#if renaming}
          <input
            class="rename"
            aria-label={m.pipeline.nameLabel}
            bind:value={newName}
            onkeydown={async (event) => {
              if (event.key === 'Escape') renaming = false;
              if (event.key !== 'Enter') return;
              event.preventDefault();
              const result = await rename({ pipelineId: p.id, name: newName });
              notice = result && 'problem' in result ? result.problem : null;
              renaming = false;
            }}
          />
        {:else}
          <h1>{pipelineName(p.name)}</h1>
          {#if p.mayChange}
            <button
              type="button"
              class="icon"
              aria-label={m.pipeline.rename}
              onclick={() => {
                newName = p.name;
                renaming = true;
              }}
            >
              <Icon name="pencil" size={16} />
            </button>
          {/if}
        {/if}

        <!-- How many repositories use it, before anyone changes it (FR-030) -->
        <span class="used"><Icon name="folder-git-2" size={12} />{m.pipeline.usedBy(p.repositoriesUsing)}</span>
        <span class="chip">{m.pipeline.version(p.currentVersion)}</span>
        {#if p.runsInFlight > 0}
          <span class="chip">{m.pipeline.runsInFlight(p.runsInFlight)}</span>
        {/if}
      </div>

      <p class="sub">
        {#if p.mayChange}
          {m.pipeline.dragHint}
        {:else if p.ownerId}
          {m.pipeline.someoneElseOwns}
        {:else}
          {m.pipeline.shippedDefault}
        {/if}
      </p>
    </div>

    <div class="r">
      <button
        type="button"
        class="btn btn--secondary"
        onclick={async () => {
          const result = await duplicate(p.id);
          notice = ('problem' in result ? result.problem : result.message) ?? null;
        }}
      >
        <Icon name="copy" size={14} />
        {m.pipeline.duplicate}
      </button>
      <button
        type="button"
        class="btn"
        aria-pressed={showPreflight}
        onclick={() => (showPreflight = !showPreflight)}
      >
        <Icon name="play" size={14} />
        {m.pipeline.testRun}
      </button>
    </div>
  </header>

  {#if showPreflight}
    <!-- A dry run: what a ticket starting on version {p.currentVersion} would
         do, and what comparable runs cost. It starts nothing (FR-019). -->
    <section class="tile dry">
      <header>
        <h2>{m.pipeline.preflightHeading}</h2>
        <span class="small muted">{m.pipeline.preflightNote(p.currentVersion)}</span>
      </header>
      {#if dry?.error}
        <p class="failure" role="alert">{(dry.error as Error).message}</p>
      {:else if !dryRun}
        <p class="small muted">{m.pipeline.workingItOut}</p>
      {:else}
        <ol class="dry-steps">
          {#each dryRun.steps as preview (preview.index)}
            <li>
              <span class="i">{preview.index + 1}</span>
              <span class="t">
                {stepTitle({ type: preview.type, label: preview.label })}
                {#if preview.model}<span class="muted">· {modelName(preview.model)}</span>{/if}
              </span>
              {#if preview.conditional}
                <span class="cond">{m.newTicket.condition[preview.condition]}</span>
              {/if}
            </li>
          {/each}
        </ol>
        <p class="small muted">
          {#if dryRun.estimate.kind === 'measured'}
            {m.pipeline.estimateMeasured(
              dryRun.estimate.minutes,
              dryRun.estimate.costUsd,
              dryRun.estimate.samples,
            )}
          {:else}
            {m.pipeline.estimateNone(
              dryRun.estimate.ceilingUsd,
              dryRun.estimate.ceilingMinutes,
            )}
          {/if}
        </p>
        {#if !dryRun.verifies}
          <p class="small warn-text">
            {m.pipeline.nothingVerifies}
          </p>
        {/if}
      {/if}
    </section>
  {/if}

  {#if notice}<p class="tile notice" role="status">{notice}</p>{/if}

  {#if p.runsInFlight > 0 && dirty}
    <!-- SC-010: editing changes the behaviour of zero runs already in flight -->
    <p class="tile notice" role="status">{m.pipeline.inFlightNote(p.runsInFlight)}</p>
  {/if}

  {#if save.result && 'problem' in save.result && save.result.problem}
    <p class="tile tile--danger failure" role="alert">{save.result.problem}</p>
  {:else if save.result && 'message' in save.result}
    <p class="tile notice" role="status">{save.result.message}</p>
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
    <form {...save} class="tile saver">
      <input type="hidden" name="pipelineId" value={p.id} />
      <input type="hidden" name="steps" value={JSON.stringify(steps)} />
      <div class="saver-row">
        <span class="small muted">
          {#if problems.length > 0}
            {m.pipeline.toFix(problems.length)}
          {:else if dirty}
            {m.pipeline.willWrite(p.currentVersion + 1)}
          {:else}
            {m.pipeline.nothingToSave}
          {/if}
        </span>
        <button
          class="btn"
          type="submit"
          disabled={!dirty || problems.length > 0 || save.pending > 0}
        >
          {m.pipeline.saveAs(p.currentVersion + 1)}
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
    align-items: flex-end;
    justify-content: space-between;
    gap: 24px;
    margin-bottom: 20px;
    padding: 4px 4px 0;
  }
  .l {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
  }
  .crumb {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0;
    color: var(--text-3);
  }
  .crumb a {
    color: var(--text-3);
    text-decoration: none;
  }
  .crumb a:hover {
    text-decoration: underline;
  }
  .crumb span {
    font-weight: 600;
    color: var(--text-2);
  }
  .name-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
  }
  h1 {
    margin: 0;
    font-size: 30px;
    font-weight: 600;
    letter-spacing: -0.6px;
  }
  .rename {
    padding: 6px 10px;
    border: 0;
    border-radius: 10px;
    font: 600 24px / 1.2 var(--font-head);
    background: var(--surface);
    box-shadow: var(--focus-ring);
  }
  button.icon {
    display: grid;
    place-items: center;
    padding: 4px;
    border: 0;
    border-radius: 8px;
    color: var(--text-3);
    background: none;
    cursor: pointer;
  }
  button.icon:hover {
    color: var(--text-2);
    background: #ffffffb3;
  }
  .used,
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 5px 11px;
    border-radius: var(--r-pill);
    font-size: var(--type-caption);
    font-weight: 600;
  }
  .used {
    color: var(--accent-text);
    background: var(--accent-soft);
  }
  .chip {
    font-weight: 500;
    color: var(--text-2);
    background: #ffffffcc;
  }
  .sub {
    max-width: 720px;
    margin: 0;
    color: var(--text-2);
  }
  .r {
    display: flex;
    flex: none;
    gap: 10px;
  }
  .r .btn[aria-pressed='true'] {
    box-shadow: var(--focus-ring);
  }

  .dry {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin-bottom: 20px;
  }
  .dry > header {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 12px;
  }
  .dry h2 {
    margin: 0;
    font-size: 18px;
    font-weight: 600;
  }
  .dry p {
    margin: 0;
  }
  .dry-steps {
    display: flex;
    flex-direction: column;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .dry-steps li {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 0;
    border-top: 1px solid var(--surface-2);
  }
  .dry-steps li:first-child {
    border-top: 0;
  }
  .dry-steps .i {
    display: grid;
    flex: none;
    place-items: center;
    width: 24px;
    height: 24px;
    border-radius: var(--r-pill);
    font: 700 var(--type-caption) / 1 var(--font-head);
    color: var(--text-inv);
    background: linear-gradient(180deg, var(--accent-deep-from), var(--accent-deep-to));
  }
  .dry-steps .t {
    flex: 1;
    font-size: var(--type-body);
  }
  .cond {
    padding: 2px 8px;
    border-radius: var(--r-pill);
    font-size: var(--type-caption);
    font-weight: 700;
    color: var(--pen-text);
    background: var(--purple-soft);
  }
  .notice,
  .failure {
    margin: 0 0 20px;
    padding: 14px 20px;
  }
  .failure {
    color: var(--danger-text);
  }
  .saver {
    margin-top: 20px;
    padding: 16px 20px;
  }
  .saver-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
  }
  .errors {
    margin: 12px 0 0;
    padding: 12px 16px 12px 32px;
    border-radius: 12px;
    color: var(--danger-text);
    background: var(--danger-soft);
  }

  @media (max-width: 900px) {
    .head {
      flex-direction: column;
      align-items: flex-start;
    }
  }
  /* Needing attention is red, whatever else is near it (FR-005). */
  .warn-text {
    color: var(--danger-text);
  }
</style>
