<script lang="ts">
  import '../../app.css';
  import { page } from '$app/state';
  import type { Snippet } from 'svelte';

  let { data, children }: { data: { user: { name: string; email: string; role: string } }; children: Snippet } =
    $props();

  const nav = [
    { href: '/', label: 'Dashboard' },
    { href: '/repositories', label: 'Repositories' },
    { href: '/tickets', label: 'Tickets' },
    { href: '/pipelines', label: 'Pipelines' },
    { href: '/agents', label: 'Agents' },
    { href: '/skills', label: 'Skills' },
    { href: '/settings', label: 'Settings' }
  ];

  const title = $derived(
    nav.find((item) => item.href !== '/' && page.url.pathname.startsWith(item.href))?.label ??
      'Dashboard'
  );
</script>

<div class="frame">
  <aside>
    <a class="brand" href="/">Code Factory</a>
    <nav>
      {#each nav as item (item.href)}
        <a
          href={item.href}
          class:active={item.href === '/'
            ? page.url.pathname === '/'
            : page.url.pathname.startsWith(item.href)}>{item.label}</a
        >
      {/each}
    </nav>
    <div class="me">
      <span class="name">{data.user.name}</span>
      <span class="role">{data.user.role}</span>
    </div>
  </aside>

  <div class="main">
    <header>
      <h1>{title}</h1>
      <div class="actions">
        <input type="search" placeholder="Search tickets, repos…" aria-label="Search" />
        <a class="primary" href="/tickets/new">New ticket</a>
      </div>
    </header>
    <main>{@render children()}</main>
  </div>
</div>

<style>
  :global(body) {
    margin: 0;
    font: 14px/1.5 system-ui, sans-serif;
    color: #1a1d24;
    background: #edeff3;
  }
  .frame {
    display: grid;
    grid-template-columns: 232px 1fr;
    min-height: 100vh;
  }
  aside {
    display: flex;
    flex-direction: column;
    gap: 24px;
    padding: 20px 16px;
    background: #fff;
    border-right: 1px solid #e3e6ec;
  }
  .brand {
    font-weight: 600;
    text-decoration: none;
    color: inherit;
  }
  nav {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  nav a {
    padding: 8px 10px;
    border-radius: 6px;
    text-decoration: none;
    color: #4a5060;
  }
  nav a.active {
    background: #eef1f7;
    color: #1a1d24;
    font-weight: 500;
  }
  .me {
    margin-top: auto;
    display: flex;
    flex-direction: column;
  }
  .me .role {
    color: #6b7280;
    font-size: 12px;
  }
  .main {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 16px 24px;
    background: #fff;
    border-bottom: 1px solid #e3e6ec;
  }
  h1 {
    font-size: 18px;
    margin: 0;
  }
  .actions {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  input[type='search'] {
    padding: 7px 10px;
    border: 1px solid #dfe3ea;
    border-radius: 6px;
    min-width: 220px;
  }
  .primary {
    padding: 8px 14px;
    border-radius: 6px;
    background: #3d5afe;
    color: #fff;
    text-decoration: none;
    font-weight: 600;
  }
  main {
    padding: 24px;
  }
  @media (max-width: 720px) {
    .frame {
      grid-template-columns: 1fr;
    }
    aside {
      flex-direction: row;
      align-items: center;
      overflow-x: auto;
    }
    .me {
      margin-top: 0;
    }
  }
</style>
