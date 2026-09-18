<script lang="ts">
  import { onDestroy } from 'svelte';
  import Icon from '$components/Icon.svelte';
  import RequestConsole from '$components/RequestConsole.svelte';
  import { launchFor, start, stop } from '$lib/remote/launches.remote';

  /**
   * Run it: a ticket's pushed branch, running on a real port, on the ticket
   * (003 FR-001, FR-003, FR-007, FR-008, FR-013).
   *
   * One card, four states — nothing yet, starting, running, ended — and in
   * the running state either the page itself or a request console, chosen by
   * what the specification step decided about the ticket and switchable by
   * hand. While it is starting or running, the card asks after it every few
   * seconds; that is also what keeps it alive, so a page left open keeps its
   * launch and one closed lets it lapse.
   */
  let {
    ticketId,
    status,
    branchName,
    hasUi
  }: {
    ticketId: string;
    status: string;
    branchName: string | null;
    hasUi: boolean | null;
  } = $props();

  const view = $derived(launchFor(ticketId));
  const current = $derived(view.ready ? view.current : null);
  const launch = $derived(current?.launch ?? null);
  const live = $derived(launch?.status === 'starting' || launch?.status === 'running');

  let working = $state(false);
  let notice = $state<string | null>(null);
  /** Which face the running state shows; null means "what the ticket says". */
  let face = $state<'page' | 'console' | null>(null);
  const showing = $derived<'page' | 'console'>(face ?? (hasUi === false ? 'console' : 'page'));

  /** Why the button is not available, in words rather than by hiding it (FR-003). */
  const blocker = $derived(
    !branchName
      ? 'Энэ даалгаварт хараахан салбар алга.'
      : status === 'done'
        ? null
        : status === 'running' || status === 'queued'
          ? 'Ажиллагаа дуусаж, салбараа түлхсэний дараа боломжтой болно.'
          : status === 'waiting_approval'
            ? 'Ажиллагаа дуусмагц боломжтой болно; одоо хяналтын цэгт хүлээж байна.'
            : status === 'failed'
              ? 'Ажиллагаа дуусаагүй тул салбарт ажиллах төсөл байхгүй байж магадгүй.'
              : 'Ажиллагаа дуусмагц боломжтой болно.'
  );

  async function act(work: () => Promise<{ ok: boolean; message?: string }>) {
    working = true;
    notice = null;
    try {
      const result = await work();
      if (!result.ok) notice = result.message ?? 'Болсонгүй.';
    } finally {
      working = false;
    }
  }

  // Polling while live: every 2 s while starting (the output is moving), every
  // 8 s once running (only a lapse would change anything).
  let timer: ReturnType<typeof setInterval> | null = null;
  $effect(() => {
    if (timer) clearInterval(timer);
    timer = null;
    if (!live) return;
    const every = launch?.status === 'starting' ? 2000 : 8000;
    timer = setInterval(() => void launchFor(ticketId).refresh(), every);
    return () => {
      if (timer) clearInterval(timer);
    };
  });
  onDestroy(() => {
    if (timer) clearInterval(timer);
  });
</script>

<section class="card run" aria-label="Ажиллуулж үзэх">
  <header>
    <span class="ic"><Icon name="play" size={15} /></span>
    <h2>Ажиллуулж үзэх</h2>
    {#if launch?.status === 'running'}
      <span class="state ok"><span class="dot"></span>Ажиллаж байна</span>
    {:else if launch?.status === 'starting'}
      <span class="state live"><span class="dot"></span>Эхэлж байна</span>
    {/if}
  </header>

  {#if !launch || launch.status === 'stopped' || launch.status === 'failed'}
    <!-- Nothing running: the button, or the reason there is none. -->
    {#if launch?.status === 'failed'}
      <p class="ended bad">
        <strong>Эхэлж чадсангүй.</strong>
        {#if launch.detail}<span class="detail">{launch.detail}</span>{/if}
      </p>
      <p class="small muted">
        Хэрэв команд нь энэ төсөлд тохирохгүй бол репозитори дээрээ өөрийг нь зааж өгнө үү —
        <a href="/repositories">Репозитори → Хэрхэн эхлэхийг тохируулах</a>.
      </p>
    {:else if launch?.status === 'stopped'}
      <p class="ended">{launch.detail ?? 'Зогслоо.'}</p>
    {/if}
    <p class="small muted">
      <code>{branchName ?? '—'}</code> салбарыг шинэ sandbox дотор, зөвхөн энэ машин хүрэх портод
      ажиллуулна.
    </p>
    <button
      type="button"
      class="primary"
      disabled={working || blocker !== null}
      title={blocker ?? undefined}
      onclick={() => act(() => start(ticketId))}
    >
      <Icon name="play" size={14} />
      {launch ? 'Дахин ажиллуулах' : 'Ажиллуулж үзэх'}
    </button>
    {#if blocker}<p class="small muted">{blocker}</p>{/if}
  {:else if launch.status === 'starting'}
    <p class="small muted">
      Хуулж, суулгаж, эхлүүлж байна. Төслийн өөрийнх нь гаралт доор байна; эхний удаад ихэвчлэн
      нэг хоёр минут болдог.
    </p>
    {#if current?.from}<p class="small muted">Команд {current.from}-оос.</p>{/if}
    <pre class="log">{(current?.log ?? []).join('\n') || 'Гаралтыг хүлээж байна…'}</pre>
    <button type="button" class="secondary" disabled={working} onclick={() => act(() => stop({ ticketId, launchId: launch.id }))}>
      <Icon name="square-check" size={14} />
      Зогсоох
    </button>
  {:else}
    <!-- Running: the address, the two faces, and Stop. -->
    <p class="address">
      Ажиллаж буй хаяг <a href={launch.url ?? '#'} target="_blank" rel="noopener">{launch.url}</a>
    </p>
    {#if current?.from}<p class="small muted">Команд {current.from}-оос.</p>{/if}
    {#each current?.notes ?? [] as note (note)}
      <p class="small muted">{note}</p>
    {/each}

    <div class="faces">
      <button type="button" class:on={showing === 'page'} onclick={() => (face = 'page')}>Хуудас</button>
      <button type="button" class:on={showing === 'console'} onclick={() => (face = 'console')}>Хүсэлт</button>
      <a class="open" href={launch.url ?? '#'} target="_blank" rel="noopener">
        Шинэ цонхонд нээх <Icon name="external-link" size={13} />
      </a>
    </div>

    {#if showing === 'page' && launch.url}
      <!-- A page that refuses to be framed still opens in its own tab above. -->
      <iframe class="page" src={launch.url} title="Ажиллаж буй төсөл"></iframe>
    {:else if launch.url}
      <RequestConsole launchId={launch.id} baseUrl={launch.url} />
    {/if}

    <button type="button" class="secondary" disabled={working} onclick={() => act(() => stop({ ticketId, launchId: launch.id }))}>
      <Icon name="square-check" size={14} />
      Зогсоох
    </button>
  {/if}

  {#if notice}<p class="small problem" role="alert">{notice}</p>{/if}
</section>

<style>
  .run {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 16px 20px;
    background: var(--surface);
    border: 1px solid var(--card-border);
    border-radius: var(--r-lg);
    box-shadow: 0 1px 2px #0f172a0a;
  }
  header {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .ic {
    display: grid;
    place-items: center;
    color: var(--text-2);
  }
  h2 {
    flex: 1;
    margin: 0;
    font-family: var(--font-head);
    font-size: 15px;
    font-weight: 600;
    letter-spacing: -0.01em;
    color: var(--text);
  }
  .state {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 2px 8px;
    border-radius: 999px;
    font-size: 12px;
    font-weight: 600;
  }
  .state.ok {
    background: var(--success-soft);
    color: var(--success);
  }
  .state.live {
    background: var(--accent-soft);
    color: var(--accent-text);
  }
  .dot {
    width: 6px;
    height: 6px;
    border-radius: 999px;
    background: currentcolor;
  }

  p {
    margin: 0;
  }
  .small {
    font-size: 12px;
    line-height: 1.5;
  }
  .muted {
    color: var(--text-2);
  }
  code {
    font-family: var(--font-mono);
    font-size: 12px;
  }
  .ended {
    font-size: 13px;
    color: var(--text);
  }
  .ended.bad {
    color: var(--danger);
  }
  .detail {
    display: block;
    margin-top: 4px;
    font-family: var(--font-mono);
    font-size: 12px;
    white-space: pre-wrap;
    color: var(--text-2);
  }
  .problem {
    color: var(--danger);
  }

  .primary,
  .secondary {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    align-self: flex-start;
    padding: 8px 14px;
    border-radius: var(--r-sm);
    font: inherit;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
  }
  .primary {
    border: 0;
    background: var(--accent);
    color: var(--text-inv);
  }
  .primary:disabled {
    background: var(--surface-2);
    color: var(--text-3);
    cursor: not-allowed;
  }
  .secondary {
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text);
  }
  .secondary:disabled {
    opacity: 0.6;
  }

  .log {
    margin: 0;
    max-height: 220px;
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

  .address {
    font-size: 13px;
    color: var(--text);
  }
  .address a {
    font-family: var(--font-mono);
    color: var(--accent-text);
    text-decoration: none;
  }
  .address a:hover {
    text-decoration: underline;
  }

  .faces {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 3px;
    border-radius: var(--r-sm);
    background: var(--surface-2);
  }
  .faces button {
    padding: 5px 10px;
    border: 0;
    border-radius: 6px;
    background: none;
    font: inherit;
    font-size: 12px;
    font-weight: 500;
    color: var(--text-2);
    cursor: pointer;
  }
  .faces button.on {
    background: var(--surface);
    color: var(--text);
    box-shadow: 0 1px 2px #0f172a0a;
  }
  .open {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    margin-left: auto;
    padding: 0 8px;
    font-size: 12px;
    font-weight: 500;
    color: var(--accent-text);
    text-decoration: none;
  }

  .page {
    width: 100%;
    height: 420px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: var(--surface);
  }
</style>
