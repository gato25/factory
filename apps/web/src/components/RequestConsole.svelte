<script lang="ts">
  import { send } from '$lib/remote/launches.remote';

  /**
   * A request console for a running project that has no page to show
   * (003 FR-013, FR-014): method, path, headers and body in; status, time,
   * headers and body out. The request is sent by the application, not this
   * browser, so a project that set no cross-origin headers still answers.
   */
  let { launchId, baseUrl }: { launchId: string; baseUrl: string } = $props();

  const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;
  type Method = (typeof METHODS)[number];

  let method = $state<Method>('GET');
  let path = $state('/');
  let headers = $state('');
  let body = $state('');
  let sending = $state(false);
  let problem = $state<string | null>(null);
  let response = $state<{
    status: number;
    statusText: string;
    ms: number;
    headers: [string, string][];
    body: string;
    json: string | null;
    truncated: boolean;
  } | null>(null);
  let showHeaders = $state(false);

  const hasBody = $derived(!['GET', 'HEAD'].includes(method));
  const tone = $derived(
    response === null
      ? ''
      : response.status < 300
        ? 'ok'
        : response.status < 400
          ? 'warn'
          : 'bad'
  );

  async function go(event: SubmitEvent) {
    event.preventDefault();
    sending = true;
    problem = null;
    try {
      const result = await send({ launchId, method, path, headers, body });
      if (result.ok) response = result.response;
      else problem = result.message;
    } finally {
      sending = false;
    }
  }
</script>

<div class="console">
  <form class="request" onsubmit={go}>
    <div class="line">
      <select bind:value={method} aria-label="Арга">
        {#each METHODS as m (m)}<option value={m}>{m}</option>{/each}
      </select>
      <input
        bind:value={path}
        placeholder="/api/health"
        aria-label="Зам, {baseUrl} руу илгээнэ"
        title="{baseUrl} руу илгээнэ"
        spellcheck="false"
      />
      <button type="submit" class="primary" disabled={sending}>
        {sending ? 'Илгээж байна…' : 'Илгээх'}
      </button>
    </div>
    <details class="more">
      <summary>Толгой{hasBody ? ' ба бие' : ''}</summary>
      <textarea
        bind:value={headers}
        rows="2"
        placeholder={'Accept: application/json\nX-Debug: 1'}
        spellcheck="false"
        aria-label="Толгойнууд, мөрд нэг"
      ></textarea>
      {#if hasBody}
        <textarea
          bind:value={body}
          rows="5"
          placeholder={'{ "name": "example" }'}
          spellcheck="false"
          aria-label="Бие"
        ></textarea>
      {/if}
    </details>
  </form>

  {#if problem}
    <p class="problem" role="alert">{problem}</p>
  {/if}

  {#if response}
    <div class="response">
      <div class="status">
        <span class="badge {tone}">{response.status} {response.statusText}</span>
        <span class="ms">{response.ms} ms</span>
        <button type="button" class="link" onclick={() => (showHeaders = !showHeaders)}>
          Хариуны {response.headers.length} толгойг {showHeaders ? 'нуух' : 'харах'}
        </button>
      </div>
      {#if showHeaders}
        <dl class="headers">
          {#each response.headers as [name, value] (name + value)}
            <dt>{name}</dt>
            <dd>{value}</dd>
          {/each}
        </dl>
      {/if}
      <pre class="body">{response.json ?? response.body}</pre>
      {#if response.truncated}
        <p class="small muted">Эхний 256 KB-ийг харуулж байна.</p>
      {/if}
    </div>
  {/if}
</div>

<style>
  .console {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .request {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .line {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: var(--surface);
  }
  select,
  input,
  textarea {
    font: inherit;
    font-size: 13px;
    color: var(--text);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
  }
  select {
    padding: 6px 8px;
    font-family: var(--font-mono);
    font-weight: 600;
    flex: none;
  }
  input {
    flex: 1;
    min-width: 0;
    padding: 6px 8px;
    font-family: var(--font-mono);
    border: 0;
  }
  input:focus {
    outline: 2px solid var(--accent-soft);
  }
  .primary {
    flex: none;
    padding: 7px 14px;
    border: 0;
    border-radius: var(--r-sm);
    background: var(--accent);
    color: var(--text-inv);
    font: inherit;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
  }
  .primary:disabled {
    opacity: 0.6;
    cursor: progress;
  }
  .more summary {
    font-size: 12px;
    color: var(--text-2);
    cursor: pointer;
  }
  .more textarea {
    display: block;
    width: 100%;
    margin-top: 8px;
    padding: 8px;
    font-family: var(--font-mono);
    font-size: 12px;
    resize: vertical;
  }

  .problem {
    margin: 0;
    font-size: 12px;
    color: var(--danger);
  }

  .response {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .status {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .badge {
    font-family: var(--font-mono);
    font-size: 12px;
    font-weight: 600;
  }
  .ms {
    font-size: 12px;
    color: var(--text-3);
  }
  .link {
    margin-left: auto;
    padding: 0;
    border: 0;
    background: none;
    font: inherit;
    font-size: 12px;
    color: var(--accent-text);
    cursor: pointer;
  }
  .headers {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 2px 12px;
    margin: 0;
    font-family: var(--font-mono);
    font-size: 11px;
  }
  .headers dt {
    color: var(--text-2);
  }
  .headers dd {
    margin: 0;
    color: var(--text);
    overflow-wrap: anywhere;
  }
  .body {
    margin: 0;
    max-height: 360px;
    overflow: auto;
    padding: 12px;
    border-radius: var(--r-sm);
    background: var(--code-bg);
    color: var(--code-text);
    font-family: var(--font-mono);
    font-size: 12px;
    line-height: 1.5;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
</style>
