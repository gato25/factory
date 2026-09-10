<script lang="ts">
  import { connect, requiredScopes } from '$lib/remote/repositories.remote';

  let { pipelines = [] }: { pipelines?: { id: string; name: string }[] } = $props();
  let provider = $state<'gitlab' | 'github'>('gitlab');
  let open = $state(false);

  // Only two providers exist in this version (FR-014a); artboard 03's
  // "Self-hosted Git" option is deliberately absent.
  const providers = [
    { id: 'gitlab' as const, label: 'GitLab', host: 'https://gitlab.com/' },
    { id: 'github' as const, label: 'GitHub', host: 'https://github.com/' }
  ];
</script>

<button class="primary" onclick={() => (open = true)}>Connect repository</button>

{#if open}
  <div class="scrim" role="presentation" onclick={() => (open = false)}></div>
  <div class="modal" role="dialog" aria-modal="true" aria-label="Connect repository">
    <h2>Connect repository</h2>

    <form {...connect.enhance(async ({ submit }) => {
      await submit();
      if (connect.result) open = false;
    })}>
      <fieldset>
        <legend>1 &middot; Provider</legend>
        <div class="providers">
          {#each providers as option (option.id)}
            <label class:selected={provider === option.id}>
              <input type="radio" bind:group={provider} value={option.id} />
              {option.label}
            </label>
          {/each}
        </div>
      </fieldset>

      <label class="field">
        <span>2 &middot; Repository address</span>
        <input
          name="url"
          type="url"
          required
          placeholder={`${providers.find((p) => p.id === provider)?.host}netgroup/shop-frontend`}
        />
      </label>

      <label class="field">
        <span>3 &middot; Access token</span>
        <input name="token" type="password" required autocomplete="off" />
        <small>
          {#await requiredScopes()}
            Loading the required permissions…
          {:then scopes}
            This token needs: {scopes[provider].join(', ')}. It is encrypted before it is stored
            and can never be read back.
          {/await}
        </small>
      </label>

      {#if pipelines.length > 0}
        <label class="field">
          <span>4 &middot; Default pipeline for new tickets</span>
          <select name="defaultPipelineId">
            {#each pipelines as pipeline (pipeline.id)}
              <option value={pipeline.id}>{pipeline.name}</option>
            {/each}
          </select>
        </label>
      {/if}

      {#if connect.fields.issues()?.length}
        <ul class="errors" role="alert">
          {#each connect.fields.issues() ?? [] as issue (issue.message)}
            <li>{issue.message}</li>
          {/each}
        </ul>
      {/if}

      <footer>
        <button type="button" onclick={() => (open = false)}>Cancel</button>
        <button class="primary" type="submit" disabled={connect.pending > 0}>
          {connect.pending > 0 ? 'Testing…' : 'Test & connect'}
        </button>
      </footer>
    </form>
  </div>
{/if}

<style>
  .scrim {
    position: fixed;
    inset: 0;
    background: rgba(26, 29, 36, 0.45);
  }
  .modal {
    position: fixed;
    top: 8vh;
    left: 50%;
    transform: translateX(-50%);
    width: min(520px, calc(100vw - 32px));
    max-height: 84vh;
    overflow: auto;
    background: #fff;
    border-radius: 10px;
    padding: 24px;
    box-shadow: 0 20px 50px rgba(0, 0, 0, 0.25);
  }
  h2 {
    margin: 0 0 16px;
    font-size: 18px;
  }
  form {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  fieldset {
    border: 0;
    padding: 0;
    margin: 0;
  }
  legend,
  .field > span {
    font-size: 12px;
    color: #6b7280;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .providers {
    display: flex;
    gap: 8px;
    margin-top: 6px;
  }
  .providers label {
    flex: 1;
    border: 1px solid #dfe3ea;
    border-radius: 6px;
    padding: 10px;
    text-align: center;
    cursor: pointer;
  }
  .providers label.selected {
    border-color: #3d5afe;
    background: #f3f5ff;
  }
  .providers input {
    position: absolute;
    opacity: 0;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  input,
  select {
    padding: 9px 10px;
    border: 1px solid #dfe3ea;
    border-radius: 6px;
    font: inherit;
  }
  small {
    color: #6b7280;
  }
  .errors {
    margin: 0;
    padding-left: 18px;
    color: #b3261e;
  }
  footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
  button {
    padding: 9px 14px;
    border: 1px solid #dfe3ea;
    border-radius: 6px;
    background: #fff;
    font: inherit;
    cursor: pointer;
  }
  button.primary {
    background: #3d5afe;
    border-color: #3d5afe;
    color: #fff;
    font-weight: 600;
  }
</style>
