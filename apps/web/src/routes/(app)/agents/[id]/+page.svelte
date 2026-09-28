<script lang="ts">
  import { page } from '$app/state';
  import Icon from '$components/Icon.svelte';
  import { agentDescription, agentName } from '$lib/default-names';
  import { modelName } from '$lib/format';
  import { m } from '$lib/i18n';
  import { agent, options, reset, save } from '$lib/remote/agents.remote';
  import { skills } from '$lib/remote/skills.remote';

  /**
   * Screen 10 — Agent Editor, built to `design.pen`: the engine's orb and
   * the name in the head, the system prompt on the dark code surface filling
   * the left tile, and a 420px column of tiles carrying the model and
   * limits, the tool toggles and the attached skills as chips
   * (specs/004-bento-redesign FR-023).
   *
   * Each is configured independently (FR-036); saving writes them together,
   * because a half-saved agent is worse than either. For an agent on the
   * design service, the model list is that service's own and the tool
   * permissions are omitted entirely — they do not apply (FR-036a).
   *
   * The artboard's "Test in sandbox" button is deliberately absent: nothing
   * behind it exists, and a button that does nothing is worse than no button.
   */
  const id = $derived(page.params.id as string);
  const detail = $derived(agent(id));
  const vocabulary = $derived(options());
  const skillList = $derived(skills());

  let engine = $state<'claude_cli' | 'design_cli' | null>(null);
  let model = $state<string | null>(null);
  let tools = $state<string[] | null>(null);
  let attached = $state<string[] | null>(null);
  let prompt = $state('');
  // The name and description as shown: a shipped agent's in the catalogue's
  // words. Left as shown, the stored text is what saves, so a translation
  // never overwrites what shipped (FR-028) and the way back still matches it.
  let nameText = $state('');
  let descriptionText = $state('');
  let loadedFor = $state<string | null>(null);
  let notice = $state<string | null>(null);
  let adding = $state(false);

  $effect(() => {
    if (!detail.ready) return;
    // Seeded once per agent, then owned by this screen, or a keystroke would
    // be undone by the refresh it caused.
    if (loadedFor !== detail.current.id) {
      engine = detail.current.engine;
      model = detail.current.model;
      tools = [...detail.current.allowedTools];
      attached = detail.current.skills.map((skill) => skill.id);
      prompt = detail.current.systemPrompt;
      nameText = agentName(detail.current.name);
      descriptionText =
        agentDescription(detail.current.name, detail.current.description) ?? '';
      loadedFor = detail.current.id;
    }
  });

  const models = $derived(
    vocabulary.ready && engine ? (vocabulary.current.models[engine] ?? []) : [],
  );
  const lines = $derived(prompt.split('\n'));
  const held = $derived(
    skillList.ready ? skillList.current.filter((s) => (attached ?? []).includes(s.id)) : [],
  );
  const unheld = $derived(
    skillList.ready ? skillList.current.filter((s) => !(attached ?? []).includes(s.id)) : [],
  );

  /**
   * Where the runner writes the prompt for the CLI to read: the agent's
   * stored name, lower-cased and hyphenated, as `agentSlug` in the runner's
   * container config makes it.
   */
  const promptFile = (name: string) =>
    `.claude/agents/${name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')}.md`;

  const toolName = (name: string) => m.toolName[name as keyof typeof m.toolName] ?? name;

  /** A line that names a variable is the one worth picking out. */
  const isVariable = (line: string) => /\{\{[\w.]+\}\}/.test(line);

  function toggleTool(name: string, on: boolean) {
    const current = tools ?? [];
    tools = on ? [...current, name] : current.filter((tool) => tool !== name);
  }

  function toggleSkill(skillId: string, on: boolean) {
    const current = attached ?? [];
    attached = on ? [...current, skillId] : current.filter((one) => one !== skillId);
  }
</script>

<svelte:window onclick={() => (adding = false)} />

{#if detail.error}
  <p class="tile tile--danger failure" role="alert">{(detail.error as Error).message}</p>
{:else if !detail.ready || engine === null}
  <p class="tile">{m.agentEditor.loading}</p>
{:else}
  {@const a = detail.current}
  {@const design = engine === 'design_cli'}

  <form {...save} class="screen">
    <input type="hidden" name="agentId" value={a.id} />
    <input type="hidden" name="allowedTools" value={(tools ?? []).join(',')} />
    <input type="hidden" name="skillIds" value={(attached ?? []).join(',')} />
    <input type="hidden" name="name" value={nameText === agentName(a.name) ? a.name : nameText} />
    <input
      type="hidden"
      name="description"
      value={descriptionText === (agentDescription(a.name, a.description) ?? '')
        ? (a.description ?? '')
        : descriptionText}
    />

    <header class="head">
      <span class="orb big" class:orb--pen={design} aria-hidden="true">
        <Icon name={a.icon ?? (design ? 'pen-tool' : 'bot')} size={24} />
      </span>
      <div class="tx">
        <div class="row">
          <!-- The name is the heading and the field at once, as the artboard has it. -->
          <input
            class="name"
            aria-label={m.agentEditor.name}
            bind:value={nameText}
            required
            readonly={!a.mayChange}
          />
          <span class="kind" class:pen={design}>
            {a.isDefault
              ? m.agentEditor.default
              : (a.ownerName ?? m.agentEditor.custom)}{a.modifiedFromShipped
              ? m.agentEditor.edited
              : ''}
          </span>
          <span class="kind quiet">{m.agentEditor.usage(a.usage.pipelines, a.usage.runs)}</span>
        </div>
        <textarea
          class="what"
          rows="1"
          aria-label={m.agentEditor.whatItIsFor}
          bind:value={descriptionText}
          placeholder={m.agentEditor.whatItIsFor}
          readonly={!a.mayChange}
        ></textarea>
        <p class="s">
          {m.agentEditor.changesApplyNote}
          {#if !a.mayChange}
            {m.agentEditor.changingIsFor(
              a.isDefault ? m.agentEditor.anAdministrator : (a.ownerName ?? m.agentEditor.itsOwner),
            )}
          {/if}
        </p>
      </div>

      <div class="btns">
        {#if a.mayChange && a.resettable}
          <!-- Back to what shipped (FR-040) -->
          <button
            type="button"
            class="btn btn--secondary"
            disabled={!a.modifiedFromShipped}
            title={a.modifiedFromShipped ? m.agentEditor.resetTitle : m.agentEditor.alreadyShipped}
            onclick={async () => {
              const result = await reset(a.id);
              notice = ('problem' in result ? result.problem : result.message) ?? null;
              loadedFor = null;
            }}
          >
            <Icon name="rotate-ccw" size={14} />{m.agentEditor.resetToDefault}
          </button>
        {/if}
        {#if a.mayChange}
          <button class="btn" type="submit" disabled={save.pending > 0}>
            <Icon name="save" size={14} />{save.pending > 0
              ? m.agentEditor.saving
              : m.agentEditor.saveChanges}
          </button>
        {/if}
      </div>
    </header>

    {#if notice}<p class="tile banner" role="status">{notice}</p>{/if}
    {#if save.fields.allIssues()?.length}
      <ul class="tile tile--danger banner" role="alert">
        {#each save.fields.allIssues() ?? [] as issue (issue.message)}
          <li>{issue.message}</li>
        {/each}
      </ul>
    {:else if save.result && 'problem' in save.result && save.result.problem}
      <p class="tile tile--danger banner" role="alert">{save.result.problem}</p>
    {:else if save.result && 'message' in save.result}
      <p class="tile tile--done banner" role="status">{save.result.message}</p>
    {/if}

    <div class="wrap">
      <section class="tile prompt">
        <header class="ph">
          <div class="t">
            <h2>{m.agentEditor.systemPrompt}</h2>
            <p>
              {design ? m.agentEditor.designPromptNote : m.agentEditor.systemPromptNote(promptFile(a.name))}
            </p>
          </div>
          {#if vocabulary.ready}
            <div class="vars">
              {#each vocabulary.current.variables.slice(0, 3) as variable (variable.name)}
                <span class="var" title={variable.what}>&#123;&#123;{variable.name}&#125;&#125;</span>
              {/each}
              <details class="more">
                <summary>{m.agentEditor.allOf(vocabulary.current.variables.length)}</summary>
                <dl>
                  {#each vocabulary.current.variables as variable (variable.name)}
                    <dt><code>&#123;&#123;{variable.name}&#125;&#125;</code></dt>
                    <dd>{variable.what}</dd>
                  {/each}
                </dl>
              </details>
            </div>
          {/if}
        </header>

        <!-- The dark code surface: a gutter, a highlighted copy of the text,
             and the real field laid exactly over it. -->
        <div class="code">
          <div class="gutter" aria-hidden="true">
            {#each lines as _line, i (i)}<span>{i + 1}</span>{/each}
          </div>
          <div class="pane">
            <pre aria-hidden="true">{#each lines as line, i (i)}<span
                  class:var={isVariable(line)}>{line}</span
                >{#if i < lines.length - 1}{'\n'}{/if}{/each}</pre>
            <textarea
              name="systemPrompt"
              data-overlay
              aria-label={m.agentEditor.systemPrompt}
              spellcheck="false"
              readonly={!a.mayChange}
              bind:value={prompt}
            ></textarea>
          </div>
        </div>
      </section>

      <aside class="side">
        <section class="tile">
          <h2>{m.agentEditor.modelAndLimits}</h2>

          <label class="f">
            <span>{m.agentEditor.engine}</span>
            <div class="select">
              <Icon name={design ? 'pen-tool' : 'bot'} size={14} />
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
                <option value="claude_cli">{m.agentEditor.codingAgent}</option>
                <option value="design_cli">{m.agentEditor.designService}</option>
              </select>
              <Icon name="chevron-down" size={14} />
            </div>
          </label>

          <label class="f">
            <span>{m.agentEditor.model}</span>
            <div class="select">
              <Icon name="sparkles" size={14} />
              <select name="model" disabled={!a.mayChange} value={model ?? models[0] ?? ''}>
                {#each models as option (option)}
                  <option value={option}>{m.agentEditor.modelOption(modelName(option), option)}</option>
                {/each}
              </select>
              <Icon name="chevron-down" size={14} />
            </div>
          </label>

          <div class="three">
            <label class="f">
              <span>{m.agentEditor.maxCost}</span>
              <input
                name="maxCostUsd"
                readonly={!a.mayChange}
                placeholder={m.agentEditor.runsLimit}
                value={a.maxCostUsd ?? ''}
              />
            </label>
            <label class="f">
              <span>{m.agentEditor.maxTime}</span>
              <input
                name="maxMinutes"
                type="number"
                min="1"
                readonly={!a.mayChange}
                placeholder={m.agentEditor.runsLimit}
                value={a.maxMinutes ?? ''}
              />
            </label>
            <label class="f">
              <span>{m.agentEditor.maxTurns}</span>
              <input
                name="maxTurns"
                type="number"
                min="1"
                readonly={!a.mayChange}
                placeholder={m.agentEditor.noLimit}
                value={a.maxTurns ?? ''}
              />
            </label>
          </div>
          <p class="quiet">{m.agentEditor.limitsNote}</p>
        </section>

        {#if !design}
          <!-- Withholding a tool makes it unreachable, not discouraged (FR-039) -->
          <section class="tile tools">
            <div class="ch">
              <h2>{m.agentEditor.allowedTools}</h2>
              <p class="quiet">{m.agentEditor.allowedToolsNote}</p>
            </div>
            {#if vocabulary.ready}
              {#each vocabulary.current.tools as tool (tool.name)}
                <label class="tool">
                  <span class="tx">
                    <span class="n">{toolName(tool.name)}</span>
                    <span class="d">{tool.what}</span>
                  </span>
                  <input
                    type="checkbox"
                    class="switch"
                    aria-label={m.agentEditor.toolLabel(toolName(tool.name), tool.what)}
                    disabled={!a.mayChange}
                    checked={(tools ?? []).includes(tool.name)}
                    onchange={(event) => toggleTool(tool.name, event.currentTarget.checked)}
                  />
                </label>
              {/each}
            {/if}
          </section>
        {:else}
          <section class="tile">
            <h2>{m.agentEditor.allowedTools}</h2>
            <p class="quiet">{m.agentEditor.noToolsForDesign}</p>
          </section>
        {/if}

        <section class="tile">
          <div class="ch row-head">
            <h2>{m.agentEditor.skillsAttached}</h2>
            <a href="/skills">{m.agentEditor.manageSkills}</a>
          </div>
          <div class="chips">
            {#each held as skill (skill.id)}
              <span class="chip-skill">
                <Icon name="sparkles" size={12} />
                <span>{skill.name}</span>
                {#if a.mayChange}
                  <button
                    type="button"
                    aria-label={m.agentEditor.removeSkill(skill.name)}
                    onclick={() => toggleSkill(skill.id, false)}
                  >
                    <Icon name="x" size={12} />
                  </button>
                {/if}
              </span>
            {/each}

            {#if a.mayChange}
              <span class="add">
                <button
                  type="button"
                  aria-expanded={adding}
                  onclick={(event) => {
                    event.stopPropagation();
                    adding = !adding;
                  }}
                >
                  <Icon name="plus" size={12} />
                  <span>{m.agentEditor.add}</span>
                </button>
                {#if adding}
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <!-- svelte-ignore a11y_click_events_have_key_events -->
                  <span class="menu" onclick={(event) => event.stopPropagation()}>
                    {#if unheld.length === 0}
                      <span class="none">
                        {skillList.ready && skillList.current.length === 0
                          ? m.agentEditor.noSkillsYet
                          : m.agentEditor.holdsEverySkill}
                      </span>
                    {:else}
                      {#each unheld as available (available.id)}
                        <button
                          type="button"
                          onclick={() => {
                            toggleSkill(available.id, true);
                            adding = false;
                          }}
                        >
                          <span class="n">{available.name}</span>
                          <span class="d">{available.description}</span>
                        </button>
                      {/each}
                    {/if}
                  </span>
                {/if}
              </span>
            {/if}

            {#if held.length === 0 && !a.mayChange}
              <span class="quiet">{m.agentEditor.none}</span>
            {/if}
          </div>
        </section>
      </aside>
    </div>
  </form>
{/if}

<style>
  .screen {
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  /* ---- head ---- */
  .head {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 4px 4px 0;
  }
  .orb.big {
    width: 56px;
    height: 56px;
  }
  .head .tx {
    display: flex;
    flex-direction: column;
    gap: 4px;
    flex: 1;
    min-width: 0;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }
  .name,
  .what {
    border: 1px solid transparent;
    border-radius: 10px;
    background: none;
    font: inherit;
    color: var(--text);
    padding: 2px 6px;
    margin-left: -6px;
    width: 100%;
  }
  .name {
    width: auto;
    max-width: 22ch;
    font-family: var(--font-head);
    font-size: 28px;
    font-weight: 600;
    letter-spacing: -0.5px;
  }
  .what {
    max-width: 90ch;
    resize: none;
    field-sizing: content;
    line-height: 1.45;
    font-size: var(--type-body);
    color: var(--text-2);
  }
  .name:not(:read-only):hover,
  .what:not(:read-only):hover {
    border-color: var(--border);
  }
  .name:focus,
  .what:focus {
    border-color: var(--accent);
    outline: none;
  }
  .s {
    margin: 0;
    font-size: var(--type-body);
    color: var(--text-2);
  }
  .btns {
    display: flex;
    align-items: center;
    gap: 10px;
    flex: none;
  }
  .kind {
    flex: none;
    padding: 4px 10px;
    border-radius: var(--r-pill);
    font-size: var(--type-caption);
    font-weight: 700;
    color: var(--accent-text);
    background: var(--accent-soft);
  }
  .kind.pen {
    color: var(--pen-text);
    background: #e3ecfb;
  }
  .kind.quiet {
    font-weight: 600;
    color: var(--text-2);
    background: var(--surface-2);
  }

  /* ---- layout ---- */
  .wrap {
    display: flex;
    align-items: stretch;
    gap: 20px;
  }
  .tile {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 22px;
  }
  .prompt {
    flex: 1;
    min-width: 0;
    gap: 16px;
  }
  .side {
    display: flex;
    flex-direction: column;
    gap: 20px;
    width: 420px;
    flex: none;
  }
  h2 {
    margin: 0;
    font-family: var(--font-head);
    font-size: 17px;
    font-weight: 600;
    color: var(--text);
  }
  .prompt h2 {
    font-size: 18px;
  }
  .quiet {
    margin: 0;
    font-size: var(--type-caption);
    color: var(--text-2);
  }
  .ch {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .row-head {
    flex-direction: row;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
  }
  .ch a {
    font-size: var(--type-caption);
    font-weight: 600;
    color: var(--accent-text);
    text-decoration: none;
  }
  .ch a:hover {
    text-decoration: underline;
  }

  /* ---- the prompt ---- */
  .ph {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
  }
  .ph .t {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }
  .ph p {
    margin: 0;
    font-size: var(--type-caption);
    color: var(--text-2);
  }
  .vars {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
    justify-content: flex-end;
    flex: none;
    max-width: 50%;
  }
  .var,
  .more summary {
    padding: 4px 9px;
    border-radius: var(--r-pill);
    font-family: var(--font-mono);
    font-size: var(--type-caption);
    font-weight: 600;
    color: var(--pen-text);
    background: #e3ecfb;
  }
  .more {
    position: relative;
  }
  .more summary {
    list-style: none;
    font-family: var(--font);
    cursor: pointer;
  }
  .more[open] dl {
    position: absolute;
    top: 30px;
    right: 0;
    z-index: 5;
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 6px 12px;
    width: 400px;
    margin: 0;
    padding: 14px 16px;
    border-radius: 16px;
    background: var(--surface);
    box-shadow: 0 14px 36px var(--shadow-depth);
    font-size: var(--type-caption);
  }
  .more dt code {
    font-size: var(--type-caption);
  }
  .more dd {
    margin: 0;
    color: var(--text-2);
  }

  .code {
    flex: 1;
    min-height: 420px;
    display: flex;
    padding: 18px 0;
    border-radius: 18px;
    background: linear-gradient(180deg, var(--code-bg), #2a2521);
    overflow: auto;
    font-family: var(--font-mono);
    font-size: 13px;
    line-height: 21px;
  }
  .gutter {
    position: sticky;
    left: 0;
    display: flex;
    flex-direction: column;
    padding: 0 14px 0 18px;
    background: var(--code-bg);
    color: #9c9286;
    text-align: right;
    user-select: none;
  }
  .gutter span {
    min-width: 2ch;
  }
  .pane {
    position: relative;
    min-width: calc(100% - 56px);
    width: max-content;
    padding-right: 18px;
  }
  .pane pre {
    margin: 0;
    font: inherit;
    white-space: pre;
    color: #f2eee8;
  }
  .pane pre .var {
    padding: 0;
    border-radius: 0;
    background: none;
    font: inherit;
    color: #ffc9a3;
  }
  .pane textarea {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    margin: 0;
    padding: 0 18px 0 0;
    border: 0;
    background: none;
    font: inherit;
    white-space: pre;
    overflow: hidden;
    resize: none;
    color: transparent;
    caret-color: #f2eee8;
  }
  .pane textarea:focus {
    outline: none;
  }
  .pane textarea::selection {
    background: #f26b1d55;
  }

  /* ---- fields ---- */
  .f {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }
  .f > span {
    font-size: var(--type-caption);
    font-weight: 600;
    color: var(--text-2);
  }
  .three {
    display: flex;
    gap: 10px;
  }
  .three .f {
    flex: 1;
  }
  input,
  .select {
    width: 100%;
    padding: 10px 12px;
    border: 1px solid transparent;
    border-radius: 12px;
    background: #f4f2ef;
    font: inherit;
    font-size: var(--type-body);
    font-weight: 600;
    color: var(--text);
  }
  input::placeholder {
    font-weight: 400;
    color: var(--text-3);
  }
  .three input {
    padding: 10px;
  }
  input:focus,
  .select:focus-within {
    border-color: var(--accent);
    outline: none;
  }
  .select {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 12px;
  }
  .select :global(svg:first-child) {
    color: var(--accent);
    flex: none;
  }
  .select :global(svg:last-child) {
    color: var(--text-3);
    flex: none;
  }
  .select select {
    flex: 1;
    min-width: 0;
    padding: 10px 0;
    border: 0;
    background: none;
    font: inherit;
    color: var(--text);
    appearance: none;
  }
  .select select:focus {
    outline: none;
  }
  input:read-only {
    color: var(--text-2);
  }
  .head input:read-only {
    color: var(--text);
    background: none;
  }
  .head textarea.what {
    background: none;
  }
  .head .what:read-only {
    color: var(--text-2);
  }

  /* ---- tool toggles ---- */
  .tools {
    gap: 4px;
  }
  .tools .ch {
    padding-bottom: 8px;
  }
  .tool {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 8px 0;
    cursor: pointer;
  }
  .tool .tx {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }
  .tool .n {
    font-size: var(--type-body);
    font-weight: 600;
    color: var(--text);
  }
  .tool .d {
    font-size: var(--type-caption);
    color: var(--text-2);
  }
  /* The artboard's 40×24 switch, which is a checkbox underneath. */
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
    transition: background 120ms ease;
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
  .switch:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
  .switch:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  /* ---- skills ---- */
  .chips {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .chip-skill,
  .add > button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    border-radius: var(--r-pill);
    font-size: var(--type-caption);
    font-weight: 600;
  }
  .chip-skill {
    font-family: var(--font-mono);
    color: var(--pen-text);
    background: #e3ecfb;
  }
  .chip-skill :global(svg) {
    color: var(--pen-to);
  }
  .chip-skill button {
    display: grid;
    place-items: center;
    padding: 0;
    border: 0;
    background: none;
    color: var(--pen-to);
    cursor: pointer;
  }
  .add {
    position: relative;
  }
  .add > button {
    border: 0;
    background: #f4f2ef;
    font-family: inherit;
    color: var(--text-2);
    cursor: pointer;
  }
  .add > button:hover {
    color: var(--accent-text);
  }
  .menu {
    position: absolute;
    top: 34px;
    left: 0;
    z-index: 6;
    display: flex;
    flex-direction: column;
    gap: 2px;
    width: 300px;
    padding: 6px;
    border-radius: 16px;
    background: var(--surface);
    box-shadow: 0 14px 36px var(--shadow-depth);
  }
  .menu button {
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: 8px 10px;
    border: 0;
    border-radius: 10px;
    background: none;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .menu button:hover {
    background: var(--surface-2);
  }
  .menu .n {
    font-size: var(--type-body);
    font-weight: 600;
    color: var(--text);
  }
  .menu .d,
  .menu .none {
    font-size: var(--type-caption);
    color: var(--text-2);
  }
  .menu .none {
    padding: 8px 10px;
  }

  /* ---- banners ---- */
  .banner {
    margin: 0;
    padding: 14px 18px;
    font-size: var(--type-body);
    color: var(--text);
  }
  ul.banner {
    padding-left: 36px;
  }
  .failure {
    color: var(--danger-text);
  }

  @media (max-width: 1200px) {
    .wrap {
      flex-direction: column;
    }
    .side {
      width: auto;
    }
    .head {
      flex-wrap: wrap;
    }
  }
</style>
