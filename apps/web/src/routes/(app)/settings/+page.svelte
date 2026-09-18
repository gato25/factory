<script lang="ts">
  import {
  } from '@factory/shared';
  import Icon from '$components/Icon.svelte';
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
    { id: 'workspace', label: 'Ажлын талбар' },
    { id: 'sandbox', label: 'Sandbox (Docker)' },
    { id: 'keys', label: 'Claude CLI ба түлхүүр' },
    { id: 'design', label: 'Дизайн (pen.dev)' },
    { id: 'limits', label: 'Зардлын хязгаар' },
    { id: 'members', label: 'Гишүүд' },
    { id: 'notifications', label: 'Мэдэгдэл' },
  ];

  const STATE_TONE: Record<string, string> = {
    reachable: 'ok',
    unconfigured: '',
    unreachable: 'bad',
    unauthorised: 'bad',
    wrong_shape: 'warn',
  };
  const WHAT: Record<string, string> = {
    runner: 'Контейнер хост',
    design: 'Дизайны үйлчилгээ',
  };

  /** What a connection test found, in words rather than in its own code. */
  const STATE_LABEL: Record<string, string> = {
    reachable: 'холбогдож байна',
    unconfigured: 'тохируулаагүй',
    unreachable: 'холбогдохгүй байна',
    unauthorised: 'эрх хүрэхгүй байна',
    wrong_shape: 'хүлээгээгүй хариу',
  };

  /** What a card's badge says: the last test if there was one, else whether
   *  it is configured at all. */
  function stateOf(what: string, configured: boolean) {
    const result = tested?.find((row) => row.what === what);
    if (result) {
      return {
        label: STATE_LABEL[result.state] ?? result.state,
        tone: STATE_TONE[result.state] ?? '',
      };
    }
    return configured
      ? { label: 'Тохируулсан', tone: '' }
      : { label: 'Тохируулаагүй', tone: 'warn' };
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
    Ажлын талбарын тохиргоо — нууц түлхүүр, холболт, хязгаар, гишүүдийг администратор хариуцна.
    Code Factory-ийн бусад бүхэн тийм биш: дамжлага, агент, ур чадвар нь эзэмшигчээрээ явах бөгөөд
    хэн ч өөрийнхийг үүсгэж болно.
  </p>
{:else if config.error}
  <p class="card failure" role="alert">{(config.error as Error).message}</p>
{:else if !config.ready}
  <p class="card">Тохиргоог ачааллаж байна…</p>
{:else}
  {@const w = config.current.workspace}
  {@const r = config.current.readiness}

  <div class="wrap">
    <nav class="sections" aria-label="Тохиргооны хэсгүүд">
      {#each SECTIONS as section (section.id)}
        <a href="#{section.id}">{section.label}</a>
      {/each}
    </nav>

    <div class="content">
      {#if notice}<p class="banner" role="status">{notice}</p>{/if}

      {#if !r.ready}
        <p class="banner warn" role="status">
          This workspace cannot start a run yet. Still needed: {r.missing.join(', ')}.
        </p>
      {/if}

      <form {...saveWorkspace} class="stack">
        <section class="card" id="workspace">
          <header>
            <span class="ic"><Icon name="settings" size={18} /></span>
            <div class="tx">
              <h2>Ажлын талбар</h2>
              <p>Нэг байршуулалт, нэг ажлын талбар. Гишүүд хажуугийн самбарт түүний нэрийг харна.</p>
            </div>
            <span class="badge {r.ready ? 'ok' : 'warn'}">
              <span class="dot"></span>
              {r.ready ? 'Ажиллахад бэлэн' : 'Бэлэн биш'}
            </span>
          </header>
          <div class="grid">
            <label class="f">
              <span>Нэр</span>
              <input name="name" value={w.name} required />
            </label>
          </div>
        </section>

        <section class="card" id="sandbox">
          <header>
            <span class="ic"><Icon name="container" size={18} /></span>
            <div class="tx">
              <h2>Sandbox · Docker</h2>
              <p>
                Ажиллагаа бүр репозитори, Claude CLI, хэрэгслүүдээ агуулсан шинэ контейнер авна.
              </p>
            </div>
            {#await Promise.resolve(stateOf('runner', Boolean(w.runnerBaseUrl))) then s}
              <span class="badge {s.tone}"><span class="dot"></span>{s.label}</span>
            {/await}
          </header>
          <div class="grid">
            <label class="f">
              <span>Контейнер хостын хаяг</span>
              <input
                name="runnerBaseUrl"
                value={w.runnerBaseUrl ?? ''}
                placeholder="http://localhost:8080"
              />
            </label>
            <label class="f">
              <span>Образ</span>
              <input name="sandboxImage" value={w.sandboxImage} required />
            </label>
          </div>
          <div class="grid four">
            <label class="f">
              <span>Цөм</span>
              <input name="sandboxCpu" type="number" min="1" value={w.sandboxCpu} required />
            </label>
            <label class="f">
              <span>Санах ой, мегабайтаар</span>
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
              <span>Ажиллах хугацаа, минутаар</span>
              <input
                name="sandboxWallClockMinutes"
                type="number"
                min="1"
                value={w.sandboxWallClockMinutes}
                required
              />
            </label>
            <label class="f">
              <span>Амжилтгүй ажиллагааны орчныг хадгалах хугацаа, цагаар</span>
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
              <span class="t">Код бичих үед орчин сүлжээнд нэвтрэхийг зөвшөөрөх</span>
              <span class="d">
                Агент болон дизайны алхам бүрт шаардлагатай: агент орчин дотор ажиллаж, загвар руу
                сүлжээгээр хандана. Тиймээс энэ унтарсан үед тийм алхамтай ажиллагаа зөвшөөрөгдөхгүй.
                Зөвхөн shell алхмуудаас бүрдсэн дамжлагад унтраана уу — сүлжээнд хүрэхгүй орчин
                гадагш юу ч илгээж чадахгүй.
              </span>
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
              <h2>Зардлын хязгаар</h2>
              <p>
                Гишүүний өөрийн хязгаар давж чадахгүй тааз. Хэн нэгний агентдаа тавьсан хязгаар
                эдгээрээр таслагдана, тиймээс зөвхөн ажиллагааны зарцуулалтыг бууруулж чадна.
              </p>
            </div>
          </header>
          <div class="grid">
            <label class="f">
              <span>Нэг ажиллагааны зарцуулж болох дээд хэмжээ, доллараар</span>
              <input name="defaultCostCeilingUsd" value={w.defaultCostCeilingUsd} required />
            </label>
            <label class="f">
              <span>Нэг ажиллагааны үргэлжлэх дээд хугацаа, минутаар</span>
              <input
                name="defaultTimeCeilingMinutes"
                type="number"
                min="1"
                value={w.defaultTimeCeilingMinutes}
                required
              />
            </label>
            <label class="f">
              <span>Зэрэг ажиллаж болох ажиллагааны тоо</span>
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
              Шалгалт нь холбогдож эрх нь хүрч байгааг, холбогдохгүй байгаагаас, татгалзсанаас нь
              ялгаж хэлнэ — учир нь энэ гурав өөр өөр засварыг шаарддаг.
            </span>
          {/if}
          <button type="button" class="secondary" disabled={testing} onclick={test}>
            <Icon name="plug" size={16} />
            <span>{testing ? 'Шалгаж байна…' : 'Холболт шалгах'}</span>
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
            <span>Хадгалах</span>
          </button>
        </div>
      </form>

      <!-- A credential is written and never read back (FR-011) -->
      <section class="card" id="keys">
        <header>
          <span class="ic"><Icon name="key-round" size={18} /></span>
          <div class="tx">
            <h2>Claude CLI ба түлхүүр</h2>
            <p>
              Шифрлэгдэж хадгалагдаж, ажиллагаанд орчны хувьсагч болон дамжих бөгөөд дахин хэзээ ч
              харагдахгүй — танд ч гэсэн. Өөрчлөх цорын ганц арга бол солих юм.
            </p>
          </div>
          <span class="badge {w.hasModelCredential ? 'ok' : 'warn'}">
            <span class="dot"></span>
            {w.hasModelCredential ? 'Нэг нь хадгалагдсан' : 'Хараахан алга'}
          </span>
        </header>
        <form {...modelKey} class="grid">
          <input type="hidden" name="kind" value="model" />
          <label class="f">
            <span>Загварын түлхүүр</span>
            <input name="token" type="password" placeholder="энд буулгана уу" autocomplete="off" />
            <!--
              Either kind is accepted, and which one this is decides how the
              work is paid for. The runner tells them apart by prefix and hands
              the Claude CLI whichever variable that kind is read from, so
              switching between them is storing a different credential here —
              no code change, no rebuild.
            -->
            <span class="hint">
              Anthropic Console бүртгэлд ашиглалтаар нь тооцох API түлхүүр — эсвэл
              <code>claude setup-token</code>-оос гарах Claude захиалгын токен, энэ нь тухайн
              захиалгын өөрийнх нь эрхээс зарцуулна. Захиалгын хязгаар нь нэг хүн ажиллахаар
              хийгдсэн тул хэд хэдэн ажиллагаа зэрэг явж байвал анхаарна уу.
            </span>
          </label>
          <div class="f end-field">
            <button type="submit" class="secondary" disabled={modelKey.pending > 0}>
              <Icon name="key-round" size={16} />
              <span>Хадгалах</span>
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
            <h2>Дизайн · pen.dev</h2>
            <p>
              Зөвхөн дизайн алхамд ашиглана. Дэлгэцүүд зураг болон гарч, .pen файл кодтойгоо хамт
              хадгалагдана.
            </p>
          </div>
          <span class="badge {w.hasDesignCredential ? 'ok' : ''}">
            <span class="dot"></span>
            {w.hasDesignCredential ? 'Нэвтэрсэн' : 'Тохируулаагүй'}
          </span>
        </header>
        <form {...designKey} class="grid">
          <input type="hidden" name="kind" value="design" />
          <label class="f">
            <span>Дизайны түлхүүр</span>
            <input name="token" type="password" placeholder="энд буулгана уу" autocomplete="off" />
          </label>
          <div class="f end-field">
            <button type="submit" class="secondary" disabled={designKey.pending > 0}>
              <Icon name="key-round" size={16} />
              <span>Дизайны түлхүүр хадгалах</span>
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
          Дизайн алхмын загвар, экспортын тохиргоо нь энд биш, алхам дээрээ байдаг — дамжлага
          зохиомжлогч дээр алхам дээр нь тохируулна уу.
        </p>
      </section>

      <section class="card" id="members">
        <header>
          <span class="ic"><Icon name="user" size={18} /></span>
          <div class="tx">
            <h2>Гишүүд</h2>
            <p>
              Ажлын талбарыг администратор тохируулна. Бусад бүхэн — дамжлага, агент, ур чадвар —
              эзэмшигчээрээ явна.
            </p>
          </div>
        </header>

        {#if !people.ready}
          <p class="quiet">Ачааллаж байна…</p>
        {:else}
          <ul class="people">
            {#each people.current as person (person.id)}
              <li>
                <span class="who">
                  <strong>{person.name}</strong>
                  <span class="quiet">{person.email}</span>
                </span>
                <span class="quiet">
                  {person.ticketsCreated} даалгавар
                </span>
                <select
                  value={person.role}
                  aria-label="{person.name}-ийн үүрэг"
                  onchange={async (event) => {
                    const result = await changeRole({
                      userId: person.id,
                      role: event.currentTarget.value as 'admin' | 'member',
                    });
                    notice = ('problem' in result ? result.problem : result.message) ?? null;
                  }}
                >
                  <option value="member">Гишүүн</option>
                  <option value="admin">Администратор</option>
                </select>
                {#if person.id !== data.user.id}
                  <button
                    type="button"
                    class="danger"
                    onclick={async () => {
                      const result = await removeMember(person.id);
                      notice = ('problem' in result ? result.problem : result.message) ?? null;
                    }}>Хасах</button
                  >
                {:else}
                  <span class="quiet">та</span>
                {/if}
              </li>
            {/each}
          </ul>
        {/if}

        <form {...inviteMember} class="invite">
          <label class="f">
            <span>Нэр</span>
            <input name="name" required />
          </label>
          <label class="f">
            <span>И-мэйл</span>
            <input name="email" type="email" required />
          </label>
          <label class="f">
            <span>Үүрэг</span>
            <select name="role">
              <option value="member">Гишүүн</option>
              <option value="admin">Администратор</option>
            </select>
          </label>
          <button type="submit" class="secondary" disabled={inviteMember.pending > 0}>
            <Icon name="plus" size={16} />
            <span>Урих</span>
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
            <h2>Мэдэгдэл</h2>
            <p>Ажиллагаанд хүн хэрэгтэй болоход хэнд, хэрхэн мэдэгдэхийг заана.</p>
          </div>
          <span class="badge"><span class="dot"></span>Тохируулах зүйл алга</span>
        </header>
        <!--
          Stated rather than offered. A checkpoint resolves its own approvers
          from the step, and this deployment has no channel to send to: there
          is nothing here a setting could change, and a form that pretended
          otherwise would be worse than the truth.
        -->
        <p class="quiet">
          Хяналтын цэг өөрийг нь хэн батлахыг — багийн аль ч гишүүн, даалгаврыг үүсгэгч, эсвэл
          нэрлэсэн хүмүүсийг — дамжлага зохиомжлогч дээрх алхам дээрээ шийднэ. Ажиллагаа түүнд
          хүрэхэд тэдгээр хүмүүс тодорхойлогдож тэмдэглэгдэн, мэдэгдэл нь аппликэйшний бүртгэлд
          бичигдэнэ.
        </p>
        <p class="quiet">
          Хүн харах газар руу илгээхийн тулд дамжлагадаа Мэдэгдэх алхам нэмнэ үү: энэ нь n8n-ээр
          дамжина, тэнд л энэ байршуулалтын Slack, и-мэйл, webhook холболтууд байдаг.
        </p>
      </section>

      <!-- Runs beyond the cap wait, and each author sees where (FR-082) -->
      {#if waiting.ready && waiting.current.entries.length > 0}
        <section class="card queue">
          <header>
            <span class="ic"><Icon name="timer" size={18} /></span>
            <div class="tx">
              <h2>Одоо ажиллаж буй</h2>
              <p>
                {waiting.current.cap}-аас {waiting.current.executing} нь ажиллаж байна
                {#if waiting.current.waiting > 0}&middot; {waiting.current.waiting} хүлээж буй{/if}
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
                  <span class="quiet">{entry.authorName ?? 'тодорхойгүй'}</span>
                </span>
                <span class="badge {entry.position === null ? 'live' : 'warn'}">
                  <span class="dot"></span>
                  {entry.position === null ? 'ажиллаж байна' : `дараалалд ${entry.position}-рт`}
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
