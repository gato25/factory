<script lang="ts">
  import { page } from '$app/state';
  import OwnerBadge from '$components/OwnerBadge.svelte';
  import { agent, options, reset, save } from '$lib/remote/agents.remote';
  import { skills } from '$lib/remote/skills.remote';

  /**
   * Screen 10 — Agent Editor. Instructions with their template variables, the
   * model, the limits, the tool toggles, the attached skills, and Reset to
   * default. Each is configured independently (FR-036); saving writes them
   * together, because a half-saved agent is worse than either.
   *
   * For an agent on the design service, the model list is that service's own
   * and the tool permissions are omitted entirely — they do not apply
   * (FR-036a).
   */
  const id = $derived(page.params.id as string);
  const detail = $derived(agent(id));
  const vocabulary = $derived(options());
  const skillList = $derived(skills());

  let engine = $state<'claude_cli' | 'design_cli' | null>(null);
  let model = $state<string | null>(null);
  let tools = $state<string[] | null>(null);
  let attached = $state<string[] | null>(null);
  let loadedFor = $state<string | null>(null);
  let notice = $state<string | null>(null);

  $effect(() => {
    if (!detail.ready) return;
    // Seeded once per agent, then owned by this screen, or a keystroke would
    // be undone by the refresh it caused.
    if (loadedFor !== detail.current.id) {
      engine = detail.current.engine;
      model = detail.current.model;
      tools = [...detail.current.allowedTools];
      attached = detail.current.skills.map((skill) => skill.id);
      loadedFor = detail.current.id;
    }
  });

  const models = $derived(
    vocabulary.ready && engine ? (vocabulary.current.models[engine] ?? []) : []
  );

  function toggleTool(name: string, on: boolean) {
    const current = tools ?? [];
    tools = on ? [...current, name] : current.filter((tool) => tool !== name);
  }

  function toggleSkill(skillId: string, on: boolean) {
    const current = attached ?? [];
    attached = on ? [...current, skillId] : current.filter((held) => held !== skillId);
  }
</script>

{#if detail.error}
  <p class="card failure" role="alert">{(detail.error as Error).message}</p>
{:else if !detail.ready || engine === null}
  <p class="card">Loading the agent…</p>
{:else}
  {@const a = detail.current}

  <header class="card head">
    <div>
      <p class="small muted"><a href="/agents">Agents</a></p>
      <h1>{a.name}</h1>
      <p class="small muted">
        <OwnerBadge
          isDefault={a.isDefault}
          ownerName={a.ownerName}
          mayChange={a.mayChange}
        />
        &middot; used by {a.usage.pipelines} pipeline{a.usage.pipelines === 1 ? '' : 's'}
        and {a.usage.runs} run{a.usage.runs === 1 ? '' : 's'}
        {#if a.usage.runsInFlight > 0}
          &middot; {a.usage.runsInFlight} in flight
        {/if}
      </p>
      {#if a.usedBy.length > 0}
        <p class="small muted">
          In: {a.usedBy.map((p) => p.name).join(', ')}
        </p>
      {/if}
    </div>
    {#if a.mayChange && a.resettable}
      <!-- Back to what shipped (FR-040) -->
      <button
        type="button"
        disabled={!a.modifiedFromShipped}
        title={a.modifiedFromShipped
          ? 'Discard every change and go back to what shipped'
          : 'This agent already matches what shipped'}
        onclick={async () => {
          const result = await reset(a.id);
          notice = ('problem' in result ? result.problem : result.message) ?? null;
          loadedFor = null;
        }}>Reset to default</button
      >
    {/if}
  </header>

  {#if notice}<p class="card notice" role="status">{notice}</p>{/if}
  {#if save.result && 'problem' in save.result && save.result.problem}
    <p class="card failure" role="alert">{save.result.problem}</p>
  {:else if save.result && 'message' in save.result}
    <p class="card notice" role="status">{save.result.message}</p>
  {/if}

  {#if !a.mayChange}
    <p class="card notice">
      You can read everything here and duplicate it. Changing it is for
      {a.isDefault ? 'an administrator' : (a.ownerName ?? 'its owner')}.
    </p>
  {/if}

  <form {...save} class="editor">
    <input type="hidden" name="agentId" value={a.id} />
    <input type="hidden" name="allowedTools" value={(tools ?? []).join(',')} />
    <input type="hidden" name="skillIds" value={(attached ?? []).join(',')} />

    <div class="layout">
      <div class="column">
        <section class="card">
          <h2 class="section">Instructions</h2>
          <label>
            <span class="sr">Instructions</span>
            <textarea
              name="systemPrompt"
              rows="18"
              disabled={!a.mayChange}
              value={a.systemPrompt}
            ></textarea>
          </label>
          {#if vocabulary.ready}
            <details class="vars">
              <summary class="small">Values you can refer to</summary>
              <dl>
                {#each vocabulary.current.variables as variable (variable.name)}
                  <dt><code>&#123;&#123;{variable.name}&#125;&#125;</code></dt>
                  <dd class="muted small">{variable.what}</dd>
                {/each}
              </dl>
            </details>
          {/if}
        </section>

        {#if engine === 'claude_cli'}
          <!-- Withholding a tool makes it unreachable, not discouraged (FR-039) -->
          <section class="card">
            <h2 class="section">Tools it may use</h2>
            <p class="muted small">
              A tool that is off is unreachable: the agent cannot take an action needing it.
            </p>
            {#if vocabulary.ready}
              <ul class="toggles">
                {#each vocabulary.current.tools as tool (tool.name)}
                  <li>
                    <label class="inline">
                      <input
                        type="checkbox"
                        disabled={!a.mayChange}
                        checked={(tools ?? []).includes(tool.name)}
                        onchange={(e) => toggleTool(tool.name, e.currentTarget.checked)}
                      />
                      <span><code>{tool.name}</code> <span class="muted small">{tool.what}</span></span>
                    </label>
                  </li>
                {/each}
              </ul>
            {/if}
          </section>
        {:else}
          <section class="card">
            <h2 class="section">Tools</h2>
            <p class="muted small">
              Tool permissions do not apply to the design service, so there are none to set.
            </p>
          </section>
        {/if}
      </div>

      <div class="side">
        <section class="card">
          <h2 class="section">Engine and model</h2>
          <label>
            <span class="small muted">Engine</span>
            <select
              name="engine"
              disabled={!a.mayChange}
              bind:value={engine}
              onchange={() => {
                // The two engines offer different models, so the choice has
                // to be made again rather than left invalid.
                model = null;
              }}
            >
              <option value="claude_cli">Coding agent</option>
              <option value="design_cli">Design service</option>
            </select>
          </label>
          <label>
            <span class="small muted">Model</span>
            <select name="model" disabled={!a.mayChange} value={model ?? models[0] ?? ''}>
              {#each models as option (option)}
                <option value={option}>{option}</option>
              {/each}
            </select>
          </label>
        </section>

        <section class="card">
          <h2 class="section">Its own limits</h2>
          <p class="muted small">
            Each is capped at what the run allows, so a limit here cannot raise what a ticket may
            consume. Leave one empty to use the run's.
          </p>
          <label>
            <span class="small muted">Most it may spend in a step, in dollars</span>
            <input
              name="maxCostUsd"
              disabled={!a.mayChange}
              placeholder="the run's ceiling"
              value={a.maxCostUsd ?? ''}
            />
          </label>
          <label>
            <span class="small muted">Longest a step may take, in minutes</span>
            <input
              name="maxMinutes"
              type="number"
              min="1"
              disabled={!a.mayChange}
              placeholder="the run's ceiling"
              value={a.maxMinutes ?? ''}
            />
          </label>
          <label>
            <span class="small muted">Most turns it may take</span>
            <input
              name="maxTurns"
              type="number"
              min="1"
              disabled={!a.mayChange}
              placeholder="no limit"
              value={a.maxTurns ?? ''}
            />
          </label>
        </section>

        <section class="card">
          <h2 class="section">Skills it holds</h2>
          {#if !skillList.ready}
            <p class="muted small">Loading…</p>
          {:else if skillList.current.length === 0}
            <p class="muted small">
              No skills yet. <a href="/skills">Write one</a> and it can be attached here.
            </p>
          {:else}
            <ul class="toggles">
              {#each skillList.current as available (available.id)}
                <li>
                  <label class="inline">
                    <input
                      type="checkbox"
                      disabled={!a.mayChange}
                      checked={(attached ?? []).includes(available.id)}
                      onchange={(e) => toggleSkill(available.id, e.currentTarget.checked)}
                    />
                    <span>
                      {available.name}
                      <span class="muted small">{available.description}</span>
                    </span>
                  </label>
                </li>
              {/each}
            </ul>
          {/if}
        </section>

        <section class="card">
          <h2 class="section">Name</h2>
          <label>
            <span class="small muted">Name</span>
            <input name="name" disabled={!a.mayChange} value={a.name} required />
          </label>
          <label>
            <span class="small muted">What it is for</span>
            <input name="description" disabled={!a.mayChange} value={a.description ?? ''} />
          </label>
        </section>
      </div>
    </div>

    {#if a.mayChange}
      <div class="card saver">
        {#if save.fields.allIssues()?.length}
          <ul class="errors" role="alert">
            {#each save.fields.allIssues() ?? [] as issue (issue.message)}
              <li>{issue.message}</li>
            {/each}
          </ul>
        {/if}
        <div class="saver-row">
          <span class="small muted">
            Saving applies to runs started afterwards. Runs already in flight are unaffected.
          </span>
          <button class="primary" type="submit" disabled={save.pending > 0}>Save</button>
        </div>
      </div>
    {/if}
  </form>
{/if}

<style>
  .head {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 16px;
    flex-wrap: wrap;
    margin-bottom: 16px;
  }
  .head p { margin: 0 0 4px; }
  h1 { margin: 0 0 4px; font-size: 20px; }
  .notice { border-left: 3px solid var(--accent); margin-bottom: 16px; padding: 12px 16px; }
  .failure { border-left: 3px solid var(--bad); margin-bottom: 16px; padding: 12px 16px; }
  .layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 340px;
    gap: 16px;
    align-items: start;
  }
  .column, .side { display: flex; flex-direction: column; gap: 16px; }
  section { display: flex; flex-direction: column; gap: 10px; }
  section p { margin: 0; }
  label { display: flex; flex-direction: column; gap: 4px; }
  label.inline { flex-direction: row; align-items: flex-start; gap: 8px; }
  label.inline span { display: flex; flex-direction: column; }
  input, select, textarea {
    padding: 8px 10px;
    border: 1px solid var(--line);
    border-radius: var(--r-sm);
    font: inherit;
    width: 100%;
    box-sizing: border-box;
  }
  textarea {
    font: 13px/1.6 ui-monospace, monospace;
    resize: vertical;
  }
  .toggles { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
  .vars dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 4px 12px;
    margin: 8px 0 0;
    font-size: 12px;
  }
  .vars dt { white-space: nowrap; }
  .vars dd { margin: 0; }
  .vars summary { cursor: pointer; color: var(--ink-3); }
  .saver { margin-top: 16px; }
  .saver-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }
  button {
    padding: 8px 14px;
    border: 1px solid var(--line);
    border-radius: var(--r-sm);
    background: var(--surface);
    font: inherit;
    cursor: pointer;
    width: auto;
  }
  button.primary {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
    font-weight: 600;
  }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
  .errors { margin: 0 0 8px; padding-left: 18px; color: var(--bad); }
  @media (max-width: 1000px) {
    .layout { grid-template-columns: 1fr; }
  }
</style>
