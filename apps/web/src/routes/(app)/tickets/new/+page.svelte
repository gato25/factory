<script lang="ts">
  import FilePicker from '$components/FilePicker.svelte';
  import Icon from '$components/Icon.svelte';
  import { agentDescription, agentName, pipelineDescription, pipelineName } from '$lib/default-names';
  import { modelName } from '$lib/format';
  import { m } from '$lib/i18n';
  import { pipelines } from '$lib/remote/pipelines.remote';
  import { repositories } from '$lib/remote/repositories.remote';
  import { create, preview } from '$lib/remote/tickets.remote';

  /**
   * Screen 05 — Create Ticket, built to artboard 05: one form tile with a
   * hint beside every label, the pipeline chosen as cards that each show how
   * many steps it has, and beside it what will actually happen if you press
   * the button — every step with its agent and engine, a conditional one
   * marked with its condition (specs/004-bento-redesign FR-019).
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
    agent: { icon: 'bot', tone: '' },
    design: { icon: 'pen-tool', tone: 'orb--pen' },
    checkpoint: { icon: 'hand', tone: 'orb--amber' },
    shell: { icon: 'terminal', tone: '' },
    notify: { icon: 'bell', tone: '' },
  };

  type Previewed = NonNullable<typeof shown>['steps'][number];

  /** A step as a person reads it: a shipped agent in the catalogue's words (FR-028). */
  function nameOf(step: Previewed): string {
    if (step.type === 'agent' || step.type === 'design') return agentName(step.label);
    if (step.type === 'shell') return step.label;
    return m.stepKind[step.type];
  }
  function detailOf(step: Previewed): string | null {
    if (step.type === 'agent' || step.type === 'design') {
      return agentDescription(step.label, step.description ?? null);
    }
    return m.stepKind[`${step.type}Detail`];
  }
  /** "pen.dev · Claude Opus 5" for a design step, the model alone otherwise. */
  function engineOf(step: Previewed): string | null {
    if (!step.model) return null;
    return step.engine === 'design_cli' ? m.newTicket.onPen(modelName(step.model)) : modelName(step.model);
  }
</script>

<header class="page-head">
  <nav class="crumb" aria-label={m.newTicket.crumb}>
    <a href="/tickets">{m.board.heading}</a>
    <Icon name="chevron-right" size={13} />
    <span aria-current="page">{m.frame.newTicket}</span>
  </nav>
  <h1>{m.newTicket.heading}</h1>
</header>

<div class="wrap">
  <!--
    `enctype` because this form carries a file input (the requirement files).
    Without it a native submit sends the file NAMES and not the files, so the
    enhanced and unenhanced paths disagree — which is what SvelteKit warns
    about rather than silently allowing. It goes after the spread so it is not
    overwritten by it.
  -->
  <form {...create} enctype="multipart/form-data" class="tile form">
    <div class="field">
      <div class="label-row">
        <label class="label" for="repositoryId">{m.newTicket.repository}</label>
        <span class="hint">{m.newTicket.required}</span>
      </div>
      <div class="select">
        <span class="mini-orb" aria-hidden="true">
          <Icon name={repo ? repo.provider : 'folder-git-2'} size={14} />
        </span>
        <select id="repositoryId" name="repositoryId" bind:value={repositoryId} required>
          <option value="" disabled>{m.newTicket.chooseRepository}</option>
          {#each repos.ready ? repos.current : [] as row (row.id)}
            <!-- A repository whose credential no longer works cannot start a
                 run, so it cannot be chosen here (FR-013). -->
            <option value={row.id} disabled={row.status !== 'connected'}>
              {row.name} · {row.fullPath}{row.status !== 'connected'
                ? m.newTicket.tokenExpiredSuffix
                : ''}
            </option>
          {/each}
        </select>
        <Icon name="chevron-down" size={15} />
      </div>
    </div>

    <div class="field">
      <div class="label-row">
        <label class="label" for="title">{m.newTicket.title}</label>
        <span class="hint">{m.newTicket.required}</span>
      </div>
      <input id="title" name="title" required placeholder={m.newTicket.titlePlaceholder} />
    </div>

    <div class="field">
      <div class="label-row">
        <label class="label" for="description">{m.newTicket.description}</label>
        <span class="hint">{m.newTicket.descriptionHint}</span>
      </div>
      <textarea
        id="description"
        name="description"
        rows="4"
        placeholder={m.newTicket.descriptionPlaceholder}
      ></textarea>
    </div>

    <div class="field">
      <div class="label-row">
        <label class="label" for="acceptanceCriteria">{m.newTicket.acceptance}</label>
        <span class="hint">{m.newTicket.acceptanceHint}</span>
      </div>
      <textarea
        id="acceptanceCriteria"
        name="acceptanceCriteria"
        rows="3"
        placeholder={m.newTicket.acceptancePlaceholder}
      ></textarea>
    </div>

    <div class="field">
      <div class="label-row">
        <label class="label" for="files">{m.newTicket.files}</label>
        <span class="hint">{m.newTicket.filesHint}</span>
      </div>
      <FilePicker />
    </div>

    <div class="field">
      <div class="label-row">
        <span class="label" id="pipeline-label">{m.newTicket.pipeline}</span>
        <span class="hint">{m.newTicket.pipelineHint}</span>
      </div>
      <div class="picks" role="radiogroup" aria-labelledby="pipeline-label">
        {#each pipes.ready ? pipes.current : [] as row (row.id)}
          <!-- The repository's default is this same card, submitting an empty
               value: one card per pipeline, and picking the default keeps
               meaning "whatever this repository is set to". -->
          {@const isDefault = repo?.defaultPipelineId === row.id}
          {@const value = isDefault ? '' : row.id}
          {@const segments = row.stepCount + 1}
          <label class="pick" class:on={pipelineId === value} data-pipeline={row.id}>
            <input type="radio" name="pipelineId" {value} bind:group={pipelineId} />
            <span class="t">
              <span class="n">{pipelineName(row.name)}</span>
              <span class="c" data-steps={segments}>{m.newTicket.stepCount(segments)}</span>
            </span>
            <span class="bar" aria-hidden="true">
              {#each Array.from({ length: segments }) as _, i (i)}<span class="seg"></span>{/each}
            </span>
            <span class="d">
              {pipelineDescription(row.name, row.description) ?? m.newTicket.version(row.currentVersion)}
            </span>
            {#if isDefault}<span class="tag">{m.newTicket.defaultFor(repo?.name ?? '')}</span>{/if}
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
        {m.newTicket.queuedNotStartedBefore(create.result.reference)}<strong
          >{m.newTicket.notStarted}</strong
        >{m.newTicket.queuedNotStartedAfter(create.result.detail ?? '')}
      </p>
    {:else if create.result?.started}
      <p class="banner good" role="status">{m.newTicket.started(create.result.reference)}</p>
    {:else if create.result}
      <p class="banner good" role="status">{m.newTicket.savedAsDraft(create.result.reference)}</p>
    {/if}

    <footer>
      <span class="note">
        <Icon name="coins" size={15} />
        {#if shown?.estimate.kind === 'measured'}
          {m.newTicket.estimateMeasured(shown.estimate.costUsd, shown.estimate.minutes)}
        {:else if shown}
          {m.newTicket.estimateCeiling(
            shown.estimate.ceilingUsd,
            shown.estimate.ceilingMinutes,
          )}
        {:else}
          {m.newTicket.estimateUnknown}
        {/if}
      </span>
      <span class="btns">
        <button class="btn btn--secondary" type="submit" name="start" value="false"
          disabled={create.pending > 0}
        >
          {m.newTicket.saveAsDraft}
        </button>
        <button class="btn" type="submit" name="start" value="true"
          disabled={create.pending > 0}
        >
          {create.pending > 0 ? m.newTicket.creating : m.newTicket.createAndStart}
          <Icon name="arrow-right" size={15} />
        </button>
      </span>
    </footer>
  </form>

  <aside class="side">
    <section class="tile happen" aria-labelledby="what-will-happen">
      <header class="happen-head">
        <h2 id="what-will-happen">{m.newTicket.whatWillHappen}</h2>
        {#if chosen}
          <p class="sub">{m.newTicket.pipelineSteps(pipelineName(chosen.name), chosen.stepCount + 1)}</p>
        {/if}
      </header>
      {#if !chosen}
        <p class="quiet">{m.newTicket.chooseToSeeSteps}</p>
      {:else if !shown}
        <p class="quiet">{m.newTicket.workingOutSteps}</p>
      {:else}
        <ol class="steps">
          {#each shown.steps as step (step.index)}
            {@const kind = KIND[step.type] ?? KIND.agent}
            {@const engine = engineOf(step)}
            {@const detail = detailOf(step)}
            <li data-step-type={step.type}>
              <span class="rail">
                <span class="orb orb--sm {kind?.tone}" aria-hidden="true">
                  <Icon name={step.icon ?? kind?.icon ?? 'bot'} size={15} />
                </span>
                <span class="v"></span>
              </span>
              <span class="tx">
                <span class="tr">
                  <span class="n">{nameOf(step)}</span>
                  <!-- Conditional steps state their condition in words
                       (FR-019a, FR-032f) -->
                  {#if step.condition !== 'always'}
                    <span class="cond">{m.newTicket.condition[step.condition]}</span>
                  {/if}
                </span>
                {#if detail}<span class="d">{detail}</span>{/if}
                {#if engine}
                  <span class="e" class:pen={step.engine === 'design_cli'}>{engine}</span>
                {/if}
              </span>
            </li>
          {/each}
          <li class="last" data-step-type="merge_request">
            <span class="rail">
              <span class="orb orb--sm orb--mint" aria-hidden="true">
                <Icon name="git-pull-request" size={15} />
              </span>
            </span>
            <span class="tx">
              <span class="tr"><span class="n">{m.newTicket.openMergeRequest}</span></span>
              <span class="d">{m.newTicket.openMergeRequestNote}</span>
            </span>
          </li>
        </ol>

        <!-- SC-016: you can tell whether the pipeline verifies the result -->
        {#if !shown.verifies}
          <p class="banner warn">{m.newTicket.noVerification}</p>
        {:else}
          <p class="quiet">{m.newTicket.testsBeforeMr}</p>
        {/if}
      {/if}
    </section>

    <p class="tile tile--design tip">
      <span class="orb orb--sm orb--pen tip-orb" aria-hidden="true"><Icon name="lightbulb" size={15} /></span>
      <span>{m.newTicket.tip}</span>
    </p>
  </aside>
</div>

<style>
  .page-head {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: 20px;
    padding: 8px 4px 0;
  }
  .crumb {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--text-3);
  }
  .crumb a {
    color: var(--text-3);
    text-decoration: none;
  }
  .crumb a:hover {
    text-decoration: underline;
  }
  .crumb [aria-current] {
    font-weight: 600;
    color: var(--text-2);
  }
  h1 {
    margin: 0;
    font-size: 30px;
    font-weight: 600;
    letter-spacing: -0.6px;
  }

  .wrap {
    display: flex;
    align-items: flex-start;
    gap: 20px;
  }
  .form {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 20px;
    min-width: 0;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .label-row {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 12px;
  }
  .label {
    font-size: var(--type-body);
    font-weight: 600;
    color: var(--text);
  }
  .hint {
    font-size: var(--type-caption);
    text-align: right;
    color: var(--text-3);
  }

  input,
  textarea,
  .select {
    width: 100%;
    padding: 12px 14px;
    border: 0;
    border-radius: 12px;
    font: var(--type-body) / 1.45 var(--font);
    color: var(--text);
    background: var(--surface-2);
    box-shadow: inset 0 1px 3px #3a2a1a1a;
  }
  textarea {
    resize: vertical;
  }
  input::placeholder,
  textarea::placeholder {
    color: var(--text-3);
  }
  .select {
    display: flex;
    align-items: center;
    gap: 10px;
    color: var(--text-3);
  }
  .select:focus-within {
    box-shadow: var(--focus-ring);
  }
  .select select {
    flex: 1;
    min-width: 0;
    padding: 0;
    border: 0;
    font: inherit;
    color: var(--text);
    background: none;
    appearance: none;
  }
  .select select:focus {
    outline: none;
    box-shadow: none;
  }
  .mini-orb {
    display: grid;
    flex: none;
    place-items: center;
    width: 26px;
    height: 26px;
    border-radius: 8px;
    color: var(--text-inv);
    background: linear-gradient(180deg, var(--accent-from), var(--accent-to));
  }

  .picks {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 12px;
  }
  .pick {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 14px;
    border-radius: 16px;
    background: var(--surface-2);
    box-shadow: inset 0 0 0 2px transparent;
    cursor: pointer;
  }
  .pick:focus-within {
    box-shadow: var(--focus-ring);
  }
  .pick.on {
    background: var(--accent-soft);
    box-shadow: inset 0 0 0 2px var(--accent);
  }
  .pick input {
    position: absolute;
    opacity: 0;
    pointer-events: none;
  }
  .pick .t {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .pick .n {
    font-size: var(--type-body);
    font-weight: 700;
    color: var(--text);
  }
  .pick .c {
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
    background: var(--text-inv-2);
  }
  .pick.on .seg {
    background: linear-gradient(90deg, var(--accent-from), var(--accent-to));
  }
  .pick .d {
    font-size: var(--type-caption);
    line-height: 1.4;
    color: var(--text-2);
  }
  .tag {
    align-self: flex-start;
    padding: 2px 8px;
    border-radius: var(--r-pill);
    font-size: var(--type-caption);
    font-weight: 600;
    color: var(--accent-text);
    background: var(--surface);
  }

  .errors {
    margin: 0;
    padding: 12px 16px 12px 32px;
    border-radius: 12px;
    color: var(--danger-text);
    background: var(--danger-soft);
  }
  .banner {
    margin: 0;
    padding: 12px 16px;
    border-radius: 12px;
    font-size: var(--type-body);
  }
  .banner.good {
    color: var(--success-text);
    background: var(--success-soft);
  }
  .banner.bad {
    color: var(--danger-text);
    background: var(--danger-soft);
  }
  .banner.warn {
    color: var(--danger-text);
    background: var(--danger-soft);
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
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--text-2);
  }
  .note :global(svg) {
    flex: none;
    color: var(--text-3);
  }
  .btns {
    display: flex;
    gap: 10px;
  }

  .side {
    display: flex;
    flex: none;
    flex-direction: column;
    gap: 20px;
    width: 420px;
  }
  .happen-head {
    padding-bottom: 18px;
  }
  h2 {
    margin: 0;
    font-size: 19px;
    font-weight: 600;
    letter-spacing: -0.3px;
  }
  .sub {
    margin: 4px 0 0;
    font-size: var(--type-caption);
    color: var(--text-2);
  }
  .quiet {
    margin: 0;
    color: var(--text-2);
  }
  .steps {
    margin: 0 0 16px;
    padding: 0;
    list-style: none;
  }
  .steps li {
    display: flex;
    gap: 14px;
  }
  .rail {
    display: flex;
    flex: none;
    flex-direction: column;
    align-items: center;
    width: 34px;
  }
  .rail .orb {
    width: 34px;
    height: 34px;
  }
  .v {
    flex: 1;
    width: 2px;
    min-height: 16px;
    background: var(--text-inv-2);
  }
  .tx {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
    padding: 2px 0 16px;
  }
  .tr {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
  }
  .tx .n {
    font-size: var(--type-body);
    font-weight: 700;
    color: var(--text);
  }
  .cond {
    padding: 2px 8px;
    border-radius: var(--r-pill);
    font-size: var(--type-caption);
    font-weight: 700;
    color: var(--pen-text);
    background: var(--purple-soft);
  }
  .tx .d {
    font-size: var(--type-caption);
    line-height: 1.4;
    color: var(--text-2);
  }
  .e {
    font-family: var(--font-head);
    font-size: var(--type-caption);
    font-weight: 600;
    color: var(--text-3);
  }
  .e.pen {
    color: var(--pen-text);
  }

  .tip {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    margin: 0;
    color: var(--pen-text);
  }
  .tip-orb {
    border-radius: 10px;
  }

  @media (max-width: 1100px) {
    .wrap {
      flex-direction: column;
      align-items: stretch;
    }
    .side {
      width: 100%;
    }
  }
</style>
