<script lang="ts">
  import '../../app.css';
  import { page } from '$app/state';
  import type { Snippet } from 'svelte';
  import Icon from '$components/Icon.svelte';
  import { m } from '$lib/i18n';

  /**
   * The shared frame, built to `design.pen`'s Sidebar and Top Bar components
   * (spec.md §4). Every measurement here is the design's: 248px sidebar,
   * 216px nav rows, a 72px top bar, 40px body gutters. Read
   * `bun scripts/design/report.ts "01 Dashboard"` beside this file.
   */

  let {
    data,
    children,
  }: {
    data: { user: { name: string; email: string; role: string }; workspace: { name: string } };
    children: Snippet;
  } = $props();

  // The design's own icons, by the design's own names; the words from the
  // catalogue, which is where the design's copy lives ($lib/i18n).
  const nav = [
    { href: '/', label: m.nav.dashboard, icon: 'layout-dashboard' },
    { href: '/repositories', label: m.nav.repositories, icon: 'git-branch' },
    { href: '/tickets', label: m.nav.tickets, icon: 'ticket' },
    { href: '/pipelines', label: m.nav.pipelines, icon: 'workflow' },
    { href: '/agents', label: m.nav.agents, icon: 'bot' },
    { href: '/skills', label: m.nav.skills, icon: 'sparkles' },
  ];
  const settings = { href: '/settings', label: m.nav.settings, icon: 'settings' };

  const isActive = (href: string) =>
    href === '/' ? page.url.pathname === '/' : page.url.pathname.startsWith(href);

  const title = $derived(
    [...nav, settings].find((item) => item.href !== '/' && isActive(item.href))?.label ??
      m.nav.dashboard,
  );

  /** "Gantogtokh B." → "GB", as the design's avatar shows. */
  const initials = $derived(
    data.user.name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join(''),
  );

  // The field is not decoration: it submits, and the board it lands on
  // filters by the text. A search box that does nothing is the same trap as
  // a button that leads nowhere.
  let query = $state('');
</script>

<div class="frame">
  <aside>
    <a class="logo-row" href="/">
      <span class="logo-mark"><Icon name="factory" size={18} /></span>
      <span class="brand">{m.app.name}</span>
    </a>

    <p class="section">{m.nav.section}</p>

    <nav>
      {#each nav as item (item.href)}
        <a href={item.href} class="nav-item" class:active={isActive(item.href)}>
          <Icon name={item.icon} size={18} />
          <span>{item.label}</span>
        </a>
      {/each}
    </nav>

    <!-- Settings sits apart at the foot, as the design's Spacer puts it. -->
    <div class="rule"></div>
    <a href={settings.href} class="nav-item settings" class:active={isActive(settings.href)}>
      <Icon name={settings.icon} size={18} />
      <span>{settings.label}</span>
    </a>

    <div class="user-row">
      <span class="avatar">{initials}</span>
      <span class="user-text">
        <span class="name">{data.user.name}</span>
        <span class="workspace">{m.frame.workspace(data.workspace.name)}</span>
      </span>
      <Icon name="chevron-down" size={14} />
    </div>
  </aside>

  <div class="main">
    <header>
      <h1>{title}</h1>
      <div class="right">
        <form class="search" action="/tickets">
          <label class="sr" for="global-search">{m.frame.searchLabel}</label>
          <Icon name="search" size={16} />
          <input
            id="global-search"
            name="q"
            type="search"
            bind:value={query}
            placeholder={m.frame.searchPlaceholder}
          />
        </form>
        <!--
          The design draws a bell and no destination for it. Approvals are the
          only thing here that waits on a person, so that is where it goes.
        -->
        <a class="bell" href="/" aria-label={m.frame.approvalsBell}>
          <Icon name="bell" size={16} />
        </a>
        <a class="primary" href="/tickets/new">
          <Icon name="plus" size={16} />
          <span>{m.frame.newTicket}</span>
        </a>
      </div>
    </header>
    <main>{@render children()}</main>
  </div>
</div>

<style>
  .frame {
    display: grid;
    grid-template-columns: 248px 1fr;
    min-height: 100vh;
  }

  aside {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 20px 16px;
    background: var(--sidebar);
    border-right: 1px solid var(--border);
    /* The design pins Settings and the user to the foot of the SIDEBAR, which
       is the height of the window. Left to grow with the page, they end up
       wherever the content stops — which on a long board is nowhere useful. */
    position: sticky;
    top: 0;
    height: 100vh;
    overflow-y: auto;
  }

  .logo-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 2px 10px 22px;
    text-decoration: none;
  }
  .logo-mark {
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    border-radius: 9px;
    background: var(--accent);
    color: var(--text-inv);
    flex: none;
  }
  .brand {
    font-family: var(--font-head);
    font-size: 15.5px;
    font-weight: 700;
    letter-spacing: -0.35px;
    color: var(--text);
  }

  /* The nav is one group, not six loose rows: a caption over it and a rule
     under it give the list edges the design asks for. */
  .section {
    margin: 0 0 7px;
    padding: 0 11px;
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.9px;
    color: var(--text-3);
  }
  .rule {
    height: 1px;
    margin: auto 0 6px;
    background: var(--border);
  }

  nav {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .nav-item {
    display: flex;
    align-items: center;
    gap: 11px;
    padding: 8px 11px;
    border-radius: 9px;
    text-decoration: none;
    font-size: 13.5px;
    font-weight: 500;
    color: var(--nav-text);
  }
  .nav-item:hover {
    background: var(--sidebar-hover);
  }
  .nav-item.active {
    background: var(--sidebar-hover);
    color: var(--nav-text-active);
    font-weight: 600;
  }
  /* The design's Spacer: the rule above Settings carries the auto margin, so
     Settings and the user row fall to the foot together. */
  .nav-item.settings {
    margin-top: 0;
  }

  .user-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 11px 8px 0;
  }
  .avatar {
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    border-radius: 999px;
    background: var(--purple-soft);
    color: var(--purple);
    font-size: 12px;
    font-weight: 700;
    flex: none;
  }
  .user-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .user-text {
    flex: 1;
  }
  .user-text .name {
    font-size: 12.5px;
    font-weight: 600;
    color: var(--text);
  }
  .user-text .workspace {
    font-size: 10.5px;
    color: var(--text-3);
  }
  .user-text span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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
    height: 72px;
    padding: 0 40px;
    background: var(--bg);
    border-bottom: 1px solid var(--border);
  }
  h1 {
    margin: 0;
    font-size: 22px;
    font-weight: 600;
    color: var(--text);
  }

  .right {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .search {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 280px;
    padding: 9px 12px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: var(--surface);
    color: var(--text-3);
  }
  .search input {
    border: 0;
    padding: 0;
    background: none;
    font: inherit;
    font-size: 13px;
    color: var(--text);
    min-width: 0;
    flex: 1;
  }
  .search input:focus {
    outline: none;
  }
  .search:focus-within {
    border-color: var(--accent);
  }

  .bell {
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: var(--surface);
    color: var(--text-2);
    flex: none;
  }

  .primary {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 16px;
    border-radius: var(--r-sm);
    background: var(--accent);
    color: var(--text-inv);
    text-decoration: none;
    font-size: 14px;
    font-weight: 600;
    white-space: nowrap;
  }

  main {
    padding: 16px 40px 40px;
  }

  @media (max-width: 900px) {
    .frame {
      grid-template-columns: 1fr;
    }
    aside {
      position: static;
      height: auto;
      flex-direction: row;
      align-items: center;
      gap: 8px;
      overflow-x: auto;
    }
    .logo-row,
    .user-row {
      padding: 0;
    }
    .rule {
      display: none;
    }
    .section {
      display: none;
    }
    header {
      padding: 0 16px;
    }
    .search {
      width: auto;
      flex: 1;
    }
    main {
      padding: 16px;
    }
  }
</style>
