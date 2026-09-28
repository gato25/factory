<script lang="ts">
  import ConnectRepository from '$components/ConnectRepository.svelte';
  import Icon from '$components/Icon.svelte';
  import { pipelineName } from '$lib/default-names';
  import { ago, exact } from '$lib/format';
  import { m } from '$lib/i18n';
  import { pipelines } from '$lib/remote/pipelines.remote';
  import {
    changeDefaultPipeline,
    changeRunSettings,
    disconnect,
    replaceToken,
    repositories,
  } from '$lib/remote/repositories.remote';

  /**
   * Screen 02 — Repositories, built to artboard 02 (specs/004-bento-redesign
   * FR-015, FR-016): three figures across the top, then a tile per
   * repository with its name, path and provider, its connection state in
   * words, its branch and pipeline, the latest ticket worked on and when, and
   * its active and done tickets.
   *
   * Every action the table's row menu carried is still behind the tile's
   * "…" — the default pipeline, the token, how the project starts, and
   * disconnecting — and a repository whose token has expired is tinted red
   * and offers replacing the token on the tile itself, because until it is
   * replaced nothing new can start there (FR-013).
   */

  const repos = $derived(repositories());
  const available = $derived(pipelines());

  /** Which tile's menu is open, and which of its forms is showing. */
  let openMenu = $state<string | null>(null);
  let replacing = $state<string | null>(null);
  let choosing = $state<string | null>(null);
  let starting = $state<string | null>(null);

  const close = () => {
    openMenu = null;
  };
  const show = (form: 'choosing' | 'replacing' | 'starting', id: string) => {
    choosing = form === 'choosing' && choosing !== id ? id : null;
    replacing = form === 'replacing' && replacing !== id ? id : null;
    starting = form === 'starting' && starting !== id ? id : null;
    close();
  };

  const PROVIDER = { gitlab: 'GitLab', github: 'GitHub' } as const;

  const statusWord = (status: string) =>
    status === 'connected'
      ? m.repositories.connected
      : status === 'credential_expired'
        ? m.repositories.tokenExpired
        : m.repositories.error;
</script>

<svelte:window onclick={close} />

<header class="page-head">
  <div>
    <h1>{m.repositories.heading}</h1>
    <p class="lede">{m.repositories.lede}</p>
  </div>
  <ConnectRepository />
</header>

{#if repos.error}
  <p class="tile tile--danger" role="alert">{(repos.error as Error).message}</p>
{:else if !repos.ready}
  <p class="tile">{m.repositories.loading}</p>
{:else if repos.current.length === 0}
  <p class="tile empty">{m.repositories.empty}</p>
{:else}
  {@const all = repos.current}
  {@const connected = all.filter((repo) => repo.status === 'connected')}
  {@const attention = all.filter((repo) => repo.status !== 'connected')}
  {@const active = all.reduce((sum, repo) => sum + repo.ticketsRunning, 0)}

  <!-- The connected-repository count lives here now (001 FR-071, superseded). -->
  <div class="stats">
    <section class="tile stat">
      <div>
        <h2 class="l">{m.repositories.statConnected}</h2>
        <p class="s">
          {m.repositories.byProvider(
            connected.filter((repo) => repo.provider === 'gitlab').length,
            connected.filter((repo) => repo.provider === 'github').length,
          )}
        </p>
      </div>
      <span class="v">{connected.length}</span>
    </section>
    <section class="tile stat">
      <div>
        <h2 class="l">{m.repositories.statActive}</h2>
        <p class="s">
          {m.repositories.onRepositories(all.filter((repo) => repo.ticketsRunning > 0).length)}
        </p>
      </div>
      <span class="v">{active}</span>
    </section>
    <section class="tile stat" class:tile--danger={attention.length > 0}>
      <div>
        <h2 class="l">{m.repositories.statAttention}</h2>
        <p class="s">
          {#if attention[0]}
            {m.repositories.attentionOf(attention[0].name, statusWord(attention[0].status))}
          {:else}
            {m.repositories.allWell}
          {/if}
        </p>
      </div>
      <span class="v" class:bad={attention.length > 0}>{attention.length}</span>
    </section>
  </div>

  <ul class="grid">
    {#each all as repo (repo.id)}
      {@const expired = repo.status !== 'connected'}
      {@const total = repo.ticketsRunning + repo.ticketsDone}
      <li class="tile repo" class:tile--danger={expired} data-repository={repo.id}>
        <div class="top">
          <span class="mark {repo.provider}" aria-hidden="true"><Icon name={repo.provider} size={20} /></span>
          <span class="name-box">
            <span class="name" title={repo.name}>{repo.name}</span>
            <span class="path" title={repo.fullPath}>{repo.fullPath} · {PROVIDER[repo.provider]}</span>
          </span>
          <span class="more">
            <button
              type="button"
              class="more-button"
              aria-label={m.repositories.actionsFor(repo.name)}
              aria-expanded={openMenu === repo.id}
              onclick={(event) => {
                event.stopPropagation();
                openMenu = openMenu === repo.id ? null : repo.id;
              }}
            >
              <Icon name="ellipsis" size={15} />
            </button>
            {#if openMenu === repo.id}
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <div class="menu" onclick={(event) => event.stopPropagation()}>
                <button type="button" onclick={() => show('choosing', repo.id)}
                  >{m.repositories.changePipeline}</button
                >
                <button type="button" onclick={() => show('replacing', repo.id)}
                  >{m.repositories.replaceToken}</button
                >
                <button type="button" onclick={() => show('starting', repo.id)}
                  >{m.repositories.setHowItStarts}</button
                >
                <button
                  type="button"
                  class="danger"
                  onclick={() => {
                    void disconnect(repo.id);
                    close();
                  }}>{m.repositories.disconnect}</button
                >
              </div>
            {/if}
          </span>
        </div>

        <div class="chips">
          <!-- A repository whose credential no longer works blocks new runs (FR-013) -->
          <span class="pill {expired ? 'pill--fail' : 'pill--done'}">{statusWord(repo.status)}</span>
          <span class="chip"><Icon name="git-branch" size={12} />{repo.defaultBranch}</span>
          <span class="chip">
            <Icon name="workflow" size={12} />
            {repo.defaultPipelineName
              ? m.repositories.pipelineChip(pipelineName(repo.defaultPipelineName))
              : m.repositories.noPipeline}
          </span>
        </div>

        <div class="last">
          <span class="k">{m.repositories.lastWork}</span>
          {#if repo.latest}
            <span class="t" title={`${repo.latest.reference} · ${repo.latest.title}`}
              >{repo.latest.reference} · {repo.latest.title}</span
            >
            <span class="w" title={exact(repo.latest.at)}>{ago(repo.latest.at)}</span>
          {:else}
            <span class="w">{m.repositories.noTicketsYet}</span>
          {/if}
        </div>

        {#if choosing === repo.id}
          <label class="form field">
            <span class="label">{m.repositories.pipelineForNew}</span>
            <select
              value={repo.defaultPipelineId ?? ''}
              onchange={async (event) => {
                await changeDefaultPipeline({
                  repositoryId: repo.id,
                  pipelineId: event.currentTarget.value,
                });
                choosing = null;
              }}
            >
              <option value="">{m.repositories.noPipeline}</option>
              {#each available.current ?? [] as pipeline (pipeline.id)}
                <option value={pipeline.id}>{pipelineName(pipeline.name)}</option>
              {/each}
            </select>
          </label>
        {/if}

        {#if starting === repo.id}
          <!-- How a launch runs this repository's project (003 FR-005).
               Empty means detect it from the workspace. -->
          <form {...changeRunSettings} class="form" onsubmit={() => (starting = null)}>
            <input type="hidden" name="repositoryId" value={repo.id} />
            <label class="field">
              <span class="label">{m.repositories.startCommand}</span>
              <input
                name="command"
                value={repo.runCommand ?? ''}
                placeholder="npm run dev -- --host 0.0.0.0 --port $PORT"
                autocomplete="off"
              />
            </label>
            <label class="field">
              <span class="label">{m.repositories.startPort}</span>
              <input name="port" type="number" min="1" max="65535" value={repo.runPort ?? ''} placeholder="5173" />
            </label>
            <p class="hint">{m.repositories.startHint}</p>
            {#each changeRunSettings.fields.allIssues() ?? [] as issue (issue.message)}
              <p class="problem" role="alert">{issue.message}</p>
            {/each}
            <button type="submit" class="btn" disabled={changeRunSettings.pending > 0}>
              {changeRunSettings.pending > 0 ? m.repositories.saving : m.repositories.save}
            </button>
          </form>
        {/if}

        <span class="spacer"></span>

        {#if replacing === repo.id}
          <form {...replaceToken} class="form" onsubmit={() => (replacing = null)}>
            <input type="hidden" name="repositoryId" value={repo.id} />
            <label class="field">
              <span class="label">{m.repositories.newToken}</span>
              <input name="token" type="password" autocomplete="off" required />
            </label>
            <!-- The permissions, at the point the credential is entered (FR-010) -->
            <p class="hint">
              {m.repositories.tokenHint(
                repo.provider === 'gitlab' ? m.provider.mergeRequests : m.provider.pullRequests,
              )}
            </p>
            {#each replaceToken.fields.allIssues() ?? [] as issue (issue.message)}
              <p class="problem" role="alert">{issue.message}</p>
            {/each}
            <button type="submit" class="btn" disabled={replaceToken.pending > 0}>
              {replaceToken.pending > 0 ? m.repositories.storing : m.repositories.storeNewToken}
            </button>
          </form>
        {:else if expired}
          <!-- FR-016: marked as needing attention, and fixable from here. -->
          <div class="problem-box">
            <p class="problem"><Icon name="key-round" size={15} />{m.repositories.tokenExpiredBlocks}</p>
            <button type="button" class="btn btn--danger" onclick={() => show('replacing', repo.id)}>
              <Icon name="refresh-cw" size={14} />
              {m.repositories.replaceTokenShort}
            </button>
          </div>
        {:else}
          <div class="tickets">
            <div class="tickets-head">
              <span class="n-box">
                <span class="n">{repo.ticketsRunning}</span>
                <span class="n-label">{m.repositories.activeTickets}</span>
              </span>
              <span class="done">{m.repositories.doneCount(repo.ticketsDone)}</span>
            </div>
            <span class="bar" aria-hidden="true">
              {#if total > 0}
                <span class="bar-done" style:width="{(repo.ticketsDone / total) * 100}%"></span>
                <span class="bar-active" style:width="{(repo.ticketsRunning / total) * 100}%"></span>
              {/if}
            </span>
          </div>
        {/if}
      </li>
    {/each}
  </ul>
{/if}

<style>
  .page-head {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 24px;
    margin-bottom: 20px;
    padding: 8px 4px 0;
  }
  h1 {
    margin: 0;
    font-size: 30px;
    font-weight: 600;
    letter-spacing: -0.6px;
  }
  .lede {
    margin: 6px 0 0;
    color: var(--text-2);
  }
  .empty {
    margin: 0;
  }

  .stats {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 20px;
    margin-bottom: 20px;
  }
  .stat {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 20px 24px;
  }
  .stat .l {
    margin: 0;
    font-family: var(--font);
    font-size: var(--type-body);
    font-weight: 600;
    letter-spacing: 0;
  }
  .stat .s {
    margin: 4px 0 0;
    font-size: var(--type-caption);
    color: var(--text-2);
  }
  .v {
    font-family: var(--font-head);
    font-size: 40px;
    font-weight: 700;
    line-height: 1;
    letter-spacing: -1.2px;
    color: var(--accent-text);
  }
  .v.bad {
    color: var(--danger-text);
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 20px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .repo {
    display: flex;
    flex-direction: column;
    gap: 18px;
    min-width: 0;
  }
  .top {
    display: flex;
    align-items: center;
    gap: 14px;
  }
  .mark {
    display: grid;
    flex: none;
    place-items: center;
    width: 44px;
    height: 44px;
    border-radius: 14px;
    color: var(--text-inv);
    background: linear-gradient(180deg, var(--accent-from), var(--accent-to));
    box-shadow: 0 6px 12px var(--glow-accent);
  }
  .mark.github {
    background: linear-gradient(180deg, #4a4540, #1e1b18);
    box-shadow: 0 6px 12px var(--shadow-depth);
  }
  .name-box {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }
  .name,
  .path,
  .last .t {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .name {
    font-family: var(--font-head);
    font-size: 18px;
    font-weight: 600;
    letter-spacing: -0.3px;
  }
  .path {
    font-size: var(--type-caption);
    color: var(--text-2);
  }
  .more {
    position: relative;
    flex: none;
  }
  .more-button {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    border: 0;
    border-radius: 10px;
    color: var(--text-2);
    background: var(--surface-2);
    cursor: pointer;
  }
  .menu {
    position: absolute;
    top: 38px;
    right: 0;
    z-index: 10;
    display: flex;
    flex-direction: column;
    min-width: 240px;
    padding: 6px;
    border-radius: 14px;
    background: var(--surface);
    box-shadow:
      0 1px 2px var(--shadow-soft),
      0 14px 36px var(--shadow-depth);
  }
  .menu button {
    padding: 10px 12px;
    border: 0;
    border-radius: 10px;
    font: 500 var(--type-body) / 1.3 var(--font);
    text-align: left;
    color: var(--text);
    background: none;
    cursor: pointer;
  }
  .menu button:hover {
    background: var(--surface-2);
  }
  .menu .danger {
    color: var(--danger-text);
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .chips .pill {
    padding: 6px 10px;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    border-radius: var(--r-pill);
    font-size: var(--type-caption);
    font-weight: 500;
    color: var(--text-2);
    background: var(--surface-2);
  }
  .last {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 12px 14px;
    border-radius: 14px;
    background: var(--surface-2);
  }
  .tile--danger .last,
  .tile--danger .chip {
    background: #ffffffb3;
  }
  .last .k {
    font-size: var(--type-caption);
    font-weight: 700;
    letter-spacing: 0.8px;
    color: var(--text-3);
  }
  .last .t {
    font-size: var(--type-body);
    font-weight: 600;
  }
  .last .w {
    font-size: var(--type-caption);
    color: var(--text-2);
  }
  .spacer {
    flex: 1;
  }

  .form {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .form .label {
    font-size: var(--type-body);
    font-weight: 600;
  }
  .form input,
  .form select {
    width: 100%;
    padding: 10px 12px;
    border: 0;
    border-radius: 12px;
    font: var(--type-body) / 1.4 var(--font);
    color: var(--text);
    background: var(--surface-2);
    box-shadow: inset 0 1px 3px #3a2a1a1a;
  }
  .tile--danger .form input {
    background: #ffffffcc;
  }
  .hint {
    margin: 0;
    font-size: var(--type-caption);
    color: var(--text-2);
  }
  .problem-box {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 10px;
  }
  .problem {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0;
    font-size: var(--type-caption);
    font-weight: 600;
    color: var(--danger-text);
  }

  .tickets {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .tickets-head {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
  }
  .n-box {
    display: flex;
    align-items: flex-end;
    gap: 6px;
  }
  .n {
    font-family: var(--font-head);
    font-size: 28px;
    font-weight: 700;
    line-height: 1;
    letter-spacing: -0.8px;
    color: var(--accent-text);
  }
  .n-label {
    font-size: var(--type-caption);
    color: var(--text-2);
  }
  .done {
    font-size: var(--type-caption);
    font-weight: 600;
    color: var(--success-text);
  }
  .bar {
    display: flex;
    gap: 3px;
    height: 8px;
    overflow: hidden;
    border-radius: 4px;
    background: var(--border);
  }
  .bar-done {
    border-radius: 4px;
    background: linear-gradient(90deg, var(--mint-from), var(--mint-to));
  }
  .bar-active {
    border-radius: 4px;
    background: linear-gradient(90deg, var(--accent-from), var(--accent-to));
  }

  @media (max-width: 1200px) {
    .grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
  @media (max-width: 800px) {
    .grid,
    .stats {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
