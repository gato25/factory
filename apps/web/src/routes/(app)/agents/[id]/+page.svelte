<script lang="ts">
  import { page } from '$app/state';
  import Icon from '$components/Icon.svelte';
  import { agent, options, reset, save } from '$lib/remote/agents.remote';
  import { skills } from '$lib/remote/skills.remote';

  /**
   * Screen 10 — Agent Editor, built to `design.pen`: a 48px chip and the
   * name in the head, the system prompt on the design's dark editor filling
   * the left, and a 400px column carrying the model and limits, the tool
   * toggles and the attached skills as chips.
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
  <p class="card failure" role="alert">{(detail.error as Error).message}</p>
{:else if !detail.ready || engine === null}
  <p class="card">Агентыг ачааллаж байна…</p>
{:else}
  {@const a = detail.current}

  <form {...save} class="screen">
    <input type="hidden" name="agentId" value={a.id} />
    <input type="hidden" name="allowedTools" value={(tools ?? []).join(',')} />
    <input type="hidden" name="skillIds" value={(attached ?? []).join(',')} />

    <header class="head">
      <span class="chip"><Icon name={a.icon ?? 'bot'} size={24} /></span>
      <div class="tx">
        <div class="row">
          <input
            class="name"
            name="name"
            aria-label="Нэр"
            value={a.name}
            required
            readonly={!a.mayChange}
          />
          <span class="badge">
            <span class="dot"></span>
            {a.isDefault ? 'Үндсэн' : (a.ownerName ?? 'Захиалгат')}{a.modifiedFromShipped
              ? ' · засварласан'
              : ''}
          </span>
          <span class="badge quiet">
            <span class="dot"></span>
            {a.usage.pipelines} дамжлагад · {a.usage.runs} ажиллагаа
          </span>
        </div>
        <input
          class="what"
          name="description"
          aria-label="Юунд зориулсан бэ"
          value={a.description ?? ''}
          placeholder="Юунд зориулсан бэ"
          readonly={!a.mayChange}
        />
        <p class="s">
          Өөрчлөлт зөвхөн шинэ ажиллагаанд үйлчилнэ. Ажиллаж буй даалгаврууд эхэлсэн хувилбараа
          хадгална.
          {#if !a.mayChange}
            Үүнийг {a.isDefault ? 'администратор' : (a.ownerName ?? 'эзэмшигч нь')} өөрчилнө.
          {/if}
        </p>
      </div>

      <div class="btns">
        {#if a.mayChange && a.resettable}
          <!-- Back to what shipped (FR-040) -->
          <button
            type="button"
            class="secondary"
            disabled={!a.modifiedFromShipped}
            title={a.modifiedFromShipped
              ? 'Бүх өөрчлөлтийг хаяж, анхны төлөвт нь буцаана'
              : 'Энэ агент аль хэдийн анхны төлөвтэйгээ таарч байна'}
            onclick={async () => {
              const result = await reset(a.id);
              notice = ('problem' in result ? result.problem : result.message) ?? null;
              loadedFor = null;
            }}
          >
            <Icon name="rotate-ccw" size={16} />
            <span>Анхны төлөвт буцаах</span>
          </button>
        {/if}
        {#if a.mayChange}
          <button class="primary" type="submit" disabled={save.pending > 0}>
            <Icon name="save" size={16} />
            <span>{save.pending > 0 ? 'Хадгалж байна…' : 'Өөрчлөлт хадгалах'}</span>
          </button>
        {/if}
      </div>
    </header>

    {#if notice}<p class="banner" role="status">{notice}</p>{/if}
    {#if save.fields.allIssues()?.length}
      <ul class="banner bad" role="alert">
        {#each save.fields.allIssues() ?? [] as issue (issue.message)}
          <li>{issue.message}</li>
        {/each}
      </ul>
    {:else if save.result && 'problem' in save.result && save.result.problem}
      <p class="banner bad" role="alert">{save.result.problem}</p>
    {:else if save.result && 'message' in save.result}
      <p class="banner good" role="status">{save.result.message}</p>
    {/if}

    <div class="wrap">
      <section class="card prompt">
        <header class="ph">
          <div class="t">
            <h2>Системийн заавар</h2>
            <p>
              Хөдөлгүүр ажиллахын өмнө өгөгдөнө. Даалгаврын өгөгдлийг
              &#123;&#123;variables&#125;&#125;-аар бичнэ.
            </p>
          </div>
          {#if vocabulary.ready}
            <div class="vars">
              {#each vocabulary.current.variables.slice(0, 3) as variable (variable.name)}
                <span class="var" title={variable.what}>
                  &#123;&#123;{variable.name}&#125;&#125;
                </span>
              {/each}
              <details class="more">
                <summary>бүгд {vocabulary.current.variables.length}</summary>
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

        <!-- The design's dark pane: a gutter, a highlighted copy of the text,
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
              aria-label="Системийн заавар"
              spellcheck="false"
              readonly={!a.mayChange}
              bind:value={prompt}
            ></textarea>
          </div>
        </div>
      </section>

      <aside class="side">
        <section class="card">
          <h2>Загвар ба хязгаар</h2>

          <label class="f">
            <span>Хөдөлгүүр</span>
            <div class="select">
              <Icon name="bot" size={16} />
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
                <option value="claude_cli">Кодын агент</option>
                <option value="design_cli">Дизайны үйлчилгээ</option>
              </select>
              <Icon name="chevron-down" size={16} />
            </div>
          </label>

          <label class="f">
            <span>Загвар</span>
            <div class="select">
              <Icon name="code" size={16} />
              <select name="model" disabled={!a.mayChange} value={model ?? models[0] ?? ''}>
                {#each models as option (option)}
                  <option value={option}>{option}</option>
                {/each}
              </select>
              <Icon name="chevron-down" size={16} />
            </div>
          </label>

          <div class="three">
            <label class="f">
              <span>Нэг ажиллагааны дээд зардал</span>
              <input
                name="maxCostUsd"
                readonly={!a.mayChange}
                placeholder="ажиллаганыхаар"
                value={a.maxCostUsd ?? ''}
              />
            </label>
            <label class="f">
              <span>Дээд хугацаа</span>
              <input
                name="maxMinutes"
                type="number"
                min="1"
                readonly={!a.mayChange}
                placeholder="ажиллаганыхаар"
                value={a.maxMinutes ?? ''}
              />
            </label>
            <label class="f">
              <span>Дээд эргэлт</span>
              <input
                name="maxTurns"
                type="number"
                min="1"
                readonly={!a.mayChange}
                placeholder="байхгүй"
                value={a.maxTurns ?? ''}
              />
            </label>
          </div>
          <p class="quiet">
            Тус бүр нь ажиллагааны зөвшөөрснөөр хязгаарлагдах тул эндэх хязгаар даалгаврын
            зарцуулж болох хэмжээг нэмэгдүүлж чадахгүй. Ажиллагааныхыг ашиглах бол хоосон
            үлдээнэ үү.
          </p>
        </section>

        {#if engine === 'claude_cli'}
          <!-- Withholding a tool makes it unreachable, not discouraged (FR-039) -->
          <section class="card">
            <div class="ch">
              <h2>Зөвшөөрөгдсөн хэрэгсэл</h2>
              <p class="quiet">CLI-д --allowedTools болгон дамжина</p>
            </div>
            {#if vocabulary.ready}
              {#each vocabulary.current.tools as tool (tool.name)}
                <label class="tool">
                  <span class="tx">
                    <span class="n">{tool.label}</span>
                    <span class="d">{tool.what}</span>
                  </span>
                  <input
                    type="checkbox"
                    class="switch"
                    aria-label="{tool.label} — {tool.what}"
                    disabled={!a.mayChange}
                    checked={(tools ?? []).includes(tool.name)}
                    onchange={(event) => toggleTool(tool.name, event.currentTarget.checked)}
                  />
                </label>
              {/each}
            {/if}
          </section>
        {:else}
          <section class="card">
            <h2>Зөвшөөрөгдсөн хэрэгсэл</h2>
            <p class="quiet">
              Хэрэгслийн эрх дизайны үйлчилгээнд хамаарахгүй тул тохируулах зүйл алга.
            </p>
          </section>
        {/if}

        <section class="card">
          <div class="ch">
            <h2>Хавсаргасан ур чадвар</h2>
            <a href="/skills">Ур чадвар удирдах →</a>
          </div>
          <div class="chips">
            {#each held as skill (skill.id)}
              <span class="chip-skill">
                <Icon name="sparkles" size={12} />
                <span>{skill.name}</span>
                {#if a.mayChange}
                  <button
                    type="button"
                    aria-label="{skill.name}-ийг хасах"
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
                  <span>Нэмэх</span>
                </button>
                {#if adding}
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <!-- svelte-ignore a11y_click_events_have_key_events -->
                  <span class="menu" onclick={(event) => event.stopPropagation()}>
                    {#if unheld.length === 0}
                      <span class="none">
                        {skillList.ready && skillList.current.length === 0
                          ? 'Хараахан ур чадвар алга — эхлээд нэгийг бичнэ үү.'
                          : 'Бүх ур чадварыг аль хэдийн хавсаргасан байна.'}
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
              <span class="quiet">Байхгүй.</span>
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
    gap: 16px;
  }

  /* ---- head ---- */
  .head {
    display: flex;
    align-items: flex-start;
    gap: 16px;
  }
  .chip {
    display: grid;
    place-items: center;
    width: 48px;
    height: 48px;
    border-radius: var(--r-md);
    background: var(--accent-soft);
    color: var(--accent-text);
    flex: none;
  }
  .head .tx {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1;
    min-width: 0;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }
  /* The name is the heading and the field at once, as the artboard has it. */
  .name,
  .what {
    border: 1px solid transparent;
    border-radius: var(--r-sm);
    background: none;
    font: inherit;
    color: var(--text);
    padding: 2px 6px;
    margin-left: -6px;
    width: 100%;
  }
  .name {
    font-family: var(--font-head);
    font-size: 22px;
    font-weight: 700;
    width: auto;
    max-width: 22ch;
  }
  .what {
    font-size: 13px;
    color: var(--text-2);
    max-width: 60ch;
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
    margin: 2px 0 0;
    font-size: 12px;
    color: var(--text-3);
  }
  .btns {
    display: flex;
    align-items: center;
    gap: 10px;
    flex: none;
  }

  .badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    border-radius: 999px;
    background: var(--surface-2);
    font-size: 12px;
    color: var(--text-2);
    flex: none;
  }
  .badge.quiet {
    color: var(--text-3);
  }
  .dot {
    width: 6px;
    height: 6px;
    border-radius: 999px;
    background: currentcolor;
    flex: none;
  }

  /* ---- layout ---- */
  .wrap {
    display: flex;
    align-items: stretch;
    gap: 24px;
  }
  .card {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 16px;
    background: var(--surface);
    border: 1px solid var(--card-border);
    border-radius: var(--r-lg);
    box-shadow: 0 1px 2px #0f172a0a;
  }
  .prompt {
    flex: 1;
    min-width: 0;
    padding: 0;
    gap: 0;
    overflow: hidden;
  }
  .side {
    display: flex;
    flex-direction: column;
    gap: 16px;
    width: 400px;
    flex: none;
  }
  h2 {
    margin: 0;
    font-family: var(--font-head);
    font-size: 15px;
    font-weight: 600;
    color: var(--text);
  }
  .quiet {
    margin: 0;
    font-size: 12px;
    color: var(--text-2);
  }
  .ch {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
  }
  .ch a {
    font-size: 12px;
    font-weight: 500;
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
    padding: 16px 20px;
    border-bottom: 1px solid var(--border);
  }
  .ph .t {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }
  .ph p {
    margin: 0;
    font-size: 12px;
    color: var(--text-2);
  }
  .vars {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
    flex: none;
  }
  .var {
    padding: 3px 8px;
    border-radius: 6px;
    background: var(--surface-2);
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-2);
  }
  .more {
    position: relative;
  }
  .more summary {
    list-style: none;
    padding: 3px 8px;
    border-radius: 6px;
    background: var(--surface-2);
    font-size: 11px;
    color: var(--accent-text);
    cursor: pointer;
  }
  .more[open] dl {
    position: absolute;
    top: 26px;
    right: 0;
    z-index: 5;
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 4px 12px;
    width: 380px;
    margin: 0;
    padding: 12px 14px;
    background: var(--surface);
    border: 1px solid var(--card-border);
    border-radius: var(--r-md);
    box-shadow: 0 8px 24px #0f172a1f;
    font-size: 12px;
  }
  .more dt code {
    font-size: 11px;
  }
  .more dd {
    margin: 0;
    color: var(--text-2);
  }

  .code {
    flex: 1;
    min-height: 360px;
    display: flex;
    padding: 14px 0;
    background: var(--code-bg);
    overflow: auto;
    font-family: var(--font-mono);
    font-size: 12px;
    line-height: 20px;
  }
  .gutter {
    position: sticky;
    left: 0;
    display: flex;
    flex-direction: column;
    padding: 0 16px 0 20px;
    background: var(--code-bg);
    color: var(--code-line);
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
    padding-right: 20px;
  }
  .pane pre {
    margin: 0;
    font: inherit;
    white-space: pre;
    color: var(--code-text);
  }
  .pane pre .var {
    padding: 0;
    background: none;
    color: var(--code-accent);
    font-size: inherit;
  }
  .pane textarea {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    margin: 0;
    padding: 0 20px 0 0;
    border: 0;
    background: none;
    font: inherit;
    white-space: pre;
    overflow: hidden;
    resize: none;
    color: transparent;
    caret-color: var(--code-text);
  }
  .pane textarea:focus {
    outline: none;
  }
  .pane textarea::selection {
    background: #1d4ed855;
  }

  /* ---- fields ---- */
  .f {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }
  .f > span {
    font-size: 12px;
    font-weight: 600;
    color: var(--text);
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
    padding: 9px 12px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: var(--surface);
    font: inherit;
    font-size: 13px;
    color: var(--text);
    width: 100%;
  }
  .select {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 12px;
  }
  .select :global(svg) {
    color: var(--text-2);
    flex: none;
  }
  .select select {
    flex: 1;
    min-width: 0;
    padding: 9px 0;
    border: 0;
    background: none;
    font: inherit;
    font-size: 13px;
    color: var(--text);
    appearance: none;
  }
  .select select:focus {
    outline: none;
  }
  input:read-only {
    background: var(--surface-2);
    color: var(--text-2);
  }

  /* ---- tool toggles ---- */
  .tool {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 7px 0;
    border-top: 1px solid var(--border);
    cursor: pointer;
  }
  .tool + .tool {
    border-top: 1px solid var(--border);
  }
  .tool .tx {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }
  .tool .n {
    font-size: 13px;
    color: var(--text);
  }
  .tool .d {
    font-size: 11px;
    color: var(--text-3);
  }
  /* The artboard's 36×20 switch, which is a checkbox underneath. */
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
  .switch:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* ---- skills ---- */
  .chips {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .chip-skill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    border-radius: 999px;
    background: var(--purple-soft);
    font-size: 12px;
    color: var(--purple);
  }
  .chip-skill button {
    display: grid;
    place-items: center;
    padding: 0;
    border: 0;
    background: none;
    color: var(--purple);
    cursor: pointer;
  }
  .add {
    position: relative;
  }
  .add > button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    border: 1px dashed var(--border);
    border-radius: 999px;
    background: none;
    font: inherit;
    font-size: 12px;
    color: var(--text-2);
    cursor: pointer;
  }
  .add > button:hover {
    border-color: var(--accent);
    color: var(--accent-text);
  }
  .menu {
    position: absolute;
    top: 30px;
    left: 0;
    z-index: 6;
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
  .menu button {
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: 8px 10px;
    border: 0;
    border-radius: var(--r-sm);
    background: none;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .menu button:hover {
    background: var(--surface-2);
  }
  .menu .n {
    font-size: 13px;
    color: var(--text);
  }
  .menu .d {
    font-size: 11px;
    color: var(--text-3);
  }
  .menu .none {
    padding: 8px 10px;
    font-size: 12px;
    color: var(--text-3);
  }

  /* ---- buttons and banners ---- */
  .secondary,
  .primary {
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
  .btns button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
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
  .banner.bad {
    background: var(--danger-soft);
    color: var(--danger);
  }
  .banner.good {
    background: var(--success-soft);
    color: var(--success);
  }
  .failure {
    border-left: 3px solid var(--danger);
    color: var(--danger);
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
