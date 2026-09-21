<script lang="ts">
  import { blocks } from '$lib/markdown';

  /**
   * Renders the Markdown subset in `$lib/markdown` as elements — never with
   * {@html}, so a skill's content cannot inject markup into the page.
   */
  let { source }: { source: string } = $props();
  const parsed = $derived(blocks(source));
</script>

{#snippet spans(content: import('$lib/markdown').Inline[])}
  {#each content as part, i (i)}
    {#if part.kind === 'code'}<code>{part.text}</code>
    {:else if part.kind === 'strong'}<strong>{part.text}</strong>
    {:else}{part.text}{/if}
  {/each}
{/snippet}

<div class="markdown">
  {#each parsed as block, i (i)}
    {#if block.kind === 'heading'}
      {#if block.level === 1}
        <h1>{@render spans(block.content)}</h1>
      {:else if block.level === 2}
        <h2>{@render spans(block.content)}</h2>
      {:else}
        <h3>{@render spans(block.content)}</h3>
      {/if}
    {:else if block.kind === 'list'}
      <ul>
        {#each block.items as item, n (n)}
          <li>{@render spans(item)}</li>
        {/each}
      </ul>
    {:else if block.kind === 'code'}
      <pre>{block.lines.join('\n')}</pre>
    {:else if block.kind === 'table'}
      <!-- Wrapped, because a wide table should scroll rather than stretch
           whatever it is sitting in. -->
      <div class="table">
        <table>
          <thead>
            <tr>
              {#each block.head as cell, n (n)}
                <th style:text-align={block.align[n] ?? 'left'}>{@render spans(cell)}</th>
              {/each}
            </tr>
          </thead>
          <tbody>
            {#each block.rows as row, r (r)}
              <tr>
                {#each row as cell, n (n)}
                  <td style:text-align={block.align[n] ?? 'left'}>{@render spans(cell)}</td>
                {/each}
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {:else}
      <p>{@render spans(block.content)}</p>
    {/if}
  {/each}
  {#if parsed.length === 0}
    <p class="empty">Nothing to preview yet.</p>
  {/if}
</div>

<style>
  .markdown {
    font-size: 13px;
    line-height: 1.65;
    color: var(--text);
  }
  .markdown > :first-child {
    margin-top: 0;
  }
  h1,
  h2,
  h3 {
    font-family: var(--font-head);
    color: var(--text);
    margin: 18px 0 6px;
  }
  h1 {
    font-size: 18px;
  }
  h2 {
    font-size: 15px;
  }
  h3 {
    font-size: 13px;
  }
  p {
    margin: 0 0 10px;
  }
  ul {
    margin: 0 0 10px;
    padding-left: 20px;
  }
  li {
    margin: 2px 0;
  }
  code {
    padding: 1px 5px;
    border-radius: 4px;
    background: var(--surface-2);
    font-family: var(--font-mono);
    font-size: 12px;
  }
  .table {
    margin: 0 0 10px;
    overflow-x: auto;
  }
  table {
    border-collapse: collapse;
    width: 100%;
    font-size: 12px;
  }
  th,
  td {
    padding: 6px 10px;
    border-bottom: 1px solid var(--border);
    vertical-align: top;
  }
  th {
    font-weight: 600;
    color: var(--text-2);
    white-space: nowrap;
    background: var(--surface-2);
  }
  /* Rounded ends on the header, so the table reads as one object. */
  th:first-child {
    border-top-left-radius: var(--r-sm);
  }
  th:last-child {
    border-top-right-radius: var(--r-sm);
  }
  td {
    color: var(--text);
  }
  tbody tr:last-child td {
    border-bottom: 0;
  }

  pre {
    margin: 0 0 10px;
    padding: 12px 14px;
    border-radius: var(--r-sm);
    background: var(--code-bg);
    color: var(--code-text);
    font-family: var(--font-mono);
    font-size: 12px;
    overflow-x: auto;
  }
  .empty {
    color: var(--text-3);
  }
</style>
