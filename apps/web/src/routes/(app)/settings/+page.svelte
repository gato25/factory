<script lang="ts">
  import {
    changeRole,
    connections,
    inviteMember,
    members,
    queue,
    removeMember,
    saveCredential,
    saveWorkspace,
    settings
  } from '$lib/remote/settings.remote';

  /**
   * Screen 12 — Settings. Workspace, orchestration, sandbox, credentials,
   * design, cost limits, members. Administrator-only, and the rule is
   * checked inside every remote function rather than by hiding this screen
   * (FR-004).
   */
  let { data }: { data: { user: { id: string; role: string } } } = $props();

  const config = $derived(settings());
  const people = $derived(members());
  const waiting = $derived(queue());
  let notice = $state<string | null>(null);
  let tested = $state<{ what: string; state: string; detail: string }[] | null>(null);

  const STATE_TONE: Record<string, string> = {
    reachable: 'ok',
    unconfigured: '',
    unreachable: 'bad',
    unauthorised: 'bad',
    wrong_shape: 'warn'
  };
  const WHAT: Record<string, string> = {
    orchestrator: 'Orchestration service',
    runner: 'Container host',
    design: 'Design service'
  };
</script>

{#if data.user.role !== 'admin'}
  <p class="card notice">
    Workspace settings — credentials, connections, ceilings and membership — are for
    administrators. Everything else in Code Factory is not: pipelines, agents and skills go by who
    owns them, and anyone can make their own.
  </p>
{:else if config.error}
  <p class="card failure" role="alert">{(config.error as Error).message}</p>
{:else if !config.ready}
  <p class="card">Loading settings…</p>
{:else}
  {@const w = config.current.workspace}
  {@const r = config.current.readiness}

  {#if notice}<p class="card notice" role="status">{notice}</p>{/if}

  {#if !r.ready}
    <p class="card warning" role="status">
      This workspace cannot start a run yet. Still needed: {r.missing.join(', ')}.
    </p>
  {/if}

  <!-- Each connection test says which of three things is wrong (FR-005a) -->
  <section class="card">
    <h2 class="section">Connections</h2>
    <p class="muted small">
      A test tells reachable-and-authorised apart from unreachable and from refused, because those
      three need different fixes.
    </p>
    <div class="row">
      <button
        type="button"
        onclick={async () => {
          const result = await connections();
          tested = 'problem' in result ? null : result.results;
          if ('problem' in result) notice = result.problem;
        }}>Test every connection</button
      >
    </div>
    {#if tested}
      <ul class="results">
        {#each tested as result (result.what)}
          <li>
            <span class="badge small {STATE_TONE[result.state] ?? ''}">
              {result.state.replace('_', ' ')}
            </span>
            <span>
              <strong>{WHAT[result.what] ?? result.what}</strong>
              <span class="muted small">{result.detail}</span>
            </span>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <form {...saveWorkspace} class="card">
    <h2 class="section">Workspace</h2>
    <div class="grid">
      <label>
        <span class="small muted">Name</span>
        <input name="name" value={w.name} required />
      </label>
      <label>
        <span class="small muted">Orchestration service address</span>
        <input name="orchestratorBaseUrl" value={w.orchestratorBaseUrl ?? ''} placeholder="http://n8n:5678" />
      </label>
      <label>
        <span class="small muted">Workflow identifier</span>
        <input name="orchestratorWorkflowId" value={w.orchestratorWorkflowId ?? ''} />
      </label>
      <label>
        <span class="small muted">Container host address</span>
        <input name="runnerBaseUrl" value={w.runnerBaseUrl ?? ''} placeholder="http://runner:8080" />
      </label>
    </div>

    <h2 class="section">Cost limits</h2>
    <p class="muted small">
      These are the ceilings a member's own limits cannot exceed. A limit somebody sets on their
      agent is capped at these, so it can only ever lower what a run may consume.
    </p>
    <div class="grid">
      <label>
        <span class="small muted">Most a run may spend, in dollars</span>
        <input name="defaultCostCeilingUsd" value={w.defaultCostCeilingUsd} required />
      </label>
      <label>
        <span class="small muted">Longest a run may take, in minutes</span>
        <input name="defaultTimeCeilingMinutes" type="number" min="1" value={w.defaultTimeCeilingMinutes} required />
      </label>
      <label>
        <span class="small muted">Runs that may execute at once</span>
        <input name="maxConcurrentRuns" type="number" min="1" value={w.maxConcurrentRuns} required />
      </label>
    </div>

    <h2 class="section">Sandbox</h2>
    <p class="muted small">
      What a sandbox is allowed while code is being written. Network access off is the default:
      an agent writing code does not need the internet, and a sandbox that cannot reach it cannot
      send anything out.
    </p>
    <div class="grid">
      <label>
        <span class="small muted">Image</span>
        <input name="sandboxImage" value={w.sandboxImage} required />
      </label>
      <label>
        <span class="small muted">Processors</span>
        <input name="sandboxCpu" type="number" min="1" value={w.sandboxCpu} required />
      </label>
      <label>
        <span class="small muted">Memory, in megabytes</span>
        <input name="sandboxMemoryMb" type="number" min="512" step="256" value={w.sandboxMemoryMb} required />
      </label>
      <label>
        <span class="small muted">Lifetime, in minutes</span>
        <input name="sandboxWallClockMinutes" type="number" min="1" value={w.sandboxWallClockMinutes} required />
      </label>
      <label>
        <span class="small muted">Keep a failed run's sandbox for, in hours</span>
        <input name="retainFailedSandboxesHours" type="number" min="0" value={w.retainFailedSandboxesHours} required />
      </label>
      <label class="inline">
        <input
          type="checkbox"
          name="sandboxNetworkDuringImplement"
          value="true"
          checked={w.sandboxNetworkDuringImplement}
        />
        <span>Let a sandbox reach the network while code is being written</span>
      </label>
    </div>

    {#if saveWorkspace.fields.allIssues()?.length}
      <ul class="errors" role="alert">
        {#each saveWorkspace.fields.allIssues() ?? [] as issue (issue.message)}
          <li>{issue.message}</li>
        {/each}
      </ul>
    {/if}
    {#if saveWorkspace.result && 'problem' in saveWorkspace.result}
      <p class="errors" role="alert">{saveWorkspace.result.problem}</p>
    {:else if saveWorkspace.result && 'message' in saveWorkspace.result}
      <p class="ok small" role="status">{saveWorkspace.result.message}</p>
    {/if}
    <div class="row end">
      <button class="primary" type="submit" disabled={saveWorkspace.pending > 0}>Save</button>
    </div>
  </form>

  <!-- A credential is written and never read back (FR-011) -->
  <form {...saveCredential} class="card">
    <h2 class="section">Credentials</h2>
    <p class="muted small">
      Stored encrypted, supplied to a run as environment, and never shown again — not even to you.
      Replacing one is the only way to change it.
    </p>
    <div class="grid">
      <label>
        <span class="small muted">Which</span>
        <select name="kind">
          <option value="model">
            Model credential {w.hasModelCredential ? '— one is stored' : '— none yet'}
          </option>
          <option value="design">
            Design service {w.hasDesignCredential ? '— one is stored' : '— none yet'}
          </option>
        </select>
      </label>
      <label>
        <span class="small muted">Credential</span>
        <input name="token" type="password" placeholder="paste it here" autocomplete="off" />
      </label>
    </div>
    {#if saveCredential.fields.allIssues()?.length}
      <ul class="errors" role="alert">
        {#each saveCredential.fields.allIssues() ?? [] as issue (issue.message)}
          <li>{issue.message}</li>
        {/each}
      </ul>
    {/if}
    {#if saveCredential.result && 'problem' in saveCredential.result}
      <p class="errors" role="alert">{saveCredential.result.problem}</p>
    {:else if saveCredential.result && 'message' in saveCredential.result}
      <p class="ok small" role="status">{saveCredential.result.message}</p>
    {/if}
    <div class="row end">
      <button type="submit" disabled={saveCredential.pending > 0}>Store</button>
    </div>
  </form>

  <section class="card">
    <h2 class="section">Members</h2>
    {#if !people.ready}
      <p class="muted small">Loading…</p>
    {:else}
      <ul class="people">
        {#each people.current as person (person.id)}
          <li>
            <span class="who">
              <strong>{person.name}</strong>
              <span class="muted small">{person.email}</span>
              <span class="muted small">
                {person.ticketsCreated} ticket{person.ticketsCreated === 1 ? '' : 's'}
              </span>
            </span>
            <select
              value={person.role}
              aria-label="Role for {person.name}"
              onchange={async (e) => {
                const result = await changeRole({
                  userId: person.id,
                  role: e.currentTarget.value as 'admin' | 'member'
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
                }}>Remove</button
              >
            {:else}
              <span class="muted small">you</span>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}

    <form {...inviteMember} class="invite">
      <label>
        <span class="small muted">Name</span>
        <input name="name" required />
      </label>
      <label>
        <span class="small muted">Email</span>
        <input name="email" type="email" required />
      </label>
      <label>
        <span class="small muted">Role</span>
        <select name="role">
          <option value="member">Member</option>
          <option value="admin">Administrator</option>
        </select>
      </label>
      <button type="submit" disabled={inviteMember.pending > 0}>Invite</button>
    </form>
    {#if inviteMember.fields.allIssues()?.length}
      <ul class="errors" role="alert">
        {#each inviteMember.fields.allIssues() ?? [] as issue (issue.message)}
          <li>{issue.message}</li>
        {/each}
      </ul>
    {/if}
    {#if inviteMember.result && 'problem' in inviteMember.result}
      <p class="errors" role="alert">{inviteMember.result.problem}</p>
    {/if}
  </section>

  <!-- Runs beyond the cap wait, and each author sees where (FR-082) -->
  {#if waiting.ready && waiting.current.entries.length > 0}
    <section class="card queue">
      <h2 class="section">
        Runs now <span class="muted">
          {waiting.current.executing} of {waiting.current.cap} executing
          {#if waiting.current.waiting > 0}&middot; {waiting.current.waiting} waiting{/if}
        </span>
      </h2>
      <ul class="people">
        {#each waiting.current.entries as entry (entry.runId)}
          <li>
            <span class="who">
              <a href="/tickets/{entry.ticketId}">
                <strong>{entry.reference}</strong> {entry.title}
              </a>
              <span class="muted small">{entry.authorName ?? 'unknown'}</span>
            </span>
            <span class="badge small {entry.position === null ? 'live' : 'warn'}">
              {entry.position === null ? 'executing' : `position ${entry.position}`}
            </span>
          </li>
        {/each}
      </ul>
    </section>
  {/if}
{/if}

<style>
  .notice { border-left: 3px solid var(--accent); margin-bottom: 16px; padding: 12px 16px; }
  .warning { border-left: 3px solid var(--warning); margin-bottom: 16px; padding: 12px 16px; color: #8a6100; }
  .failure { border-left: 3px solid var(--danger); padding: 12px 16px; }
  section, form { margin-bottom: 16px; display: flex; flex-direction: column; gap: 10px; }
  section p, form p { margin: 0; }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: 10px;
  }
  label { display: flex; flex-direction: column; gap: 4px; }
  label.inline { flex-direction: row; align-items: center; gap: 8px; }
  input, select {
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    font: inherit;
    width: 100%;
    box-sizing: border-box;
  }
  label.inline input { width: auto; }
  .row { display: flex; gap: 8px; }
  .row.end { justify-content: flex-end; }
  button {
    padding: 8px 14px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: var(--surface);
    font: inherit;
    cursor: pointer;
    white-space: nowrap;
  }
  button.primary {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
    font-weight: 600;
  }
  button.danger { color: var(--danger); border-color: #f3c7c4; }
  .results, .people { list-style: none; margin: 0; padding: 0; }
  .results li, .people li {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 2px;
    border-top: 1px solid var(--border);
  }
  .results li:first-child, .people li:first-child { border-top: 0; }
  .results li span:last-child { display: flex; flex-direction: column; }
  .who { flex: 1; display: flex; flex-direction: column; min-width: 0; }
  .who a { text-decoration: none; color: inherit; }
  .invite {
    display: grid;
    grid-template-columns: 1fr 1fr auto auto;
    gap: 8px;
    align-items: end;
    margin: 8px 0 0;
    padding-top: 12px;
    border-top: 1px solid var(--border);
  }
  .errors { margin: 0; padding-left: 18px; color: var(--danger); }
  .ok { color: var(--success); }
  @media (max-width: 720px) {
    .invite { grid-template-columns: 1fr; }
  }
</style>
