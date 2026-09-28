<script lang="ts">
  import Icon from '$components/Icon.svelte';
  import { m } from '$lib/i18n';
  import { callbackBaseUrl } from '$lib/remote/repositories.remote';
  import {
    changeRole,
    connections,
    inviteMember,
    members,
    queue,
    removeMember,
    saveCredential,
    saveWorkspace,
    settings,
  } from '$lib/remote/settings.remote';

  /**
   * Screen 12 — Settings, built to `design.pen`: a 270px menu tile beside a
   * tile per section, each with its orb, what it is, what it is for and
   * whether it is working (specs/004-bento-redesign FR-024). The runner — the
   * execution service — has its own tile: its address, whether its
   * credential is set (never any part of it), the address it calls back to,
   * and the connection check (research D13).
   *
   * The sections are links rather than tabs. The artboard shows one group at
   * a time, but hiding the rest would mean a page where the thing you are
   * looking for is not on it — and searching a settings screen is how people
   * actually use one.
   *
   * Administrator-only, and the rule is checked inside every remote function
   * rather than by hiding this screen (FR-004).
   */
  let { data }: { data: { user: { id: string; role: string } } } = $props();

  const config = $derived(settings());
  const people = $derived(members());
  const waiting = $derived(queue());
  const callback = $derived(callbackBaseUrl());

  // A remote form object attaches to one <form>; two cards need two
  // instances, which is what `.for(key)` is for.
  const modelKey = $derived(saveCredential.for('model'));
  const designKey = $derived(saveCredential.for('design'));

  let notice = $state<string | null>(null);
  let tested = $state<{ what: string; state: string; detail: string }[] | null>(null);
  let testing = $state(false);

  const SECTIONS = [
    { id: 'workspace', label: m.settings.workspace, icon: 'building-2' },
    { id: 'runner', label: m.settings.runner, icon: 'server' },
    { id: 'sandbox', label: m.settings.sandboxDocker, icon: 'container' },
    { id: 'limits', label: m.settings.costLimits, icon: 'coins' },
    { id: 'keys', label: m.settings.claudeCliAndKeys, icon: 'key-round' },
    { id: 'design', label: m.settings.designPen, icon: 'pen-tool' },
    { id: 'members', label: m.settings.members, icon: 'users' },
    { id: 'notifications', label: m.settings.notifications, icon: 'bell' },
  ];
  let current = $state('workspace');

  const STATE_TONE: Record<string, string> = {
    reachable: 'done',
    unconfigured: 'queue',
    unreachable: 'fail',
    unauthorised: 'fail',
    wrong_shape: 'fail',
  };
  const WHAT: Record<string, string> = {
    runner: m.settings.runner,
    design: m.settings.designService,
  };

  /** What a tile's pill says: the last test if there was one, else whether
   *  it is configured at all. */
  function stateOf(
    what: string,
    configured: boolean,
    configuredLabel = m.settings.configured,
    // Red where a run cannot start without it; neutral where nothing needs it yet.
    missingTone = 'fail',
  ) {
    const result = tested?.find((row) => row.what === what);
    if (result) {
      return {
        label: m.settings.state[result.state] ?? result.state,
        tone: STATE_TONE[result.state] ?? 'queue',
      };
    }
    return configured
      ? { label: configuredLabel, tone: 'done' }
      : { label: m.settings.notSetUp, tone: missingTone };
  }
  const runnerResult = $derived(tested?.find((row) => row.what === 'runner') ?? null);

  async function test() {
    testing = true;
    try {
      const result = await connections();
      tested = 'problem' in result ? null : result.results;
      if ('problem' in result) notice = result.problem;
    } finally {
      testing = false;
    }
  }
</script>

{#snippet head(icon: string, tone: string, title: string, sub: string, status?: { label: string; tone: string })}
  <header class="th">
    <span class="sq {tone}" aria-hidden="true"><Icon name={icon} size={19} /></span>
    <div class="tx">
      <h2>{title}</h2>
      <p>{sub}</p>
    </div>
    {#if status}
      <span class="pill {status.tone === 'run' ? '' : `pill--${status.tone}`}">{status.label}</span>
    {/if}
  </header>
{/snippet}

<header class="page-head">
  <div class="text">
    <h1>{m.settings.heading}</h1>
    <p class="lede">{m.settings.lede}</p>
  </div>
  {#if data.user.role === 'admin' && config.ready}
    <button type="button" class="btn" disabled={testing} onclick={test}>
      <Icon name="activity" size={15} />{testing ? m.settings.testing : m.settings.testAll}
    </button>
  {/if}
</header>

{#if data.user.role !== 'admin'}
  <p class="tile notice">{m.settings.adminOnly}</p>
{:else if config.error}
  <p class="tile tile--danger notice" role="alert">{(config.error as Error).message}</p>
{:else if !config.ready}
  <p class="tile notice">{m.settings.loading}</p>
{:else}
  {@const w = config.current.workspace}
  {@const r = config.current.readiness}
  {@const tokenSet = config.current.runner.tokenSet}

  <div class="wrap">
    <nav class="tile menu" aria-label={m.settings.sections}>
      {#each SECTIONS as section (section.id)}
        <a
          href="#{section.id}"
          class:on={current === section.id}
          aria-current={current === section.id ? 'true' : undefined}
          onclick={() => (current = section.id)}
        >
          <Icon name={section.icon} size={15} />{section.label}
        </a>
      {/each}
    </nav>

    <div class="content">
      {#if notice}<p class="banner" role="status">{notice}</p>{/if}

      {#if !r.ready}
        <p class="banner warn" role="status">
          {m.settings.cannotStart(r.missing.map((item) => m.dashboard.missing[item] ?? item).join(', '))}
        </p>
      {/if}

      <form {...saveWorkspace} class="stack">
        <section class="tile" id="workspace">
          {@render head('building-2', '', m.settings.workspace, m.settings.workspaceLede, {
            label: r.ready ? m.settings.readyToRun : m.settings.notReady,
            tone: r.ready ? 'done' : 'fail',
          })}
          <div class="grid">
            <label class="f">
              <span>{m.settings.name}</span>
              <input name="name" value={w.name} required />
            </label>
          </div>
        </section>

        <!-- The execution service (research D13). The address is the same
             field it always was, moved here from the sandbox tile. -->
        <section class="tile" id="runner">
          {@render head(
            'server',
            '',
            m.settings.runner,
            m.settings.runnerLede,
            stateOf('runner', Boolean(w.runnerBaseUrl) && tokenSet),
          )}
          <div class="grid three">
            <label class="f">
              <span>{m.settings.runnerAddress}</span>
              <input
                class="mono"
                name="runnerBaseUrl"
                value={w.runnerBaseUrl ?? ''}
                placeholder="http://localhost:8080"
              />
            </label>
            <div class="f">
              <span id="runner-token">{m.settings.runnerToken}</span>
              <!-- Whether it is set, and never any part of it (Constitution V). -->
              <output class="value mono" class:missing={!tokenSet} aria-labelledby="runner-token"
                >{#if tokenSet}<span aria-hidden="true">••••••••••••••••</span><span class="sr"
                    >{m.settings.tokenSetMasked}</span
                  >{:else}{m.settings.tokenMissing}{/if}</output
              >
              <span class="hint"
                >{tokenSet ? `${m.settings.tokenSetMasked} · ` : ''}{m.settings.tokenHint}</span
              >
            </div>
            <div class="f">
              <span id="runner-callback">{m.settings.callback}</span>
              <output class="value mono" aria-labelledby="runner-callback"
                >{callback.ready ? `${callback.current.replace(/\/+$/, '')}/api/hooks/orchestrator` : '…'}</output
              >
            </div>
          </div>
          <!-- Each connection test says which of three things is wrong (FR-005a) -->
          <div class="tests {runnerResult ? (STATE_TONE[runnerResult.state] ?? '') : ''}">
            <Icon
              name={runnerResult?.state === 'reachable' ? 'circle-check' : 'activity'}
              size={15}
            />
            <span class="t">{runnerResult ? runnerResult.detail : m.settings.testHint}</span>
            <button type="button" class="chip-btn" disabled={testing} onclick={test}>
              <Icon name="refresh-cw" size={12} />{testing ? m.settings.testing : m.settings.testConnection}
            </button>
          </div>
        </section>

        <section class="tile" id="sandbox">
          {@render head('container', 'grey', m.settings.sandboxHeading, m.settings.sandboxLede)}
          <div class="grid">
            <label class="f">
              <span>{m.settings.image}</span>
              <input class="mono" name="sandboxImage" value={w.sandboxImage} required />
            </label>
          </div>
          <div class="grid four">
            <label class="f">
              <span>{m.settings.processors}</span>
              <input name="sandboxCpu" type="number" min="1" value={w.sandboxCpu} required />
            </label>
            <label class="f">
              <span>{m.settings.memoryMb}</span>
              <input
                name="sandboxMemoryMb"
                type="number"
                min="512"
                step="256"
                value={w.sandboxMemoryMb}
                required
              />
            </label>
            <label class="f">
              <span>{m.settings.lifetimeMinutes}</span>
              <input
                name="sandboxWallClockMinutes"
                type="number"
                min="1"
                value={w.sandboxWallClockMinutes}
                required
              />
            </label>
            <label class="f">
              <span>{m.settings.retainFailedHours}</span>
              <input
                name="retainFailedSandboxesHours"
                type="number"
                min="0"
                value={w.retainFailedSandboxesHours}
                required
              />
            </label>
          </div>
          <label class="opt">
            <span class="tx">
              <span class="t">{m.settings.networkDuringImplement}</span>
              <span class="d">{m.settings.networkDuringImplementNote}</span>
            </span>
            <input
              type="checkbox"
              class="switch"
              name="sandboxNetworkDuringImplement"
              value="true"
              checked={w.sandboxNetworkDuringImplement}
            />
          </label>
        </section>

        <section class="tile" id="limits">
          {@render head('coins', 'grey', m.settings.costLimits, m.settings.costLimitsLede)}
          <div class="grid three">
            <label class="f">
              <span>{m.settings.maxSpend}</span>
              <input name="defaultCostCeilingUsd" value={w.defaultCostCeilingUsd} required />
            </label>
            <label class="f">
              <span>{m.settings.maxTime}</span>
              <input
                name="defaultTimeCeilingMinutes"
                type="number"
                min="1"
                value={w.defaultTimeCeilingMinutes}
                required
              />
            </label>
            <label class="f">
              <span>{m.settings.maxConcurrent}</span>
              <input
                name="maxConcurrentRuns"
                type="number"
                min="1"
                value={w.maxConcurrentRuns}
                required
              />
            </label>
          </div>

          {#if saveWorkspace.fields.allIssues()?.length}
            <ul class="banner bad" role="alert">
              {#each saveWorkspace.fields.allIssues() ?? [] as issue (issue.message)}
                <li>{issue.message}</li>
              {/each}
            </ul>
          {/if}
          {#if saveWorkspace.result && 'problem' in saveWorkspace.result}
            <p class="banner bad" role="alert">{saveWorkspace.result.problem}</p>
          {:else if saveWorkspace.result && 'message' in saveWorkspace.result}
            <p class="banner good" role="status">{saveWorkspace.result.message}</p>
          {/if}
          <div class="end">
            <button class="btn" type="submit" disabled={saveWorkspace.pending > 0}>
              <Icon name="check" size={14} />{m.settings.save}
            </button>
          </div>
        </section>
      </form>

      <!-- A credential is written and never read back (FR-011) -->
      <section class="tile" id="keys">
        {@render head('key-round', '', m.settings.claudeCliAndKeys, m.settings.keysLede, {
          label: w.hasModelCredential ? m.settings.oneIsStored : m.settings.noneYet,
          tone: w.hasModelCredential ? 'done' : 'fail',
        })}
        <form {...modelKey} class="grid key">
          <input type="hidden" name="kind" value="model" />
          <label class="f">
            <span>{m.settings.modelCredential}</span>
            <input
              class="mono"
              name="token"
              type="password"
              placeholder={m.settings.pasteItHere}
              autocomplete="off"
            />
            <!--
              Either kind is accepted, and which one this is decides how the
              work is paid for. The runner tells them apart by prefix and hands
              the Claude CLI whichever variable that kind is read from, so
              switching between them is storing a different credential here —
              no code change, no rebuild.
            -->
            <span class="hint">{m.settings.modelCredentialHint}</span>
          </label>
          <div class="f end-field">
            <button type="submit" class="btn btn--secondary" disabled={modelKey.pending > 0}>
              <Icon name="key-round" size={14} />{m.settings.store}
            </button>
          </div>
        </form>
        {#if modelKey.fields.allIssues()?.length}
          <ul class="banner bad" role="alert">
            {#each modelKey.fields.allIssues() ?? [] as issue (issue.message)}
              <li>{issue.message}</li>
            {/each}
          </ul>
        {/if}
        {#if modelKey.result && 'problem' in modelKey.result}
          <p class="banner bad" role="alert">{modelKey.result.problem}</p>
        {:else if modelKey.result && 'message' in modelKey.result}
          <p class="banner good" role="status">{modelKey.result.message}</p>
        {/if}
      </section>

      <section class="tile" id="design">
        {@render head(
          'pen-tool',
          'pen',
          m.settings.designHeading,
          m.settings.designLede,
          stateOf('design', w.hasDesignCredential, m.settings.signedIn, 'queue'),
        )}
        <form {...designKey} class="grid key">
          <input type="hidden" name="kind" value="design" />
          <label class="f">
            <span>{m.settings.designCredential}</span>
            <input
              class="mono"
              name="token"
              type="password"
              placeholder={m.settings.pasteItHere}
              autocomplete="off"
            />
          </label>
          <div class="f end-field">
            <button type="submit" class="btn btn--secondary" disabled={designKey.pending > 0}>
              <Icon name="key-round" size={14} />{m.settings.storeDesignCredential}
            </button>
          </div>
        </form>
        {#if designKey.fields.allIssues()?.length}
          <ul class="banner bad" role="alert">
            {#each designKey.fields.allIssues() ?? [] as issue (issue.message)}
              <li>{issue.message}</li>
            {/each}
          </ul>
        {/if}
        {#if designKey.result && 'problem' in designKey.result}
          <p class="banner bad" role="alert">{designKey.result.problem}</p>
        {:else if designKey.result && 'message' in designKey.result}
          <p class="banner good" role="status">{designKey.result.message}</p>
        {/if}
        {#if tested?.find((row) => row.what === 'design')}
          <p class="quiet">{tested.find((row) => row.what === 'design')?.detail}</p>
        {/if}
        <p class="quiet">{m.settings.designStepNote}</p>
      </section>

      <section class="tile" id="members">
        {@render head('users', '', m.settings.members, m.settings.membersLede)}

        {#if !people.ready}
          <p class="quiet">{m.settings.loadingMembers}</p>
        {:else}
          <ul class="people">
            {#each people.current as person (person.id)}
              <li>
                <span class="who">
                  <strong>{person.name}</strong>
                  <span class="quiet">{person.email}</span>
                </span>
                <span class="quiet">{m.settings.ticketsCreated(person.ticketsCreated)}</span>
                <select
                  value={person.role}
                  aria-label={m.settings.roleFor(person.name)}
                  onchange={async (event) => {
                    const result = await changeRole({
                      userId: person.id,
                      role: event.currentTarget.value as 'admin' | 'member',
                    });
                    notice = ('problem' in result ? result.problem : result.message) ?? null;
                  }}
                >
                  <option value="member">{m.settings.member}</option>
                  <option value="admin">{m.settings.administrator}</option>
                </select>
                {#if person.id !== data.user.id}
                  <button
                    type="button"
                    class="chip-btn danger"
                    onclick={async () => {
                      const result = await removeMember(person.id);
                      notice = ('problem' in result ? result.problem : result.message) ?? null;
                    }}>{m.settings.remove}</button
                  >
                {:else}
                  <span class="quiet you">{m.settings.you}</span>
                {/if}
              </li>
            {/each}
          </ul>
        {/if}

        <form {...inviteMember} class="invite">
          <label class="f">
            <span>{m.settings.name}</span>
            <input name="name" required />
          </label>
          <label class="f">
            <span>{m.settings.email}</span>
            <input name="email" type="email" required />
          </label>
          <label class="f">
            <span>{m.settings.role}</span>
            <select name="role">
              <option value="member">{m.settings.member}</option>
              <option value="admin">{m.settings.administrator}</option>
            </select>
          </label>
          <button type="submit" class="btn btn--secondary" disabled={inviteMember.pending > 0}>
            <Icon name="plus" size={14} />{m.settings.invite}
          </button>
        </form>
        {#if inviteMember.fields.allIssues()?.length}
          <ul class="banner bad" role="alert">
            {#each inviteMember.fields.allIssues() ?? [] as issue (issue.message)}
              <li>{issue.message}</li>
            {/each}
          </ul>
        {/if}
        {#if inviteMember.result && 'problem' in inviteMember.result}
          <p class="banner bad" role="alert">{inviteMember.result.problem}</p>
        {/if}
      </section>

      <section class="tile" id="notifications">
        {@render head('bell', 'grey', m.settings.notifications, m.settings.notificationsLede, {
          label: m.settings.nothingToConfigure,
          tone: 'queue',
        })}
        <!--
          Stated rather than offered. A checkpoint resolves its own approvers
          from the step, and a notify step sends nothing yet: there is nothing
          here a setting could change, and a form that pretended otherwise
          would be worse than the truth.
        -->
        <p class="quiet">{m.settings.approversNote}</p>
        <p class="quiet">{m.settings.notifyStepNote}</p>
      </section>

      <!-- Runs beyond the cap wait, and each author sees where (FR-082) -->
      {#if waiting.ready && waiting.current.entries.length > 0}
        <section class="tile queue">
          {@render head(
            'timer',
            '',
            m.settings.runsNow,
            m.settings.queueSummary(waiting.current.executing, waiting.current.cap, waiting.current.waiting),
          )}
          <ul class="people">
            {#each waiting.current.entries as entry (entry.runId)}
              <li>
                <span class="who">
                  <a href="/tickets/{entry.ticketId}">
                    <strong>{entry.reference}</strong>
                    {entry.title}
                  </a>
                  <span class="quiet">{entry.authorName ?? m.settings.unknownAuthor}</span>
                </span>
                <span class="pill {entry.position === null ? 'pill--live' : 'pill--queue'}">
                  {entry.position === null ? m.settings.executing : m.settings.position(entry.position)}
                </span>
              </li>
            {/each}
          </ul>
        </section>
      {/if}
    </div>
  </div>
{/if}

<style>
  .page-head {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 20px;
    flex-wrap: wrap;
    padding: 4px 4px 0;
    margin-bottom: 20px;
  }
  .text {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  h1 {
    margin: 0;
    font-family: var(--font-head);
    font-size: 30px;
    font-weight: 600;
    letter-spacing: -0.6px;
    color: var(--text);
  }
  .lede {
    margin: 0;
    font-size: var(--type-body);
    color: var(--text-2);
  }
  .notice {
    margin: 0;
    padding: 16px 20px;
    font-size: var(--type-body);
  }

  .wrap {
    display: flex;
    align-items: flex-start;
    gap: 20px;
  }
  .menu {
    position: sticky;
    top: 20px;
    display: flex;
    flex: none;
    flex-direction: column;
    gap: 4px;
    width: 270px;
    padding: 14px;
  }
  .menu a {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    border-radius: 12px;
    font-size: var(--type-body);
    font-weight: 500;
    color: var(--text-2);
    text-decoration: none;
  }
  .menu a :global(svg) {
    color: var(--text-2);
  }
  .menu a:hover {
    background: #f4f2ef;
  }
  .menu a.on {
    font-weight: 700;
    color: var(--text);
    background: var(--accent-soft);
  }
  .menu a.on :global(svg) {
    color: var(--accent);
  }

  .content,
  .stack {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 20px;
    min-width: 0;
  }
  .content > .tile,
  .stack > .tile {
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 22px;
    scroll-margin-top: 20px;
  }

  /* ---- a tile's head ---- */
  .th {
    display: flex;
    align-items: center;
    gap: 14px;
  }
  .sq {
    display: grid;
    flex: none;
    place-items: center;
    width: 42px;
    height: 42px;
    border-radius: 13px;
    color: var(--text-inv);
    background: linear-gradient(180deg, var(--accent-from), var(--accent-to));
  }
  .sq.pen {
    background: linear-gradient(180deg, var(--pen-from), var(--pen-to));
  }
  .sq.grey {
    background: linear-gradient(180deg, #b9b2a9, #6a635a);
  }
  .th .tx {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }
  .th h2 {
    margin: 0;
    font-family: var(--font-head);
    font-size: 17px;
    font-weight: 600;
    color: var(--text);
  }
  .th p {
    margin: 0;
    font-size: var(--type-caption);
    color: var(--text-2);
  }

  /* ---- fields ---- */
  .grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
  }
  .grid.three {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
  .grid.four {
    grid-template-columns: repeat(4, minmax(0, 1fr));
    align-items: end;
  }
  .grid.key {
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: start;
  }
  .f {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }
  .f > span:first-child {
    font-size: var(--type-caption);
    font-weight: 600;
    color: var(--text-2);
  }
  .hint {
    font-size: var(--type-caption);
    color: var(--text-3);
  }
  .end-field {
    justify-content: flex-end;
    padding-top: 22px;
  }
  input,
  select,
  .value {
    width: 100%;
    padding: 10px 12px;
    border: 1px solid transparent;
    border-radius: 12px;
    background: #f4f2ef;
    font: inherit;
    font-size: var(--type-body);
    color: var(--text);
  }
  .value {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .value.missing {
    color: var(--danger-text);
    background: var(--danger-soft);
    white-space: normal;
  }
  .mono {
    font-family: var(--font-mono);
  }
  input:focus,
  select:focus {
    border-color: var(--accent);
    outline: none;
  }

  .opt {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 14px;
    border-radius: 14px;
    background: #f4f2ef;
    cursor: pointer;
  }
  .opt .tx {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 2px;
  }
  .opt .t {
    font-size: var(--type-body);
    font-weight: 600;
    color: var(--text);
  }
  .opt .d {
    font-size: var(--type-caption);
    color: var(--text-2);
  }
  .switch {
    appearance: none;
    position: relative;
    flex: none;
    width: 40px;
    height: 24px;
    padding: 0;
    border: 0;
    border-radius: var(--r-pill);
    background: #d8d3cc;
    cursor: pointer;
  }
  .switch::after {
    content: '';
    position: absolute;
    top: 3px;
    left: 3px;
    width: 18px;
    height: 18px;
    border-radius: var(--r-pill);
    background: #fff;
    transition: transform 120ms ease;
  }
  .switch:checked {
    background: linear-gradient(90deg, var(--accent-from), var(--accent-to));
  }
  .switch:checked::after {
    transform: translateX(16px);
  }
  .switch:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  /* ---- the connection check ---- */
  .tests {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 14px;
    border-radius: 14px;
    background: #f4f2ef;
    color: var(--text-2);
  }
  .tests .t {
    flex: 1;
    font-size: var(--type-caption);
    font-weight: 600;
  }
  .tests.done {
    color: var(--success-text);
    background: var(--success-soft);
  }
  .tests.fail {
    color: var(--danger-text);
    background: var(--danger-soft);
  }
  .chip-btn {
    display: inline-flex;
    flex: none;
    align-items: center;
    gap: 6px;
    padding: 7px 12px;
    border: 0;
    border-radius: 10px;
    background: #fff;
    font: inherit;
    font-size: var(--type-caption);
    font-weight: 600;
    color: var(--text);
    cursor: pointer;
  }
  .chip-btn:disabled {
    opacity: 0.6;
    cursor: progress;
  }
  .chip-btn.danger {
    color: var(--danger-text);
    background: var(--danger-soft);
  }

  /* ---- members and the queue ---- */
  .people {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .people li {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 12px;
    border-radius: 14px;
    background: #f4f2ef99;
  }
  .who {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    font-size: var(--type-body);
  }
  .who a {
    color: var(--text);
    text-decoration: none;
  }
  .who a:hover {
    text-decoration: underline;
  }
  .people select {
    width: auto;
    padding: 7px 10px;
    background: #fff;
  }
  .quiet {
    margin: 0;
    font-size: var(--type-caption);
    color: var(--text-2);
  }
  .you {
    min-width: 5ch;
  }
  .invite {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr)) auto;
    align-items: end;
    gap: 12px;
  }

  .banner {
    margin: 0;
    padding: 12px 16px;
    border-radius: 14px;
    font-size: var(--type-body);
    color: var(--text);
    background: #ffffffcc;
  }
  ul.banner {
    padding-left: 34px;
  }
  .banner.bad {
    color: var(--danger-text);
    background: var(--danger-soft);
  }
  .banner.good {
    color: var(--success-text);
    background: var(--success-soft);
  }
  .banner.warn {
    color: var(--danger-text);
    background: var(--danger-soft);
  }
  .end {
    display: flex;
    justify-content: flex-end;
  }

  @media (max-width: 1100px) {
    .wrap {
      flex-direction: column;
      align-items: stretch;
    }
    .menu {
      position: static;
      flex-direction: row;
      flex-wrap: wrap;
      width: auto;
    }
    .grid.three,
    .grid.four,
    .invite {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
</style>
