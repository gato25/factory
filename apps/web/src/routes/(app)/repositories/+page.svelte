<script lang="ts">
  import ConnectRepository from '$components/ConnectRepository.svelte';
  import { disconnect, repositories } from '$lib/remote/repositories.remote';

  const repos = $derived(repositories());
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
              <td>
                <button onclick={() => disconnect(repo.id)}>Disconnect</button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
{/if}

<style>
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
