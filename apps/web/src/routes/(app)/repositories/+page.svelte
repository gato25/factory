<script lang="ts">
  import ConnectRepository from '$components/ConnectRepository.svelte';
  import Icon from '$components/Icon.svelte';
  import { pipelines } from '$lib/remote/pipelines.remote';
  import {
    changeDefaultPipeline,
    disconnect,
    replaceToken,
    repositories,
  } from '$lib/remote/repositories.remote';

  /**
   * Built to `design.pen`'s 02 Repositories: a page head, then one table with
   * a 44px header and 64px rows — Repository 290, Provider 120, Default
   * branch 140, Default pipeline 220, Tickets 120, Status 120, and a 40px
   * cell for the overflow menu.
   *
   * That menu is what the design puts the row's actions behind, and spec.md
   * §4 says what belongs in it: the default pipeline, the token, and
   * disconnecting.
   */

  const repos = $derived(repositories());
  const available = $derived(pipelines());

  /** Which row's menu is open, and what it is showing. */
  let openMenu = $state<string | null>(null);
  let replacing = $state<string | null>(null);
  let choosing = $state<string | null>(null);

  const close = () => {
    openMenu = null;
  };

  const PROVIDER = { gitlab: 'GitLab', github: 'GitHub' } as const;
</script>

<svelte:window onclick={close} />

<div class="head">
  <div class="page-head">
    <h2>Connected repositories</h2>
    <p>Each ticket belongs to one repository. Connect a repo to start creating tickets for it.</p>
  </div>
  <ConnectRepository />
</div>

{#if repos.error}
  <p class="card error" role="alert">{(repos.error as Error).message}</p>
{:else if !repos.ready}
  <p class="card">Loading repositories…</p>
{:else if repos.current.length === 0}
  <p class="card empty">No repositories connected yet. Connect one to create your first ticket.</p>
{:else}
  <div class="table">
    <div class="row header">
      <span class="c repo">Repository</span>
      <span class="c provider">Provider</span>
      <span class="c branch">Default branch</span>
      <span class="c pipeline">Default pipeline</span>
      <span class="c tickets">Tickets</span>
      <span class="c status">Status</span>
      <span class="c more"><span class="sr">Actions</span></span>
    </div>

    {#each repos.current as repo (repo.id)}
      <div class="row">
        <span class="c repo">
          <span class="repo-icon"><Icon name="folder-git-2" size={18} /></span>
          <span class="repo-text">
            <span class="name">{repo.name}</span>
            <span class="path">{repo.fullPath}</span>
          </span>
        </span>

        <span class="c provider">
          <Icon name={repo.provider} size={16} />
          <span>{PROVIDER[repo.provider]}</span>
        </span>

        <span class="c branch"><span class="pill">{repo.defaultBranch}</span></span>

        <span class="c pipeline">
          {#if repo.defaultPipelineName}
            {repo.defaultPipelineName}
          {:else}
            <span class="muted">None — a ticket picks one</span>
          {/if}
        </span>

        <span class="c tickets small">
          {repo.ticketsRunning} running &middot; {repo.ticketsDone} done
        </span>

        <span class="c status">
          <!-- A repository whose credential no longer works blocks new runs (FR-013) -->
          <span class="badge {repo.status === 'connected' ? 'ok' : 'bad'}">
            <span class="dot"></span>
            {repo.status === 'connected'
              ? 'Connected'
              : repo.status === 'credential_expired'
                ? 'Token expired'
                : 'Error'}
          </span>
        </span>

        <span class="c more">
          <button
            type="button"
            aria-label="Actions for {repo.name}"
            aria-expanded={openMenu === repo.id}
            onclick={(event) => {
              event.stopPropagation();
              openMenu = openMenu === repo.id ? null : repo.id;
              replacing = null;
              choosing = null;
            }}
          >
            <Icon name="ellipsis" size={18} />
          </button>

          {#if openMenu === repo.id}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <div class="menu" onclick={(event) => event.stopPropagation()}>
              <button
                type="button"
                onclick={() => {
                  choosing = choosing === repo.id ? null : repo.id;
                  replacing = null;
                }}>Change the default pipeline</button
              >
              <button
                type="button"
                onclick={() => {
                  replacing = replacing === repo.id ? null : repo.id;
                  choosing = null;
                }}>Replace the access token</button
              >
              <button
                type="button"
                class="danger"
                onclick={() => {
                  void disconnect(repo.id);
                  close();
                }}>Disconnect</button
              >

              {#if choosing === repo.id}
                <label class="field">
                  <span class="small muted">Pipeline for new tickets</span>
                  <select
                    value={repo.defaultPipelineId ?? ''}
                    onchange={async (event) => {
                      await changeDefaultPipeline({
                        repositoryId: repo.id,
                        pipelineId: event.currentTarget.value,
                      });
                      close();
                    }}
                  >
                    <option value="">None — a ticket picks one</option>
                    {#each available.current ?? [] as pipeline (pipeline.id)}
                      <option value={pipeline.id}>{pipeline.name}</option>
                    {/each}
                  </select>
                </label>
              {/if}

              {#if replacing === repo.id}
                <form {...replaceToken} class="field" onsubmit={close}>
                  <input type="hidden" name="repositoryId" value={repo.id} />
                  <label>
                    <span class="small muted">New access token</span>
                    <input name="token" type="password" autocomplete="off" required />
                  </label>
                  <!-- The permissions, at the point the credential is entered (FR-010) -->
                  <p class="small muted">
                    It needs to read the repository, push branches and open
                    {repo.provider === 'gitlab' ? 'merge requests' : 'pull requests'}. Stored
                    encrypted and never shown again — not even to you.
                  </p>
                  {#each replaceToken.fields.allIssues() ?? [] as issue (issue.message)}
                    <p class="small error" role="alert">{issue.message}</p>
                  {/each}
                  <button type="submit" disabled={replaceToken.pending > 0}>
                    {replaceToken.pending > 0 ? 'Storing…' : 'Store the new token'}
                  </button>
                </form>
              {/if}
            </div>
          {/if}
        </span>
      </div>
    {/each}
  </div>
{/if}

<style>
  .head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 24px;
    margin-bottom: 28px;
  }
  .page-head {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .page-head h2 {
    margin: 0;
    font-size: 24px;
    font-weight: 700;
    color: var(--text);
  }
  .page-head p {
    margin: 0;
    font-size: 14px;
    color: var(--text-2);
  }

  .table {
    background: var(--surface);
    border: 1px solid var(--card-border);
    border-radius: var(--r-lg);
    box-shadow: 0 1px 2px #0f172a0a;
    overflow: visible;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 0;
    height: 64px;
    padding: 0 20px;
    border-bottom: 1px solid var(--border);
  }
  .row:last-child {
    border-bottom: 0;
  }
  .row.header {
    height: 44px;
    background: var(--surface-2);
    border-radius: var(--r-lg) var(--r-lg) 0 0;
    font-size: 12px;
    font-weight: 500;
    color: var(--text-2);
  }

  /* The design's column widths, so the table reads down as well as across. */
  .c {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }
  .c.repo {
    width: 290px;
    flex: 1;
  }
  .c.provider {
    width: 120px;
    flex: none;
  }
  .c.branch {
    width: 140px;
    flex: none;
  }
  .c.pipeline {
    width: 220px;
    flex: none;
  }
  .c.tickets {
    width: 120px;
    flex: none;
  }
  .c.status {
    width: 120px;
    flex: none;
  }
  .c.more {
    width: 40px;
    flex: none;
    justify-content: flex-end;
    position: relative;
  }

  .repo-icon {
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    border-radius: var(--r-sm);
    background: var(--accent-soft);
    color: var(--accent-text);
    flex: none;
  }
  .repo-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .repo-text .name {
    font-size: 14px;
    font-weight: 600;
    color: var(--text);
  }
  .repo-text .path {
    font-size: 12px;
    color: var(--text-3);
  }
  .repo-text span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .c.provider span,
  .c.pipeline {
    font-size: 13px;
    color: var(--text);
  }

  .pill {
    padding: 3px 8px;
    border-radius: 4px;
    background: var(--surface-2);
    font-size: 12px;
    color: var(--text);
  }

  .badge {
    font-size: 12px;
    font-weight: 600;
    padding: 4px 10px;
  }
  .dot {
    width: 6px;
    height: 6px;
    border-radius: 999px;
    background: currentcolor;
    flex: none;
  }

  .c.more > button {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    padding: 0;
    border: 0;
    border-radius: var(--r-sm);
    background: none;
    color: var(--text-3);
    cursor: pointer;
  }
  .c.more > button:hover {
    background: var(--surface-2);
    color: var(--text-2);
  }

  .menu {
    position: absolute;
    top: 34px;
    right: 0;
    z-index: 10;
    display: flex;
    flex-direction: column;
    gap: 2px;
    width: 280px;
    padding: 6px;
    background: var(--surface);
    border: 1px solid var(--card-border);
    border-radius: var(--r-md);
    box-shadow: 0 8px 24px #0f172a1f;
  }
  .menu > button {
    padding: 8px 10px;
    border: 0;
    border-radius: var(--r-sm);
    background: none;
    font: inherit;
    font-size: 13px;
    text-align: left;
    color: var(--text);
    cursor: pointer;
  }
  .menu > button:hover {
    background: var(--surface-2);
  }
  .menu > button.danger {
    color: var(--danger);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px 10px 4px;
    border-top: 1px solid var(--border);
    margin-top: 4px;
  }
  .field label {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .error {
    color: var(--danger);
  }
  .empty {
    color: var(--text-2);
  }

  @media (max-width: 1200px) {
    .row {
      height: auto;
      flex-wrap: wrap;
      gap: 12px;
      padding: 16px 20px;
    }
    .row.header {
      display: none;
    }
    .c {
      width: auto !important;
      flex: none !important;
    }
    .c.repo {
      flex: 1 0 100% !important;
    }
  }
</style>
