<script lang="ts">
  import {
  } from '@factory/shared';
  import Icon from '$components/Icon.svelte';
  import { m } from '$lib/i18n';
  import { publicBaseUrl } from '$lib/remote/repositories.remote';
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
   * Screen 12 — Settings, built to `design.pen`: a 200px column of sections
   * beside cards that each say what they are, what they are for, and whether
   * they are working.
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
  const baseUrl = $derived(publicBaseUrl());

  // A remote form object attaches to one <form>; two cards need two
  // instances, which is what `.for(key)` is for.
  const modelKey = $derived(saveCredential.for('model'));
  const designKey = $derived(saveCredential.for('design'));

  let notice = $state<string | null>(null);
  let tested = $state<{ what: string; state: string; detail: string }[] | null>(null);
  let testing = $state(false);

  const SECTIONS = [
    { id: 'workspace', label: m.settings.workspace },
    { id: 'sandbox', label: m.settings.sandboxDocker },
    { id: 'keys', label: m.settings.claudeCliAndKeys },
    { id: 'design', label: m.settings.designPen },
    { id: 'limits', label: m.settings.costLimits },
    { id: 'members', label: m.settings.members },
    { id: 'notifications', label: m.settings.notifications },
  ];

  const STATE_TONE: Record<string, string> = {
    reachable: 'ok',
    unconfigured: '',
    unreachable: 'bad',
    unauthorised: 'bad',
    wrong_shape: 'warn',
  };
  const WHAT: Record<string, string> = {
    runner: m.settings.containerHost,
    design: m.settings.designService,
  };

  /** What a card's badge says: the last test if there was one, else whether
   *  it is configured at all. */
  function stateOf(what: string, configured: boolean) {
    const result = tested?.find((row) => row.what === what);
    if (result) return { label: result.state.replace('_', ' '), tone: STATE_TONE[result.state] ?? '' };
    return configured
      ? { label: m.settings.configured, tone: '' }
      : { label: m.settings.notSetUp, tone: 'warn' };
  }

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

{#if data.user.role !== 'admin'}
  <p class="card notice">
    {m.settings.adminOnly}
  </p>
{:else if config.error}
  <p class="card failure" role="alert">{(config.error as Error).message}</p>
{:else if !config.ready}
  <p class="card">Loading settings…</p>
{:else}
  {@const w = config.current.workspace}
  {@const r = config.current.readiness}

  <div class="wrap">
    <nav class="sections" aria-label={m.settings.sections}>
      {#each SECTIONS as section (section.id)}
        <a href="#{section.id}">{section.label}</a>
      {/each}
    </nav>

    <div class="content">
      {#if notice}<p class="banner" role="status">{notice}</p>{/if}

      {#if !r.ready}
        <p class="banner warn" role="status">
          {m.settings.cannotStart(r.missing.join(', '))}
        </p>
      {/if}

      <form {...saveWorkspace} class="stack">
        <section class="card" id="workspace">
          <header>
            <span class="ic"><Icon name="settings" size={18} /></span>
            <div class="tx">
              <h2>{m.settings.workspace}</h2>
              <p>{m.settings.workspaceLede}</p>
            </div>
            <span class="badge {r.ready ? 'ok' : 'warn'}">
              <span class="dot"></span>
              {r.ready ? 'Ready to run' : 'Not ready'}
            </span>
          </header>
          <div class="grid">
            <label class="f">
              <span>Name</span>
              <input name="name" value={w.name} required />
            </label>
          </div>
        </section>

        <section class="card" id="sandbox">
          <header>
            <span class="ic"><Icon name="container" size={18} /></span>
            <div class="tx">
              <h2>{m.settings.sandboxHeading}</h2>
              <p>{m.settings.sandboxLede}</p>
            </div>
            {#await Promise.resolve(stateOf('runner', Boolean(w.runnerBaseUrl))) then s}
              <span class="badge {s.tone}"><span class="dot"></span>{s.label}</span>
            {/await}
          </header>
          <div class="grid">
            <label class="f">
              <span>{m.settings.containerHostAddress}</span>
              <input
                name="runnerBaseUrl"
                value={w.runnerBaseUrl ?? ''}
                placeholder="http://localhost:8080"
              />
            </label>
            <label class="f">
              <span>{m.settings.image}</span>
              <input name="sandboxImage" value={w.sandboxImage} required />
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

        <section class="card" id="limits">
          <header>
            <span class="ic"><Icon name="coins" size={18} /></span>
            <div class="tx">
              <h2>{m.settings.costLimits}</h2>
              <p>{m.settings.costLimitsLede}</p>
            </div>
          </header>
          <div class="grid">
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
        </section>

        <!-- Each connection test says which of three things is wrong (FR-005a) -->
        <div class="tests" class:ok={tested?.every((row) => row.state === 'reachable')}>
          <Icon name="activity" size={16} />
          {#if tested}
            <ul class="results">
              {#each tested as result (result.what)}
                <li class={STATE_TONE[result.state] ?? ''}>
                  <strong>{WHAT[result.what] ?? result.what}</strong>
                  <span>{result.detail}</span>
                </li>
              {/each}
            </ul>
          {:else}
            <span class="t">
              A test tells reachable-and-authorised apart from unreachable and from refused,
              because those three need different fixes.
            </span>
          {/if}
          <button type="button" class="secondary" disabled={testing} onclick={test}>
            <Icon name="plug" size={16} />
            <span>{testing ? m.settings.testing : m.settings.testConnection}</span>
          </button>
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
          <button class="primary" type="submit" disabled={saveWorkspace.pending > 0}>
            <Icon name="save" size={16} />
            <span>{m.settings.save}</span>
          </button>
        </div>
      </form>

      <!-- A credential is written and never read back (FR-011) -->
      <section class="card" id="keys">
        <header>
          <span class="ic"><Icon name="key-round" size={18} /></span>
          <div class="tx">
            <h2>{m.settings.claudeCliAndKeys}</h2>
            <p>{m.settings.keysLede}</p>
          </div>
          <span class="badge {w.hasModelCredential ? 'ok' : 'warn'}">
            <span class="dot"></span>
            {w.hasModelCredential ? m.settings.oneIsStored : m.settings.noneYet}
          </span>
        </header>
        <form {...modelKey} class="grid">
          <input type="hidden" name="kind" value="model" />
          <label class="f">
            <span>{m.settings.modelCredential}</span>
            <input
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
            <span class="hint">
              An API key, billed per use to an Anthropic Console account — or a Claude subscription
              token from <code>claude setup-token</code>, which draws on that subscription's own
              allowance instead. A subscription's limits are shaped around one person working, so
              watch them if several runs execute at once.
            </span>
          </label>
          <div class="f end-field">
            <button type="submit" class="secondary" disabled={modelKey.pending > 0}>
              <Icon name="key-round" size={16} />
              <span>{m.settings.store}</span>
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

      <section class="card" id="design">
        <header>
          <span class="ic pink"><Icon name="palette" size={18} /></span>
          <div class="tx">
            <h2>{m.settings.designHeading}</h2>
            <p>{m.settings.designLede}</p>
          </div>
          <span class="badge {w.hasDesignCredential ? 'ok' : ''}">
            <span class="dot"></span>
            {w.hasDesignCredential ? 'Signed in' : 'Not set up'}
          </span>
        </header>
        <form {...designKey} class="grid">
          <input type="hidden" name="kind" value="design" />
          <label class="f">
            <span>{m.settings.designCredential}</span>
            <input name="token" type="password" placeholder="paste it here" autocomplete="off" />
          </label>
          <div class="f end-field">
            <button type="submit" class="secondary" disabled={designKey.pending > 0}>
              <Icon name="key-round" size={16} />
              <span>{m.settings.storeDesignCredential}</span>
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
        <p class="quiet">
          A design step's model and export settings belong to the step, not here — set them on the
          step in the pipeline builder.
        </p>
      </section>

      <section class="card" id="members">
        <header>
          <span class="ic"><Icon name="user" size={18} /></span>
          <div class="tx">
            <h2>{m.settings.members}</h2>
            <p>{m.settings.membersLede}</p>
          </div>
        </header>

        {#if !people.ready}
          <p class="quiet">Loading…</p>
        {:else}
          <ul class="people">
            {#each people.current as person (person.id)}
              <li>
                <span class="who">
                  <strong>{person.name}</strong>
                  <span class="quiet">{person.email}</span>
                </span>
                <span class="quiet">
                  {person.ticketsCreated} ticket{person.ticketsCreated === 1 ? '' : 's'}
                </span>
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
                  <option value="member">Member</option>
                  <option value="admin">Administrator</option>
                </select>
                {#if person.id !== data.user.id}
                  <button
                    type="button"
                    class="danger"
                    onclick={async () => {
                      const result = await removeMember(person.id);
                      notice = ('problem' in result ? result.problem : result.message) ?? null;
                    }}>{m.settings.remove}</button
                  >
                {:else}
                  <span class="quiet">you</span>
                {/if}
              </li>
            {/each}
          </ul>
        {/if}

        <form {...inviteMember} class="invite">
          <label class="f">
            <span>Name</span>
            <input name="name" required />
          </label>
          <label class="f">
            <span>Email</span>
            <input name="email" type="email" required />
          </label>
          <label class="f">
            <span>Role</span>
            <select name="role">
              <option value="member">Member</option>
              <option value="admin">Administrator</option>
            </select>
          </label>
          <button type="submit" class="secondary" disabled={inviteMember.pending > 0}>
            <Icon name="plus" size={16} />
            <span>Invite</span>
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

      <section class="card" id="notifications">
        <header>
          <span class="ic"><Icon name="bell" size={18} /></span>
          <div class="tx">
            <h2>{m.settings.notifications}</h2>
            <p>{m.settings.notificationsLede}</p>
          </div>
          <span class="badge"><span class="dot"></span>{m.settings.nothingToConfigure}</span>
        </header>
        <!--
          Stated rather than offered. A checkpoint resolves its own approvers
          from the step, and this deployment has no channel to send to: there
          is nothing here a setting could change, and a form that pretended
          otherwise would be worse than the truth.
        -->
        <p class="quiet">
          {m.settings.approversNote}
        </p>
        <p class="quiet">
          {m.settings.notifyStepNote}
        </p>
      </section>

      <!-- Runs beyond the cap wait, and each author sees where (FR-082) -->
      {#if waiting.ready && waiting.current.entries.length > 0}
        <section class="card queue">
          <header>
            <span class="ic"><Icon name="timer" size={18} /></span>
            <div class="tx">
              <h2>{m.settings.runsNow}</h2>
              <p>
                {waiting.current.executing} of {waiting.current.cap} executing
                {#if waiting.current.waiting > 0}&middot; {waiting.current.waiting} waiting{/if}
              </p>
            </div>
          </header>
          <ul class="people">
            {#each waiting.current.entries as entry (entry.runId)}
              <li>
                <span class="who">
                  <a href="/tickets/{entry.ticketId}">
                    <strong>{entry.reference}</strong>
                    {entry.title}
                  </a>
                  <span class="quiet">{entry.authorName ?? 'unknown'}</span>
                </span>
                <span class="badge {entry.position === null ? 'live' : 'warn'}">
                  <span class="dot"></span>
                  {entry.position === null ? 'executing' : `position ${entry.position}`}
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
  .wrap {
    display: flex;
    align-items: flex-start;
    gap: 24px;
  }
  .sections {
    display: flex;
    flex-direction: column;
    gap: 2px;
    width: 200px;
    flex: none;
    position: sticky;
    top: 16px;
  }
  .sections a {
    padding: 9px 12px;
    border-radius: var(--r-sm);
    font-size: 13px;
    color: var(--text-2);
    text-decoration: none;
  }
  .sections a:hover,
  .sections a:target {
    background: var(--surface);
    color: var(--text);
  }

  .content,
  .stack {
    display: flex;
    flex-direction: column;
    gap: 16px;
    flex: 1;
    min-width: 0;
  }

  .card {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 20px;
    background: var(--surface);
    border: 1px solid var(--card-border);
    border-radius: var(--r-lg);
    box-shadow: 0 1px 2px #0f172a0a;
    scroll-margin-top: 16px;
  }
  .card > header {
    display: flex;
    align-items: flex-start;
    gap: 12px;
  }
  .ic {
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    border-radius: var(--r-sm);
    background: var(--surface-2);
    color: var(--text-2);
    flex: none;
  }
  .ic.pink {
    background: var(--design-soft);
    color: var(--design);
  }
  .card > header .tx {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1;
    min-width: 0;
  }
  h2 {
    margin: 0;
    font-family: var(--font-head);
    font-size: 15px;
    font-weight: 600;
    color: var(--text);
  }
  .card > header p {
    margin: 0;
    font-size: 12px;
    color: var(--text-2);
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: 14px;
  }
  .grid.four {
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  }
  .f {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }
  .f > span,
  .as-label {
    font-size: 12px;
    font-weight: 600;
    color: var(--text);
  }
  .f small {
    font-size: 11px;
    color: var(--text-3);
  }
  .end-field {
    justify-content: flex-end;
  }
  input,
  select {
    padding: 9px 12px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: var(--surface);
    font: inherit;
    font-size: 13px;
    color: var(--text);
    width: 100%;
  }
  input:read-only {
    background: var(--surface-2);
    color: var(--text-2);
  }

  /*
    A limit the configured execution host cannot enforce (FR-011a).

    Dimmed rather than hidden, and this is the deliberate choice: hiding it
    would leave an administrator wondering where a setting they remember went,
    and would hide the STORED value — which still applies if the deployment
    moves back to a host that honours it. So the value stays visible and
    reads as inert.
  */

  /* A sentence under a field about what the host will really do with it. */
  .hint {
    font-size: 11px;
    line-height: 1.45;
    color: var(--text-3);
  }


  /* The sandbox option, as the artboard draws it. */
  .opt {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding-top: 12px;
    border-top: 1px solid var(--border);
    cursor: pointer;
  }
  .opt .tx {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .opt .t {
    font-size: 13px;
    color: var(--text);
  }
  .opt .d {
    font-size: 11px;
    color: var(--text-3);
  }
  .switch {
    appearance: none;
    position: relative;
    width: 36px;
    height: 20px;
    padding: 0;
    border: 0;
    border-radius: 999px;
    background: var(--flow-line);
    cursor: pointer;
    flex: none;
    transition: background 120ms ease;
  }
  .switch::after {
    content: '';
    position: absolute;
    top: 2px;
    left: 2px;
    width: 16px;
    height: 16px;
    border-radius: 999px;
    background: var(--surface);
    transition: transform 120ms ease;
  }
  .switch:checked {
    background: var(--accent);
  }
  .switch:checked::after {
    transform: translateX(16px);
  }

  .tests {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 16px;
    border-radius: var(--r-md);
    background: var(--surface-2);
    font-size: 12px;
    color: var(--text-2);
  }
  .tests.ok {
    background: var(--success-soft);
    color: var(--success);
  }
  .tests > :global(svg) {
    flex: none;
  }
  .tests .t {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1;
    min-width: 0;
  }
  .results {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
    flex: 1;
    min-width: 0;
  }
  .results li {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  .results li.bad {
    color: var(--danger);
  }
  .results li.warn {
    color: var(--warning);
  }
  .results li.ok {
    color: var(--success);
  }

  .people {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .people li {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 0;
    border-top: 1px solid var(--border);
  }
  .people li:first-child {
    border-top: 0;
  }
  .who {
    display: flex;
    flex-direction: column;
    gap: 1px;
    flex: 1;
    min-width: 0;
    font-size: 13px;
  }
  .who a {
    color: inherit;
    text-decoration: none;
  }
  .who a:hover {
    color: var(--accent-text);
  }
  .people select {
    width: auto;
  }

  .invite {
    display: flex;
    align-items: flex-end;
    gap: 12px;
    flex-wrap: wrap;
    padding-top: 12px;
    border-top: 1px solid var(--border);
  }
  .invite .f {
    flex: 1;
    min-width: 160px;
  }

  .badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    border-radius: 999px;
    background: var(--surface-2);
    font-size: 12px;
    font-weight: 500;
    color: var(--text-2);
    flex: none;
  }
  .badge.ok {
    background: var(--success-soft);
    color: var(--success);
  }
  .badge.warn {
    background: var(--warning-soft);
    color: var(--warning);
  }
  .badge.bad {
    background: var(--danger-soft);
    color: var(--danger);
  }
  .badge.live {
    background: var(--accent-soft);
    color: var(--accent-text);
  }
  .dot {
    width: 6px;
    height: 6px;
    border-radius: 999px;
    background: currentcolor;
    flex: none;
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
  .danger {
    padding: 6px 12px;
    border: 1px solid var(--border);
    background: var(--surface);
    font-size: 13px;
    color: var(--danger);
  }
  button:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
  .end {
    display: flex;
    justify-content: flex-end;
  }

  .quiet {
    margin: 0;
    font-size: 12px;
    color: var(--text-2);
  }
  .banner {
    margin: 0;
    padding: 12px 16px;
    border-radius: var(--r-md);
    background: var(--surface-2);
    font-size: 13px;
    color: var(--text-2);
  }
  ul.banner {
    padding-left: 34px;
  }
  .banner.warn {
    background: var(--warning-soft);
    color: var(--warning);
  }
  .banner.bad {
    background: var(--danger-soft);
    color: var(--danger);
  }
  .banner.good {
    background: var(--success-soft);
    color: var(--success);
  }
  .notice {
    border-left: 3px solid var(--accent);
    padding: 12px 16px;
  }
  .failure {
    border-left: 3px solid var(--danger);
    padding: 12px 16px;
    color: var(--danger);
  }

  @media (max-width: 1000px) {
    .wrap {
      flex-direction: column;
    }
    .sections {
      flex-direction: row;
      flex-wrap: wrap;
      width: auto;
      position: static;
    }
  }
</style>
