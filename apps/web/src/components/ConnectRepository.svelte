<script lang="ts">
  import Icon from '$components/Icon.svelte';
  import { pipelineDescription, pipelineName } from '$lib/default-names';
  import { m } from '$lib/i18n';
  import { pipelines } from '$lib/remote/pipelines.remote';
  import { connect, requiredScopes } from '$lib/remote/repositories.remote';
  import { tokenPageUrl } from '$lib/services/providers';

  /**
   * Artboard 03 — Connect Repository: a bento dialog over the blurred
   * repositories page, its four numbered steps and behaviour unchanged
   * (specs/004-bento-redesign FR-017).
   *
   * The scopes are stated at the point the credential is entered, not in
   * documentation somebody has to find (FR-010). "Өөрийн Git сервер" is on
   * the artboard and deliberately absent here: this version connects
   * GitLab.com and GitHub.com and nothing else, and offering a third that
   * refuses every address would be worse than not offering it (FR-014a).
   */

  const scopes = $derived(requiredScopes());
  const available = $derived(pipelines());

  let provider = $state<'gitlab' | 'github'>('gitlab');
  let open = $state(false);

  const providers = [
    { id: 'gitlab' as const, label: 'GitLab', host: 'https://gitlab.com/' },
    { id: 'github' as const, label: 'GitHub', host: 'https://github.com/' },
  ];
</script>

<button type="button" class="btn" onclick={() => (open = true)}>
  <Icon name="plus" size={15} />
  {m.connect.open}
</button>

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="scrim" onclick={() => (open = false)}></div>
  <div class="tile modal" role="dialog" aria-modal="true" aria-labelledby="connect-heading">
    <header>
      <div class="tx">
        <h2 id="connect-heading">{m.connect.heading}</h2>
        <p>
          {m.connect.lede(
            provider === 'gitlab' ? m.provider.mergeRequests : m.provider.pullRequests,
          )}
        </p>
      </div>
      <button type="button" class="close" aria-label={m.connect.close} onclick={() => (open = false)}>
        <Icon name="x" size={16} />
      </button>
    </header>

    <form
      {...connect.enhance(async ({ submit }) => {
        await submit();
        if (connect.result) open = false;
      })}
    >
      <fieldset class="step">
        <legend class="step-head"><span class="num">1</span><span class="step-title">{m.connect.stepProvider}</span></legend>
        <div class="providers">
          {#each providers as option (option.id)}
            <label class="provider" class:on={provider === option.id}>
              <input type="radio" bind:group={provider} value={option.id} />
              <span class="provider-top">
                <span class="mark {option.id}" aria-hidden="true"><Icon name={option.id} size={17} /></span>
                {#if provider === option.id}
                  <span class="check" aria-hidden="true"><Icon name="check" size={12} /></span>
                {/if}
              </span>
              <span class="provider-name">{option.label}</span>
              <span class="provider-sub">
                {provider === option.id ? m.connect.chosen : option.host.replace('https://', '').replace('/', '')}
              </span>
            </label>
          {/each}
        </div>
      </fieldset>

      <div class="step">
        <label class="step-head" for="url"><span class="num">2</span><span class="step-title">{m.connect.stepUrl}</span></label>
        <div class="input">
          <Icon name="link" size={15} />
          <input
            id="url"
            name="url"
            type="url"
            required
            placeholder={`${providers.find((p) => p.id === provider)?.host}netgroup/shop-frontend`}
          />
        </div>
      </div>

      <div class="step">
        <label class="step-head" for="token"><span class="num">3</span><span class="step-title">{m.connect.stepToken}</span></label>
        <div class="input">
          <Icon name="key-round" size={15} />
          <input id="token" name="token" type="password" required autocomplete="off" />
        </div>
        <!-- The permissions, at the point the credential is entered (FR-010) -->
        <p class="hint">
          {#if scopes.ready}
            {m.connect.scopes(scopes.current[provider].join(', '))}
          {:else}
            {m.connect.scopesLoading}
          {/if}
        </p>
        <!--
          Naming the scopes is necessary and not sufficient: somebody still
          has to find the right settings page and tick boxes worded
          differently from how we word them. Both providers take the choices
          as query parameters, so this link does that part.
        -->
        <p class="hint">
          <a href={tokenPageUrl(provider)} target="_blank" rel="noreferrer noopener">
            {m.connect.createOne(provider === 'gitlab' ? 'GitLab' : 'GitHub')}
          </a>
          {m.provider.tokenPageNote[provider]}
        </p>
      </div>

      <div class="step">
        <label class="step-head" for="defaultPipelineId"><span class="num">4</span><span class="step-title">{m.connect.stepPipeline}</span></label>
        <div class="input">
          <Icon name="workflow" size={15} />
          <select id="defaultPipelineId" name="defaultPipelineId">
            <option value="">{m.connect.noPipeline}</option>
            {#each available.ready ? available.current : [] as pipeline (pipeline.id)}
              {@const about = pipelineDescription(pipeline.name, pipeline.description)}
              <option value={pipeline.id}>
                {pipelineName(pipeline.name)}{about ? ` (${about})` : ''}
              </option>
            {/each}
          </select>
          <Icon name="chevron-down" size={15} />
        </div>
      </div>

      {#if connect.fields.issues()?.length}
        <ul class="errors" role="alert">
          {#each connect.fields.issues() ?? [] as issue (issue.message)}
            <li>{issue.message}</li>
          {/each}
        </ul>
      {/if}

      <footer>
        <button type="button" class="btn btn--secondary" onclick={() => (open = false)}>
          {m.connect.cancel}
        </button>
        <button class="btn" type="submit" disabled={connect.pending > 0}>
          <Icon name="shield-check" size={15} />
          {connect.pending > 0 ? m.connect.testing : m.connect.testAndConnect}
        </button>
      </footer>
    </form>
  </div>
{/if}

<style>
  /* The page behind stays in view, blurred: the dialog is a step of the
     repositories screen, not a screen of its own. */
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 20;
    background: var(--scrim);
    backdrop-filter: blur(6px);
  }
  .modal {
    position: fixed;
    top: 6vh;
    left: 50%;
    z-index: 21;
    display: flex;
    flex-direction: column;
    gap: 22px;
    width: min(640px, calc(100vw - 32px));
    max-height: 88vh;
    padding: 32px;
    overflow-y: auto;
    border-radius: 28px;
    transform: translateX(-50%);
    box-shadow: 0 30px 60px #16140f40;
  }
  header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
  }
  .tx {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  h2 {
    margin: 0;
    font-size: 26px;
    font-weight: 700;
    letter-spacing: -0.6px;
  }
  header p {
    margin: 0;
    color: var(--text-2);
  }
  .close {
    display: grid;
    flex: none;
    place-items: center;
    width: 36px;
    height: 36px;
    border: 0;
    border-radius: 11px;
    color: var(--text-2);
    background: var(--surface-2);
    cursor: pointer;
  }

  form {
    display: flex;
    flex-direction: column;
    gap: 22px;
  }
  .step {
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-width: 0;
    margin: 0;
    padding: 0;
    border: 0;
  }
  .step-head {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0;
    font-size: var(--type-body);
    font-weight: 600;
    color: var(--text);
  }
  .num {
    display: grid;
    flex: none;
    place-items: center;
    width: 24px;
    height: 24px;
    border-radius: var(--r-pill);
    font-family: var(--font-head);
    font-size: var(--type-caption);
    font-weight: 700;
    color: var(--text-inv);
    background: linear-gradient(180deg, var(--accent-deep-from), var(--accent-deep-to));
  }

  .providers {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
  }
  .provider {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 16px;
    border-radius: 18px;
    background: var(--surface-2);
    cursor: pointer;
  }
  .provider.on {
    background: var(--accent-soft);
    box-shadow: inset 0 0 0 2px var(--accent);
  }
  .provider:focus-within {
    box-shadow: var(--focus-ring);
  }
  .provider input {
    position: absolute;
    opacity: 0;
    pointer-events: none;
  }
  .provider-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .mark {
    display: grid;
    place-items: center;
    width: 34px;
    height: 34px;
    border-radius: 11px;
    color: var(--text-inv);
    background: linear-gradient(180deg, var(--accent-from), var(--accent-to));
  }
  .mark.github {
    background: linear-gradient(180deg, #4a4540, #1e1b18);
  }
  .check {
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    border-radius: var(--r-pill);
    color: var(--text-inv);
    background: linear-gradient(180deg, var(--accent-deep-from), var(--accent-deep-to));
  }
  .provider-name {
    font-size: var(--type-body);
    font-weight: 700;
  }
  .provider-sub {
    font-size: var(--type-caption);
    color: var(--text-2);
  }

  .input {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 14px;
    border-radius: 12px;
    color: var(--text-3);
    background: var(--surface-2);
    box-shadow: inset 0 1px 3px #3a2a1a1a;
  }
  .input:focus-within {
    box-shadow: var(--focus-ring);
  }
  .input input,
  .input select {
    flex: 1;
    min-width: 0;
    padding: 0;
    border: 0;
    font: var(--type-body) / 1.4 var(--font);
    color: var(--text);
    background: none;
    appearance: none;
  }
  .input input:focus,
  .input select:focus {
    outline: none;
    box-shadow: none;
  }
  #token {
    font-family: var(--font-mono);
  }
  .hint {
    margin: 0;
    font-size: var(--type-caption);
    color: var(--text-2);
  }
  .hint a {
    font-weight: 600;
    color: var(--accent-text);
  }
  .errors {
    margin: 0;
    padding: 12px 16px 12px 32px;
    border-radius: 12px;
    color: var(--danger-text);
    background: var(--danger-soft);
  }
  footer {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    padding-top: 6px;
  }
</style>
