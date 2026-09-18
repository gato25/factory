<script lang="ts">
  import { create, duplicate, pipelines } from '$lib/remote/pipelines.remote';

  const list = $derived(pipelines());
  let notice = $state<string | null>(null);
</script>

<header class="head">
  <p class="muted small">Дамжлага гэдэг нь даалгаврын дамжин өнгөрөх алхмуудын дараалал юм.</p>
</header>

{#if notice}<p class="card notice" role="status">{notice}</p>{/if}

{#if list.error}
  <p class="card failure" role="alert">{(list.error as Error).message}</p>
{:else if !list.ready}
  <p class="card">Дамжлагуудыг ачааллаж байна…</p>
{:else}
  <section class="card">
    <h2 class="section">Дамжлага</h2>
    {#if list.current.length === 0}
      <p class="muted small">Хараахан алга. Доор нэгийг үүсгэнэ үү.</p>
    {:else}
      <ul>
        {#each list.current as item (item.id)}
          <li>
            <a href="/pipelines/{item.id}">
              <span class="who">
                <strong>{item.name}</strong>
                {#if item.description}<span class="muted small">{item.description}</span>{/if}
              </span>
            </a>
            <span class="meta muted small">
              v{item.currentVersion}
              <!-- How many repositories use it, before anyone changes it (FR-030) -->
              &middot; {item.repositoriesUsing} репозитори ашиглаж байна
            </span>
            <button
              type="button"
              onclick={async () => {
                const result = await duplicate(item.id);
                notice = ('problem' in result ? result.problem : result.message) ?? null;
              }}>Хуулбарлах</button
            >
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <form {...create} class="card new">
    <h2 class="section">Шинэ дамжлага</h2>
    <label>
      <span class="small muted">Нэр</span>
      <input name="name" placeholder="Build хийхээс өмнө хянана" required />
    </label>
    <label>
      <span class="small muted">Юунд зориулсан бэ</span>
      <input name="description" placeholder="Харилцагч харах бүх зүйл" />
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
    <div class="row">
      <button class="primary" type="submit" disabled={create.pending > 0}>Үүсгэх</button>
    </div>
  </form>
{/if}

<style>
  .head { margin-bottom: 16px; }
  .head p { margin: 0; }
  .notice { border-left: 3px solid var(--accent); margin-bottom: 16px; padding: 12px 16px; }
  .failure { border-left: 3px solid var(--danger); }
  ul { list-style: none; margin: 0; padding: 0; }
  li {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    gap: 12px;
    align-items: center;
    padding: 8px 2px;
    border-top: 1px solid var(--border);
  }
  li:first-child { border-top: 0; }
  .who { display: flex; flex-direction: column; min-width: 0; }
  a { text-decoration: none; color: inherit; min-width: 0; }
  .meta { white-space: nowrap; }
  .new { margin-top: 16px; display: flex; flex-direction: column; gap: 10px; }
  label { display: flex; flex-direction: column; gap: 4px; }
  input {
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    font: inherit;
  }
  .row { display: flex; justify-content: flex-end; }
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
  .errors { margin: 0; padding-left: 18px; color: var(--danger); }
</style>
