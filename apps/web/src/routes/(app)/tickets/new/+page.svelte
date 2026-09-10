<script lang="ts">
  import { pipelines } from '$lib/remote/pipelines.remote';
  import { repositories } from '$lib/remote/repositories.remote';
  import { create, preview } from '$lib/remote/tickets.remote';

  let repositoryId = $state('');
  let pipelineId = $state('');
  let start = $state(true);
</script>

<div class="layout">
  <form {...create} class="ticket">
    <label class="field">
      <span>Repository <em>required</em></span>
      <select name="repositoryId" bind:value={repositoryId} required>
        <option value="" disabled>Choose a repository…</option>
        {#await repositories() then rows}
          {#each rows as repo (repo.id)}
            <option value={repo.id} disabled={repo.status !== 'connected'}>
              {repo.fullPath}{repo.status !== 'connected' ? ' — token expired' : ''}
            </option>
          {/each}
        {/await}
      </select>
    </label>

    <label class="field">
      <span>Title <em>required</em></span>
      <input name="title" required placeholder="Add Google OAuth sign-in" />
    </label>

    <label class="field">
      <span>Description</span>
      <textarea name="description" rows="4" placeholder="What should change, and why?"></textarea>
    </label>

    <label class="field">
      <span>Acceptance criteria — one per line</span>
      <textarea
        name="acceptanceCriteria"
        rows="5"
        placeholder={'A "Continue with Google" button appears on the sign-in screen\nThe existing test suite still passes'}
      ></textarea>
      <small>These are the biggest quality lever you have. Be specific and testable.</small>
    </label>

    <label class="field">
      <span>Pipeline</span>
      <select name="pipelineId" bind:value={pipelineId}>
        <option value="">Use the repository's default</option>
        {#await pipelines() then rows}
          {#each rows as pipeline (pipeline.id)}
            <option value={pipeline.id}>{pipeline.name} — {pipeline.description}</option>
          {/each}
        {/await}
      </select>
    </label>

    {#if create.fields.issues()?.length}
      <ul class="errors" role="alert">
        {#each create.fields.issues() ?? [] as issue (issue.message)}
          <li>{issue.message}</li>
        {/each}
      </ul>
    {/if}

    {#if create.result?.queuedNotStarted}
      <p class="warn" role="alert">
        {create.result.reference} was created and is queued, but has <strong>not started</strong>:
        the orchestrator could not be reached ({create.result.detail}). It will be retried.
      </p>
    {:else if create.result?.started}
      <p class="ok">{create.result.reference} started.</p>
    {:else if create.result}
      <p class="ok">{create.result.reference} saved as a draft.</p>
    {/if}

    <footer>
      <label class="inline">
        <input type="checkbox" name="start" bind:checked={start} value="true" />
        Start the pipeline now
      </label>
      <button class="primary" type="submit" disabled={create.pending > 0}>
        {create.pending > 0 ? 'Creating…' : start ? 'Create & start pipeline' : 'Save as draft'}
      </button>
    </footer>
  </form>

  <aside class="what">
    <h2>What will happen</h2>
    {#if pipelineId}
      {#await pipelines() then rows}
        {@const chosen = rows.find((p) => p.id === pipelineId)}
        {#if chosen}
          {#await preview({ pipelineId: chosen.id, version: chosen.currentVersion }) then p}
            <ol class="steps">
              {#each p.steps as step (step.index)}
                <li class:conditional={step.conditional}>
                  <strong>{step.label}</strong>
                  {#if step.model}<span class="model">{step.model}</span>{/if}
                  <!-- Conditional steps state their condition in words (FR-019a, FR-032f) -->
                  {#if step.conditionText}<em>{step.conditionText}</em>{/if}
                </li>
              {/each}
              <li class="implicit"><strong>Open merge request</strong></li>
            </ol>

            <!-- SC-016: you can tell whether the pipeline verifies the result -->
            {#if p.warning}
              <p class="warn">{p.warning}</p>
            {:else}
              <p class="ok">This pipeline runs your tests before opening the merge request.</p>
            {/if}

            <dl class="estimate">
              {#if p.estimate.kind === 'measured'}
                <dt>Estimated cost</dt>
                <dd>${p.estimate.costUsd}</dd>
                <dt>Estimated duration</dt>
                <dd>{p.estimate.minutes} min</dd>
                <dd class="note">
                  From {p.estimate.samples} comparable run{p.estimate.samples === 1 ? '' : 's'}.
                  Not a commitment.
                </dd>
              {:else}
                <dt>Estimate</dt>
                <dd>No comparable runs yet.</dd>
                <dd class="note">
                  This run may spend up to ${p.estimate.ceilingUsd} and take up to
                  {p.estimate.ceilingMinutes} minutes.
                </dd>
              {/if}
            </dl>
          {/await}
        {/if}
      {/await}
    {:else}
      <p class="hint">Choose a pipeline to see the steps that will run.</p>
    {/if}
  </aside>
</div>

<style>
  .layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 320px;
    gap: 24px;
    align-items: start;
  }
  .ticket,
  .what {
    background: #fff;
    border-radius: 8px;
    padding: 20px;
  }
  .ticket {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .field > span {
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: #6b7280;
  }
  .field em {
    color: #b3261e;
    font-style: normal;
  }
  input,
  select,
  textarea {
    padding: 9px 10px;
    border: 1px solid #dfe3ea;
    border-radius: 6px;
    font: inherit;
  }
  small,
  .note,
  .hint {
    color: #6b7280;
    font-size: 12px;
  }
  h2 {
    margin: 0 0 12px;
    font-size: 14px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: #6b7280;
  }
  .steps {
    margin: 0 0 12px;
    padding-left: 20px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .steps li.conditional {
    color: #6b7280;
  }
  .steps li.implicit {
    color: #6b7280;
    list-style: none;
  }
  .model {
    display: block;
    font-size: 12px;
    color: #6b7280;
  }
  .steps em {
    display: block;
    font-size: 12px;
    font-style: italic;
  }
  .estimate {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 4px 10px;
    margin: 0;
  }
  .estimate dt {
    color: #6b7280;
    font-size: 12px;
  }
  .estimate dd {
    margin: 0;
    font-weight: 600;
  }
  .estimate dd.note {
    grid-column: 1 / -1;
    font-weight: 400;
  }
  .warn {
    background: #fff8e1;
    border-left: 3px solid #e6a700;
    padding: 10px 12px;
    margin: 0 0 12px;
    font-size: 13px;
  }
  .ok {
    color: #14733c;
    font-size: 13px;
    margin: 0 0 12px;
  }
  .errors {
    margin: 0;
    padding-left: 18px;
    color: #b3261e;
  }
  footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    border-top: 1px solid #eef1f7;
    padding-top: 16px;
  }
  .inline {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  button.primary {
    padding: 10px 16px;
    border: 0;
    border-radius: 6px;
    background: #3d5afe;
    color: #fff;
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  @media (max-width: 900px) {
    .layout {
      grid-template-columns: 1fr;
    }
  }
</style>
