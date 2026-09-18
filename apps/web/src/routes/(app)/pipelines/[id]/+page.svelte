<script lang="ts">
  import type { Step } from '@factory/shared';
  import { page } from '$app/state';
  import Icon from '$components/Icon.svelte';
  import PipelineBuilder from '$components/PipelineBuilder.svelte';
  import { agents } from '$lib/remote/agents.remote';
  import { duplicate, pipeline, preflight, rename, save } from '$lib/remote/pipelines.remote';
  import { members } from '$lib/remote/workspace.remote';
  import { problemsWith } from '$lib/services/pipeline-validate';

  /**
   * Screen 08 — Pipeline Builder, built to `design.pen`: a crumb, the name
   * with a pencil beside it and how many repositories use it, then the
   * canvas and the palette, with Duplicate and Test run on the right.
   *
   * Everything on the canvas edits a draft; saving writes a new version and
   * leaves runs in flight alone (FR-027).
   */
  const id = $derived(page.params.id as string);
  const detail = $derived(pipeline(id));
  const agentList = $derived(agents());
  const memberList = $derived(members());

  /** The draft. Seeded from the saved version, then owned by this screen. */
  let draft = $state<Step[] | null>(null);
  let loadedVersion = $state<number | null>(null);
  let notice = $state<string | null>(null);
  let renaming = $state(false);
  let newName = $state('');
  let showPreflight = $state(false);

  const dry = $derived(showPreflight ? preflight(id) : null);
  const dryRun = $derived(dry?.ready ? dry.current : null);

  $effect(() => {
    if (!detail.ready) return;
    // Re-seed when the saved version changes underneath us, not on every
    // refresh, or a keystroke would be undone by the query it triggered.
    if (loadedVersion !== detail.current.currentVersion) {
      draft = structuredClone(detail.current.steps);
      loadedVersion = detail.current.currentVersion;
    }
  });

  const steps = $derived(draft ?? []);
  const problems = $derived(draft ? problemsWith(draft) : []);
  const dirty = $derived(
    detail.ready && draft
      ? JSON.stringify(draft) !== JSON.stringify(detail.current.steps)
      : false
  );
</script>

{#if detail.error}
  <p class="card failure" role="alert">{(detail.error as Error).message}</p>
{:else if !detail.ready || draft === null}
  <p class="card">Дамжлагыг ачааллаж байна…</p>
{:else}
  {@const p = detail.current}

  <header class="head">
    <div class="l">
      <p class="crumb">
        <a href="/pipelines">Дамжлага</a>
        <Icon name="chevron-right" size={14} />
        <span>{p.name}</span>
      </p>

      <div class="name-row">
        {#if renaming}
          <input
            class="rename"
            aria-label="Дамжлагын нэр"
            bind:value={newName}
            onkeydown={async (event) => {
              if (event.key === 'Escape') renaming = false;
              if (event.key !== 'Enter') return;
              event.preventDefault();
              const result = await rename({ pipelineId: p.id, name: newName });
              notice = result && 'problem' in result ? result.problem : null;
              renaming = false;
            }}
          />
        {:else}
          <h1>{p.name}</h1>
          {#if p.mayChange}
            <button
              type="button"
              class="icon"
              aria-label="Энэ дамжлагыг нэрлэх"
              onclick={() => {
                newName = p.name;
                renaming = true;
              }}
            >
              <Icon name="pencil" size={16} />
            </button>
          {/if}
        {/if}

        <!-- How many repositories use it, before anyone changes it (FR-030) -->
        <span class="badge">
          <span class="dot"></span>
          {p.repositoriesUsing} репозитори ашиглаж байна
        </span>
        <span class="badge quiet"><span class="dot"></span>Хувилбар {p.currentVersion}</span>
        {#if p.runsInFlight > 0}
          <span class="badge quiet">
            <span class="dot"></span>
            {p.runsInFlight} ажиллагаа явагдаж байна
          </span>
        {/if}
      </div>

      <p class="sub">
        {#if p.mayChange}
          Алхмуудаа хүссэн дарааллаар чирнэ үү. Дамжлага үргэлжлэхээс өмнө хүн харах ёстой газарт
          хяналтын цэг нэмээрэй.
        {:else if p.ownerId}
          Энэ дамжлага өөр хүнийх — та ашиглаж болно, өөрчилж болохгүй.
        {:else}
          Энэ бол үндсэн дамжлага — та ашиглаж болно, өөрчилж болохгүй.
        {/if}
      </p>
    </div>

    <div class="r">
      <button
        type="button"
        class="secondary"
        onclick={async () => {
          const result = await duplicate(p.id);
          notice = ('problem' in result ? result.problem : result.message) ?? null;
        }}
      >
        <Icon name="copy" size={16} />
        <span>Хуулбарлах</span>
      </button>
      <button
        type="button"
        class="secondary"
        aria-pressed={showPreflight}
        onclick={() => (showPreflight = !showPreflight)}
      >
        <Icon name="play" size={16} />
        <span>Туршилтаар ажиллуулах</span>
      </button>
    </div>
  </header>

  {#if showPreflight}
    <!-- A dry run: what a ticket starting on version {p.currentVersion} would
         do, and what comparable runs cost. It starts nothing (FR-019). -->
    <section class="card dry">
      <header>
        <h2>Хэрэв даалгавар яг одоо энэ дамжлагаар эхэлбэл</h2>
        <span class="small muted">
          Хадгалагдсан {p.currentVersion}-р хувилбар. Юу ч эхлэхгүй.
        </span>
      </header>
      {#if dry?.error}
        <p class="failure" role="alert">{(dry.error as Error).message}</p>
      {:else if !dryRun}
        <p class="small muted">Тооцож байна…</p>
      {:else}
        <ol class="dry-steps">
          {#each dryRun.steps as preview (preview.index)}
            <li>
              <span class="i">{preview.index + 1}</span>
              <span class="t">
                {preview.label}
                {#if preview.model}<span class="small muted">· {preview.model}</span>{/if}
              </span>
              {#if preview.conditional}
                <span class="badge pink"><span class="dot"></span>{preview.conditionText}</span>
              {/if}
            </li>
          {/each}
        </ol>
        <p class="small muted">
          {#if dryRun.estimate.kind === 'measured'}
            Харьцуулах {dryRun.estimate.samples} ажиллагаанд ойролцоогоор {dryRun.estimate.minutes}
            минут зарцуулж ${dryRun.estimate.costUsd} орчим төлсөн байна. Энэ бол тооцоо, амлалт биш.
          {:else}
            Харьцуулах ажиллагаа хараахан алга тул тооцоолох үндэс алга. Хязгаар нь ${dryRun
              .estimate.ceilingUsd} ба {dryRun.estimate.ceilingMinutes} минут.
          {/if}
        </p>
        {#if !dryRun.verifies}
          <p class="small warn-text">
            Энэ дамжлагад үр дүнг шалгах юу ч алга (FR-034a).
          </p>
        {/if}
      {/if}
    </section>
  {/if}

  {#if notice}<p class="card notice" role="status">{notice}</p>{/if}

  {#if p.runsInFlight > 0 && dirty}
    <!-- SC-010: editing changes the behaviour of zero runs already in flight -->
    <p class="card notice" role="status">
      Энэ дамжлага дээр {p.runsInFlight} ажиллагаа явагдаж байна. Хадгалсан нь тэдэнд нөлөөлөхгүй:
      тус бүр эхэлсэн хувилбар дээрээ үргэлжилнэ.
    </p>
  {/if}

  {#if save.result && 'problem' in save.result && save.result.problem}
    <p class="card failure" role="alert">{save.result.problem}</p>
  {:else if save.result && 'message' in save.result}
    <p class="card notice" role="status">{save.result.message}</p>
  {/if}

  <PipelineBuilder
    bind:steps={draft}
    agents={agentList.ready ? agentList.current : []}
    members={memberList.ready ? memberList.current : []}
    {problems}
    editable={p.mayChange}
  />

  {#if p.mayChange}
    <!-- Saving is a form, so it does not depend on JavaScript any more than
         approving does. The draft rides along as JSON. -->
    <form {...save} class="card saver">
      <input type="hidden" name="pipelineId" value={p.id} />
      <input type="hidden" name="steps" value={JSON.stringify(steps)} />
      <div class="saver-row">
        <span class="small muted">
          {#if problems.length > 0}
            Хадгалахаас өмнө засах {problems.length} зүйл байна.
          {:else if dirty}
            Хадгалахад {p.currentVersion + 1}-р хувилбар бичигдэнэ.
          {:else}
            Хадгалах зүйл алга.
          {/if}
        </span>
        <button
          class="primary"
          type="submit"
          disabled={!dirty || problems.length > 0 || save.pending > 0}
        >
          {p.currentVersion + 1}-р хувилбар болгон хадгалах
        </button>
      </div>
      {#if save.fields.allIssues()?.length}
        <ul class="errors" role="alert">
          {#each save.fields.allIssues() ?? [] as issue (issue.message)}
            <li>{issue.message}</li>
          {/each}
        </ul>
      {/if}
    </form>
  {/if}
{/if}

<style>
  .head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 24px;
    margin-bottom: 20px;
  }
  .l {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }
  .crumb {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0;
    font-size: 12px;
    color: var(--text-3);
  }
  .crumb a {
    color: var(--text-3);
    text-decoration: none;
  }
  .crumb a:hover {
    color: var(--accent-text);
  }
  .crumb span {
    color: var(--text-2);
  }

  .name-row {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }
  h1 {
    margin: 0;
    font-family: var(--font-head);
    font-size: 22px;
    font-weight: 700;
    color: var(--text);
  }
  .rename {
    padding: 4px 10px;
    border: 1px solid var(--accent);
    border-radius: var(--r-sm);
    font: inherit;
    font-family: var(--font-head);
    font-size: 22px;
    font-weight: 700;
    color: var(--text);
  }
  button.icon {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    padding: 0;
    border: 0;
    border-radius: var(--r-sm);
    background: none;
    color: var(--text-3);
    cursor: pointer;
  }
  button.icon:hover {
    background: var(--surface-2);
    color: var(--text-2);
  }
  .sub {
    margin: 0;
    max-width: 70ch;
    font-size: 13px;
    color: var(--text-2);
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
  }
  .badge.quiet {
    color: var(--text-3);
  }
  .badge.pink {
    background: var(--design-soft);
    color: var(--design);
  }
  .dot {
    width: 6px;
    height: 6px;
    border-radius: 999px;
    background: currentcolor;
    flex: none;
  }

  .r {
    display: flex;
    align-items: center;
    gap: 10px;
    flex: none;
  }
  .secondary {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 10px 16px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: var(--surface);
    font: inherit;
    font-size: 14px;
    font-weight: 500;
    color: var(--text);
    cursor: pointer;
  }
  .secondary :global(svg) {
    color: var(--text-2);
  }
  .secondary:hover {
    border-color: var(--accent);
  }
  .secondary[aria-pressed='true'] {
    background: var(--accent-soft);
    border-color: var(--accent-soft);
    color: var(--accent-text);
  }

  .dry {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin-bottom: 16px;
  }
  .dry > header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
  }
  .dry h2 {
    margin: 0;
    font-family: var(--font-head);
    font-size: 15px;
    font-weight: 600;
    color: var(--text);
  }
  .dry p {
    margin: 0;
  }
  .dry-steps {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
  }
  .dry-steps li {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 0;
    border-top: 1px solid var(--border);
  }
  .dry-steps li:first-child {
    border-top: 0;
  }
  .dry-steps .i {
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    border-radius: 999px;
    background: var(--surface-2);
    font-size: 11px;
    color: var(--text-2);
    flex: none;
  }
  .dry-steps .t {
    flex: 1;
    min-width: 0;
    font-size: 13px;
    color: var(--text);
  }

  .notice {
    border-left: 3px solid var(--accent);
    margin-bottom: 16px;
    padding: 12px 16px;
  }
  .failure {
    border-left: 3px solid var(--danger);
    margin-bottom: 16px;
    padding: 12px 16px;
    color: var(--danger);
  }

  .saver {
    margin-top: 16px;
  }
  .saver-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }
  .saver button {
    padding: 10px 16px;
    border: 1px solid var(--accent);
    border-radius: var(--r-sm);
    background: var(--accent);
    font: inherit;
    font-size: 14px;
    font-weight: 600;
    color: var(--text-inv);
    cursor: pointer;
  }
  .saver button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .errors {
    margin: 8px 0 0;
    padding-left: 18px;
    color: var(--danger);
  }

  @media (max-width: 900px) {
    .head {
      flex-direction: column;
    }
  }
</style>
