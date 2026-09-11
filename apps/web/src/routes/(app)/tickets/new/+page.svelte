<script lang="ts">
  import Icon from '$components/Icon.svelte';
  import { pipelines } from '$lib/remote/pipelines.remote';
  import { repositories } from '$lib/remote/repositories.remote';
  import { create, preview } from '$lib/remote/tickets.remote';

  /**
   * Screen 05 — Create Ticket, built to `design.pen`: one form card with a
   * hint beside every label, the pipeline chosen as cards rather than hidden
   * in a select, and beside it what will actually happen if you press the
   * button (FR-019).
   *
   * The preview is the point of the screen. Nothing starts until someone
   * presses Create, and by then they have read the steps, which of them are
   * conditional and on what, whether anything verifies the result, and what
   * comparable runs cost (FR-019a, FR-034a, SC-016).
   */

  const repos = $derived(repositories());
  const pipes = $derived(pipelines());

  let repositoryId = $state('');
  let pipelineId = $state('');

  const repo = $derived(
    repos.ready ? repos.current.find((row) => row.id === repositoryId) : undefined,
  );

  /** Empty means the repository's default, which is a real pipeline. */
  const effectiveId = $derived(pipelineId || (repo?.defaultPipelineId ?? ''));
  const chosen = $derived(
    pipes.ready ? pipes.current.find((row) => row.id === effectiveId) : undefined,
  );
  const plan = $derived(
    chosen ? preview({ pipelineId: chosen.id, version: chosen.currentVersion }) : null,
  );
  const shown = $derived(plan?.ready ? plan.current : null);

  const KIND: Record<string, { icon: string; tone: string }> = {
    agent: { icon: 'bot', tone: 'accent' },
    design: { icon: 'palette', tone: 'design' },
    checkpoint: { icon: 'hand', tone: 'gate' },
    shell: { icon: 'terminal', tone: 'plain' },
    notify: { icon: 'bell', tone: 'purple' },
  };
</script>

<div class="wrap">
  <form {...create} class="card form">
    <h1>Describe what you want built</h1>

    <div class="field">
      <div class="label-row">
        <label for="repositoryId">Repository</label>
        <span class="hint">Required</span>
      </div>
      <div class="select">
        {#if repo}<Icon name={repo.provider} size={16} />{:else}<Icon
            name="folder-git-2"
            size={16}
          />{/if}
        <select id="repositoryId" name="repositoryId" bind:value={repositoryId} required>
          <option value="" disabled>Choose a repository…</option>
          {#each repos.ready ? repos.current : [] as row (row.id)}
            <!-- A repository whose credential no longer works cannot start a
                 run, so it cannot be chosen here (FR-013). -->
            <option value={row.id} disabled={row.status !== 'connected'}>
              {row.name} · {row.fullPath}{row.status !== 'connected' ? ' — token expired' : ''}
            </option>
          {/each}
        </select>
        <Icon name="chevron-down" size={16} />
      </div>
    </div>

    <div class="field">
      <div class="label-row">
        <label for="title">Title</label>
        <span class="hint">Required</span>
      </div>
      <input id="title" name="title" required placeholder="Add Apple Sign-In next to Google login" />
    </div>

    <div class="field">
      <div class="label-row">
        <label for="description">Description</label>
        <span class="hint">
          Plain language is fine. The Spec agent will ask itself the clarifying questions.
        </span>
      </div>
      <textarea
        id="description"
        name="description"
        rows="6"
        placeholder="What should change, and why?"
      ></textarea>
    </div>

    <div class="field">
      <div class="label-row">
        <label for="acceptanceCriteria">Acceptance criteria</label>
        <span class="hint">One per line. The Implement agent must make all of these pass.</span>
      </div>
      <textarea
        id="acceptanceCriteria"
        name="acceptanceCriteria"
        rows="4"
        placeholder={'Apple button visible on /login for all users\nSuccessful sign-in creates or links a user record'}
      ></textarea>
    </div>

    <div class="field">
      <div class="label-row">
        <span class="as-label">Pipeline</span>
        <span class="hint">You can change its steps for this ticket only, in the builder.</span>
      </div>
      <div class="picks">
        {#each pipes.ready ? pipes.current : [] as row (row.id)}
          <!-- The repository's default is this same card, submitting an empty
               value: one card per pipeline, and picking the default keeps
               meaning "whatever this repository is set to". -->
          {@const isDefault = repo?.defaultPipelineId === row.id}
          {@const value = isDefault ? '' : row.id}
          <label class="pick" class:on={pipelineId === value}>
            <input type="radio" name="pipelineId" {value} bind:group={pipelineId} />
            <span class="t">
              <span class="n">{row.name}</span>
              {#if isDefault}<span class="tag">{repo?.name}'s default</span>{/if}
              <span class="grow"></span>
              {#if pipelineId === value}<Icon name="circle-check" size={16} />{/if}
            </span>
            <span class="d">{row.description ?? `Version ${row.currentVersion}`}</span>
          </label>
        {/each}
      </div>
    </div>

    {#if create.fields.issues()?.length}
      <ul class="errors" role="alert">
        {#each create.fields.issues() ?? [] as issue (issue.message)}
          <li>{issue.message}</li>
        {/each}
      </ul>
    {/if}

    {#if create.result?.queuedNotStarted}
      <p class="banner bad" role="alert">
        {create.result.reference} was created and is queued, but has <strong>not started</strong>:
        the orchestrator could not be reached ({create.result.detail}). It will be retried.
      </p>
    {:else if create.result?.started}
      <p class="banner good" role="status">{create.result.reference} started.</p>
    {:else if create.result}
      <p class="banner good" role="status">{create.result.reference} saved as a draft.</p>
    {/if}

    <footer>
      <span class="note">
        {#if shown?.estimate.kind === 'measured'}
          Estimated cost ≈ ${shown.estimate.costUsd} · usually about {shown.estimate.minutes} min
        {:else if shown}
          No comparable run yet · up to ${shown.estimate.ceilingUsd} and
          {shown.estimate.ceilingMinutes} min
        {:else}
          Choose a repository and a pipeline to see what it will cost.
        {/if}
      </span>
      <span class="btns">
        <button class="secondary" type="submit" name="start" value="false"
          disabled={create.pending > 0}
        >
          <Icon name="file-text" size={16} />
          <span>Save as draft</span>
        </button>
        <button class="primary" type="submit" name="start" value="true"
          disabled={create.pending > 0}
        >
          <Icon name="rocket" size={16} />
          <span>{create.pending > 0 ? 'Creating…' : 'Create & start pipeline'}</span>
        </button>
      </span>
    </footer>
  </form>

  <aside class="side">
    <section class="card">
      <h2>What will happen</h2>
      {#if !chosen}
        <p class="quiet">Choose a repository and a pipeline to see the steps that will run.</p>
      {:else if !shown}
        <p class="quiet">Working out the steps…</p>
      {:else}
        <ol class="steps">
          {#each shown.steps as step (step.index)}
            {@const kind = KIND[step.type] ?? KIND.agent}
            <li>
              <span class="line">
                <span class="ic {kind?.tone}">
                  <Icon name={step.icon ?? kind?.icon ?? 'bot'} size={15} />
                </span>
                <span class="v"></span>
              </span>
              <span class="tx">
                <span class="tr">
                  <span class="n">{step.label}</span>
                  <!-- Conditional steps state their condition in words
                       (FR-019a, FR-032f) -->
                  {#if step.conditionText}
                    <span class="cond">{step.conditionText}</span>
                  {/if}
                </span>
                {#if step.description}<span class="d">{step.description}</span>{/if}
                {#if step.model}<span class="m">{step.model}</span>{/if}
              </span>
            </li>
          {/each}
          <li class="last">
            <span class="line"><span class="ic ok"><Icon name="git-pull-request" size={15} /></span
              ></span>
            <span class="tx">
              <span class="tr"><span class="n">Open merge request</span></span>
              <span class="m">Branch pushed, merge request created, ticket closed</span>
            </span>
          </li>
        </ol>

        <!-- SC-016: you can tell whether the pipeline verifies the result -->
        {#if shown.warning}
          <p class="banner warn">{shown.warning}</p>
        {:else}
          <p class="quiet">This pipeline runs your tests before opening the merge request.</p>
        {/if}
      {/if}
    </section>

    <p class="tip">
      <Icon name="lightbulb" size={16} />
      <span>
        The Spec agent decides whether this ticket touches the interface. If it does, the Design
        step runs and you review the screens before any code is written.
      </span>
    </p>
  </aside>
</div>

<style>
  .wrap {
    display: flex;
    align-items: flex-start;
    gap: 24px;
  }
  .card {
    background: var(--surface);
    border: 1px solid var(--card-border);
    border-radius: var(--r-lg);
    box-shadow: 0 1px 2px #0f172a0a;
    padding: 20px;
  }
  .form {
    display: flex;
    flex-direction: column;
    gap: 18px;
    flex: 1;
    min-width: 0;
  }
  h1 {
    margin: 0;
    font-family: var(--font-head);
    font-size: 18px;
    font-weight: 600;
    color: var(--text);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .label-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 16px;
  }
  label,
  .as-label {
    font-size: 12px;
    font-weight: 600;
    color: var(--text);
  }
  .hint {
    font-size: 11px;
    color: var(--text-3);
    text-align: right;
  }

  input,
  textarea {
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: var(--surface);
    font: inherit;
    font-size: 13px;
    color: var(--text);
    width: 100%;
    resize: vertical;
  }
  input:focus,
  textarea:focus,
  select:focus {
    outline: 2px solid var(--accent-soft);
    border-color: var(--accent);
  }

  .select {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 12px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: var(--surface);
  }
  .select :global(svg) {
    color: var(--text-2);
    flex: none;
  }
  .select select {
    flex: 1;
    min-width: 0;
    padding: 10px 0;
    border: 0;
    background: none;
    font: inherit;
    font-size: 13px;
    color: var(--text);
    appearance: none;
  }

  /* The pipeline is a choice between named things, so it is shown as one. */
  .picks {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .pick {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    cursor: pointer;
  }
  .pick input {
    position: absolute;
    width: 1px;
    height: 1px;
    opacity: 0;
  }
  .pick .t {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .pick .n {
    font-size: 13px;
    font-weight: 600;
    color: var(--text);
  }
  .grow {
    flex: 1;
  }
  .tag {
    padding: 2px 8px;
    border-radius: 999px;
    background: var(--surface-2);
    font-size: 11px;
    color: var(--text-3);
  }
  .pick.on .tag {
    background: var(--surface);
    color: var(--accent-text);
  }
  .pick .d {
    font-size: 12px;
    color: var(--text-2);
  }
  .pick:hover {
    border-color: var(--accent);
  }
  .pick.on {
    background: var(--accent-soft);
    border-color: var(--accent-soft);
  }
  .pick.on .n,
  .pick.on .d,
  .pick.on :global(svg) {
    color: var(--accent-text);
  }

  footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    flex-wrap: wrap;
    padding-top: 4px;
  }
  .note {
    font-size: 12px;
    color: var(--text-3);
  }
  .btns {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  button {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 10px 16px;
    border-radius: var(--r-sm);
    font: inherit;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
  }
  .secondary {
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text);
  }
  .secondary :global(svg) {
    color: var(--text-2);
  }
  .secondary:hover:not(:disabled) {
    border-color: var(--accent);
  }
  .primary {
    border: 1px solid var(--accent);
    background: var(--accent);
    color: var(--text-inv);
    font-weight: 600;
  }
  button:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  /* ---- the preview ---- */
  .side {
    display: flex;
    flex-direction: column;
    gap: 16px;
    width: 340px;
    flex: none;
  }
  .side .card {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 16px;
  }
  h2 {
    margin: 0;
    font-family: var(--font-head);
    font-size: 15px;
    font-weight: 600;
    color: var(--text);
  }

  .steps {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
  }
  .steps li {
    display: flex;
    gap: 12px;
  }
  .line {
    display: flex;
    flex-direction: column;
    align-items: center;
    flex: none;
  }
  .ic {
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    border-radius: 6px;
    flex: none;
    background: var(--surface-2);
    color: var(--text-2);
  }
  .ic.accent {
    background: var(--accent-soft);
    color: var(--accent-text);
  }
  .ic.design {
    background: var(--design-soft);
    color: var(--design);
  }
  .ic.gate {
    background: var(--warning-soft);
    color: var(--warning);
  }
  .ic.purple {
    background: var(--purple-soft);
    color: var(--purple);
  }
  .ic.ok {
    background: var(--success-soft);
    color: var(--success);
  }
  .v {
    flex: 1;
    width: 2px;
    min-height: 14px;
    background: var(--border);
  }
  .tx {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding-bottom: 12px;
    min-width: 0;
  }
  .steps li.last .tx {
    padding-bottom: 0;
  }
  .tr {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .steps .n {
    font-size: 13px;
    font-weight: 600;
    color: var(--text);
  }
  .steps .d {
    font-size: 12px;
    color: var(--text-2);
  }
  .cond {
    padding: 2px 8px;
    border-radius: 999px;
    background: var(--design-soft);
    font-size: 11px;
    color: var(--design);
  }
  .steps .m {
    font-size: 11px;
    color: var(--text-3);
  }

  .tip {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    margin: 0;
    padding: 12px 14px;
    border-radius: var(--r-md);
    background: var(--accent-soft);
    font-size: 12px;
    color: var(--accent-text);
  }
  .tip :global(svg) {
    flex: none;
  }

  .quiet {
    margin: 0;
    font-size: 12px;
    color: var(--text-2);
  }
  .banner {
    margin: 0;
    padding: 10px 14px;
    border-radius: var(--r-md);
    font-size: 13px;
  }
  .banner.good {
    background: var(--success-soft);
    color: var(--success);
  }
  .banner.bad {
    background: var(--danger-soft);
    color: var(--danger);
  }
  .banner.warn {
    background: var(--warning-soft);
    color: var(--warning);
  }
  .errors {
    margin: 0;
    padding-left: 18px;
    color: var(--danger);
  }

  @media (max-width: 1100px) {
    .wrap {
      flex-direction: column;
    }
    .side {
      width: auto;
      align-self: stretch;
    }
  }
</style>
