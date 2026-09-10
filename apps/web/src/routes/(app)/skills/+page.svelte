<script lang="ts">
  import OwnerBadge from '$components/OwnerBadge.svelte';
  import { create, remove, save, skill, skills } from '$lib/remote/skills.remote';

  /**
   * Screen 11 — Skills. A searchable list with how much depends on each, and
   * an editor for the name, the description and the content.
   *
   * The description is a required field, not a nicety: it is the sentence an
   * agent reads to decide whether to reach for the skill (FR-043).
   */
  let { data }: { data: { user: { id: string } } } = $props();

  const list = $derived(skills());
  let openId = $state<string | null>(null);
  let filter = $state('');
  let notice = $state<string | null>(null);

  const open = $derived(openId ? skill(openId) : null);
  const shown = $derived(
    list.ready
      ? list.current.filter((item) =>
          filter
            ? `${item.name} ${item.description}`.toLowerCase().includes(filter.toLowerCase())
            : true
        )
      : []
  );
</script>

<header class="head">
  <p class="muted small">
    A skill is a named instruction document any number of agents can hold. Its description says
    when an agent should apply it.
  </p>
  <input placeholder="Search skills" bind:value={filter} aria-label="Search skills" />
</header>

{#if notice}<p class="card notice" role="status">{notice}</p>{/if}

{#if list.error}
  <p class="card failure" role="alert">{(list.error as Error).message}</p>
{:else if !list.ready}
  <p class="card">Loading skills…</p>
{:else}
  <div class="layout">
    <section class="card">
      <h2 class="section">Skills <span class="muted">{list.current.length}</span></h2>
      {#if shown.length === 0}
        <p class="muted small">
          {list.current.length === 0 ? 'None yet.' : 'None match.'} Write one below.
        </p>
      {:else}
        <ul>
          {#each shown as item (item.id)}
            <li class:on={openId === item.id}>
              <button type="button" onclick={() => (openId = openId === item.id ? null : item.id)}>
                <span class="row">
                  <strong>{item.name}</strong>
                  <OwnerBadge
                    isDefault={item.isDefault}
                    mine={item.ownerId === data.user.id}
                    mayChange={item.mayChange}
                  />
                </span>
                <span class="muted small">{item.description}</span>
                <!-- How much depends on it (FR-043a) -->
                <span class="muted small">
                  held by {item.agentCount} agent{item.agentCount === 1 ? '' : 's'} &middot;
                  {item.usage.pipelines} pipeline{item.usage.pipelines === 1 ? '' : 's'} &middot;
                  {item.usage.runs} run{item.usage.runs === 1 ? '' : 's'}
                </span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    <div class="side">
      {#if open?.ready}
        {@const s = open.current}
        <form {...save} class="card editor">
          <input type="hidden" name="skillId" value={s.id} />
          <h2 class="section">{s.mayChange ? 'Edit' : 'Read'} “{s.name}”</h2>
          <p class="muted small">
            Last changed {new Date(s.updatedAt).toLocaleString()}
            {#if s.updatedByName}by {s.updatedByName}{/if}.
            {#if s.agents.length > 0}
              Held by {s.agents.map((agent) => agent.name).join(', ')}.
            {:else}
              No agent holds it yet.
            {/if}
          </p>

          <label>
            <span class="small muted">Name</span>
            <input name="name" value={s.name} disabled={!s.mayChange} required />
          </label>
          <label>
            <span class="small muted">When should an agent apply this?</span>
            <input
              name="description"
              value={s.description}
              disabled={!s.mayChange}
              required
              placeholder="When writing anything a customer will read"
            />
          </label>
          <label>
            <span class="small muted">Content</span>
            <textarea name="content" rows="16" disabled={!s.mayChange}>{s.content}</textarea>
          </label>

          {#if save.fields.allIssues()?.length}
            <ul class="errors" role="alert">
              {#each save.fields.allIssues() ?? [] as issue (issue.message)}
                <li>{issue.message}</li>
              {/each}
            </ul>
          {/if}
          {#if save.result && 'problem' in save.result}
            <p class="errors" role="alert">{save.result.problem}</p>
          {:else if save.result && 'message' in save.result}
            <p class="ok small" role="status">{save.result.message}</p>
          {/if}

          {#if s.mayChange}
            <div class="row end">
              <button
                type="button"
                class="danger"
                onclick={async () => {
                  const result = await remove(s.id);
                  notice = ('problem' in result ? result.problem : result.message) ?? null;
                  openId = null;
                }}>Delete</button
              >
              <button class="primary" type="submit" disabled={save.pending > 0}>Save</button>
            </div>
          {/if}
        </form>
      {:else if openId}
        <p class="card">Loading…</p>
      {:else}
        <form {...create} class="card editor">
          <h2 class="section">New skill</h2>
          <label>
            <span class="small muted">Name</span>
            <input name="name" placeholder="house-style" required />
          </label>
          <label>
            <span class="small muted">When should an agent apply this?</span>
            <input
              name="description"
              placeholder="When writing anything a customer will read"
              required
            />
          </label>
          <label>
            <span class="small muted">Content</span>
            <textarea name="content" rows="10" placeholder="Write plainly. No exclamation marks."
            ></textarea>
          </label>
          {#if create.fields.allIssues()?.length}
            <ul class="errors" role="alert">
              {#each create.fields.allIssues() ?? [] as issue (issue.message)}
                <li>{issue.message}</li>
              {/each}
            </ul>
          {/if}
          {#if create.result && 'problem' in create.result}
            <p class="errors" role="alert">{create.result.problem}</p>
          {/if}
          <div class="row end">
            <button class="primary" type="submit" disabled={create.pending > 0}>Create</button>
          </div>
        </form>
      {/if}
    </div>
  </div>
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
  .head p { margin: 0; max-width: 60ch; }
  .notice { border-left: 3px solid var(--accent); margin-bottom: 16px; padding: 12px 16px; }
  .failure { border-left: 3px solid var(--danger); }
  .layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 420px;
    gap: 16px;
    align-items: start;
  }
  ul { list-style: none; margin: 0; padding: 0; }
  li { border-top: 1px solid var(--border); }
  li:first-child { border-top: 0; }
  li button {
    display: flex;
    flex-direction: column;
    gap: 2px;
    align-items: flex-start;
    width: 100%;
    padding: 10px 4px;
    border: 0;
    background: none;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  li.on button { background: #f6f8ff; }
  .row { display: flex; gap: 8px; align-items: center; }
  .row.end { justify-content: flex-end; }
  .editor { display: flex; flex-direction: column; gap: 10px; }
  .editor p { margin: 0; }
  label { display: flex; flex-direction: column; gap: 4px; }
  input, textarea {
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    font: inherit;
    width: 100%;
    box-sizing: border-box;
  }
  textarea { font: 13px/1.6 ui-monospace, monospace; resize: vertical; }
  button {
    padding: 8px 14px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: var(--surface);
    font: inherit;
    cursor: pointer;
  }
  button.primary {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
    font-weight: 600;
  }
  button.danger { color: var(--danger); border-color: #f3c7c4; }
  .errors { margin: 0; padding-left: 18px; color: var(--danger); }
  .ok { color: var(--success); }
  @media (max-width: 1000px) {
    .layout { grid-template-columns: 1fr; }
  }
</style>
