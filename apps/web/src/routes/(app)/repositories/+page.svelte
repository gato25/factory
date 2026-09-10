<script lang="ts">
  import ConnectRepository from '$components/ConnectRepository.svelte';
  import { disconnect, replaceToken, repositories } from '$lib/remote/repositories.remote';

  const repos = $derived(repositories());

  /** Which repository's token is being replaced, if any. */
  let replacing = $state<string | null>(null);
</script>

<div class="head">
  <p class="lede">Every ticket belongs to exactly one repository.</p>
  <ConnectRepository />
</div>

{#if repos.error}
  <p class="card error" role="alert">{(repos.error as Error).message}</p>
{:else if !repos.ready}
  <p class="card">Loading repositories…</p>
{:else}
  {@const rows = repos.current}
    {#if rows.length === 0}
      <p class="empty">No repositories connected yet. Connect one to create your first ticket.</p>
    {:else}
      <table>
        <thead>
          <tr>
            <th>Repository</th>
            <th>Provider</th>
            <th>Default branch</th>
            <th>Tickets</th>
            <th>Status</th>
            <th><span class="sr">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {#each rows as repo (repo.id)}
            <tr>
              <td>
                <strong>{repo.name}</strong>
                <span class="path">{repo.fullPath}</span>
              </td>
              <td>{repo.provider === 'gitlab' ? 'GitLab' : 'GitHub'}</td>
              <td><code>{repo.defaultBranch}</code></td>
              <td>{repo.ticketsRunning} running &middot; {repo.ticketsDone} done</td>
              <td>
                <!-- A repository whose credential no longer works blocks new runs (FR-013) -->
                <span class="badge" class:bad={repo.status !== 'connected'}>
                  {repo.status === 'connected'
                    ? 'Connected'
                    : repo.status === 'credential_expired'
                      ? 'Token expired'
                      : 'Error'}
                </span>
                {#if repo.statusDetail}<small>{repo.statusDetail}</small>{/if}
              </td>
              <td class="actions">
                <!--
                  A token expires and somebody has to replace it, or the
                  repository stays blocked forever. Offered only where it is
                  the problem: on a working repository this would be an
                  invitation to break it (FR-013, FR-010).
                -->
                {#if repo.status !== 'connected'}
                  <button onclick={() => (replacing = replacing === repo.id ? null : repo.id)}>
                    {replacing === repo.id ? 'Cancel' : 'Replace token'}
                  </button>
                {/if}
                <button onclick={() => disconnect(repo.id)}>Disconnect</button>
              </td>
            </tr>
            {#if replacing === repo.id}
              <tr class="replacing">
                <td colspan="6">
                  <form
                    {...replaceToken}
                    onsubmit={() => {
                      replacing = null;
                    }}
                  >
                    <input type="hidden" name="repositoryId" value={repo.id} />
                    <label>
                      New access token for {repo.fullPath}
                      <input name="token" type="password" autocomplete="off" required />
                    </label>
                    <!-- The permissions, at the point the credential is entered (FR-010) -->
                    <p class="muted small">
                      It needs to read the repository, push branches and open
                      {repo.provider === 'gitlab' ? 'merge requests' : 'pull requests'}. Stored
                      encrypted and never shown again — not even to you.
                    </p>
                    {#each replaceToken.fields.allIssues() ?? [] as issue (issue.message)}
                      <p class="error" role="alert">{issue.message}</p>
                    {/each}
                    <button type="submit" disabled={replaceToken.pending > 0}>
                      {replaceToken.pending > 0 ? 'Storing…' : 'Store the new token'}
                    </button>
                  </form>
                </td>
              </tr>
            {/if}
          {/each}
        </tbody>
      </table>
    {/if}
{/if}

<style>
  .actions { display: flex; gap: 8px; justify-content: flex-end; }
  .replacing td { background: var(--surface-2, #f6f7f9); }
  .replacing form {
    display: flex;
    flex-direction: column;
    gap: 8px;
    align-items: flex-start;
    padding: 8px 0;
  }
  .replacing label { display: flex; flex-direction: column; gap: 4px; }
  .replacing .error { color: var(--bad); margin: 0; }
  .head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 16px;
    margin-bottom: 16px;
  }
  .lede {
    margin: 0;
    color: #4a5060;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    background: #fff;
    border-radius: 8px;
    overflow: hidden;
  }
  th,
  td {
    text-align: left;
    padding: 12px 14px;
    border-bottom: 1px solid #eef1f7;
    vertical-align: top;
  }
  th {
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: #6b7280;
  }
  .path {
    display: block;
    color: #6b7280;
    font-size: 12px;
  }
  .badge {
    display: inline-block;
    padding: 3px 9px;
    border-radius: 999px;
    background: #e6f4ea;
    color: #14733c;
    font-size: 12px;
  }
  .badge.bad {
    background: #fdeceb;
    color: #b3261e;
  }
  td small {
    display: block;
    color: #b3261e;
    font-size: 12px;
    margin-top: 4px;
  }
  button {
    padding: 6px 10px;
    border: 1px solid #dfe3ea;
    border-radius: 6px;
    background: #fff;
    cursor: pointer;
  }
  .empty,
  .error {
    background: #fff;
    padding: 24px;
    border-radius: 8px;
  }
  .error {
    color: #b3261e;
  }
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }
</style>
