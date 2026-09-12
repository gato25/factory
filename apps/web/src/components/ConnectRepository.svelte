<script lang="ts">
  import Icon from '$components/Icon.svelte';
  import { pipelines } from '$lib/remote/pipelines.remote';
  import { connect, requiredScopes } from '$lib/remote/repositories.remote';
  import { TOKEN_PAGE_NOTE, tokenPageUrl } from '$lib/services/providers';

  /**
   * `design.pen`'s 03 Connect Repository: a 560px modal over a half-weight
   * scrim, four numbered steps, and a footer on its own grey ground.
   *
   * The scopes are stated at the point the credential is entered, not in
   * documentation somebody has to find (FR-010). "Self-hosted Git" is on the
   * artboard and deliberately absent here: this version connects GitLab.com
   * and GitHub.com and nothing else, and offering a third that refuses every
   * address would be worse than not offering it (FR-014a).
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

<button class="primary" onclick={() => (open = true)}>
  <Icon name="plus" size={16} />
  <span>Connect repository</span>
</button>

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="scrim" onclick={() => (open = false)}></div>
  <div class="modal" role="dialog" aria-modal="true" aria-label="Connect a repository">
    <header>
      <div class="tx">
        <h2>Connect a repository</h2>
        <p>
          The factory needs permission to read code, push branches and open
          {provider === 'gitlab' ? 'merge requests' : 'pull requests'}.
        </p>
      </div>
      <button type="button" class="close" aria-label="Close" onclick={() => (open = false)}>
        <Icon name="x" size={20} />
      </button>
    </header>

    <form
      {...connect.enhance(async ({ submit }) => {
        await submit();
        if (connect.result) open = false;
      })}
    >
      <div class="body">
        <fieldset>
          <legend>1. Choose provider</legend>
          <div class="providers">
            {#each providers as option (option.id)}
              <label class:on={provider === option.id}>
                <input type="radio" bind:group={provider} value={option.id} />
                <Icon name={option.id} size={24} />
                <span>{option.label}</span>
              </label>
            {/each}
          </div>
        </fieldset>

        <div class="field">
          <label for="url">2. Repository URL</label>
          <div class="input">
            <Icon name="link" size={16} />
            <input
              id="url"
              name="url"
              type="url"
              required
              placeholder={`${providers.find((p) => p.id === provider)?.host}netgroup/shop-frontend`}
            />
          </div>
        </div>

        <div class="field">
          <label for="token">3. Access token</label>
          <div class="input">
            <Icon name="key-round" size={16} />
            <input id="token" name="token" type="password" required autocomplete="off" />
          </div>
          <!-- The permissions, at the point the credential is entered (FR-010) -->
          <p class="hint">
            {#if scopes.ready}
              Needs scopes: {scopes.current[provider].join(', ')}. Stored encrypted and never shown
              again — not even to you.
            {:else}
              Loading the required permissions…
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
              Create one on {provider === 'gitlab' ? 'GitLab' : 'GitHub'} →
            </a>
            {TOKEN_PAGE_NOTE[provider]}
          </p>
        </div>

        <div class="field">
          <label for="defaultPipelineId">4. Default pipeline for new tickets</label>
          <div class="input">
            <select id="defaultPipelineId" name="defaultPipelineId">
              <option value="">None — each ticket picks one</option>
              {#each available.ready ? available.current : [] as pipeline (pipeline.id)}
                <option value={pipeline.id}>
                  {pipeline.name}{pipeline.description ? ` (${pipeline.description})` : ''}
                </option>
              {/each}
            </select>
            <Icon name="chevron-down" size={16} />
          </div>
        </div>

        {#if connect.fields.issues()?.length}
          <ul class="errors" role="alert">
            {#each connect.fields.issues() ?? [] as issue (issue.message)}
              <li>{issue.message}</li>
            {/each}
          </ul>
        {/if}
      </div>

      <footer>
        <button type="button" class="secondary" onclick={() => (open = false)}>
          <Icon name="x" size={16} />
          <span>Cancel</span>
        </button>
        <button class="primary" type="submit" disabled={connect.pending > 0}>
          <Icon name="plug" size={16} />
          <span>{connect.pending > 0 ? 'Testing…' : 'Test & connect'}</span>
        </button>
      </footer>
    </form>
  </div>
{/if}

<style>
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 20;
    background: var(--scrim);
  }
  .modal {
    position: fixed;
    top: 8vh;
    left: 50%;
    transform: translateX(-50%);
    z-index: 21;
    display: flex;
    flex-direction: column;
    width: min(560px, calc(100vw - 32px));
    max-height: 84vh;
    background: var(--surface);
    border-radius: var(--r-lg);
    box-shadow: 0 20px 50px #0f172a40;
    overflow: hidden;
  }

  header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    padding: 20px;
    border-bottom: 1px solid var(--border);
  }
  .tx {
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-width: 440px;
  }
  h2 {
    margin: 0;
    font-family: var(--font-head);
    font-size: 17px;
    font-weight: 600;
    color: var(--text);
  }
  header p {
    margin: 0;
    font-size: 13px;
    color: var(--text-2);
  }
  .close {
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    padding: 0;
    border: 0;
    border-radius: var(--r-sm);
    background: none;
    color: var(--text-3);
    cursor: pointer;
    flex: none;
  }
  .close:hover {
    background: var(--surface-2);
    color: var(--text-2);
  }

  form {
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  .body {
    display: flex;
    flex-direction: column;
    gap: 18px;
    padding: 20px;
    overflow-y: auto;
  }

  fieldset {
    border: 0;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  legend,
  .field label {
    font-size: 13px;
    font-weight: 600;
    color: var(--text);
    padding: 0;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .providers {
    display: flex;
    gap: 10px;
  }
  .providers label {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    flex: 1;
    padding: 14px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    font-size: 13px;
    font-weight: 500;
    color: var(--text);
    cursor: pointer;
  }
  .providers label :global(svg) {
    color: var(--text-2);
  }
  .providers label:hover {
    border-color: var(--accent);
  }
  .providers label.on {
    background: var(--accent-soft);
    border-color: var(--accent-soft);
    color: var(--accent-text);
  }
  .providers label.on :global(svg) {
    color: var(--accent-text);
  }
  .providers input {
    position: absolute;
    width: 1px;
    height: 1px;
    opacity: 0;
  }

  .input {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 12px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: var(--surface);
  }
  .input :global(svg) {
    color: var(--text-3);
    flex: none;
  }
  .input input,
  .input select {
    flex: 1;
    min-width: 0;
    padding: 11px 0;
    border: 0;
    background: none;
    font: inherit;
    font-size: 13px;
    color: var(--text);
    appearance: none;
  }
  .input input:focus,
  .input select:focus {
    outline: none;
  }
  .input:focus-within {
    border-color: var(--accent);
  }
  .hint {
    margin: 0;
    font-size: 11px;
    color: var(--text-3);
  }

  footer {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    padding: 14px 20px;
    background: var(--surface-2);
    border-top: 1px solid var(--border);
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
  .primary {
    border: 1px solid var(--accent);
    background: var(--accent);
    color: var(--text-inv);
    font-weight: 600;
  }
  .primary:disabled {
    opacity: 0.6;
    cursor: progress;
  }

  .errors {
    margin: 0;
    padding-left: 18px;
    color: var(--danger);
  }
</style>
