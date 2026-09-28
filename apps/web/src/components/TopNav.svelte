<script lang="ts">
  import { page } from '$app/state';
  import Icon from './Icon.svelte';
  import { m } from '$lib/i18n';

  /**
   * The frame every signed-in screen opens with: one floating bar, built to
   * the UI kit's Top Nav (Kit · 08) — the mark, the six sections, search, the
   * one primary action, settings and the person (FR-001). It replaces a white
   * sidebar and a separate top bar (specs/004-bento-redesign research D2).
   *
   * The section a person is in is marked, including on pages nested under it:
   * `/` only on itself, every other section by prefix, so a ticket's run page
   * marks Tickets (FR-002). Settings is matched on its own and marks no
   * section, because it is not one.
   *
   * Two things the artboard draws are deliberately not here. Its search field
   * shows "⌘K", a key binding the product does not have — a hint for a
   * shortcut that does nothing is a promise the screen cannot keep. And the
   * old frame's bell had no destination of its own; the design dropped it.
   */
  let { user }: { user: { name: string } } = $props();

  const sections = [
    { href: '/', label: m.topNav.dashboard },
    { href: '/tickets', label: m.topNav.tickets },
    { href: '/repositories', label: m.topNav.repositories },
    { href: '/pipelines', label: m.topNav.pipelines },
    { href: '/agents', label: m.topNav.agents },
    { href: '/skills', label: m.topNav.skills },
  ];

  const onSettings = $derived(page.url.pathname.startsWith('/settings'));
  const isCurrent = (href: string) =>
    href === '/' ? page.url.pathname === '/' : page.url.pathname.startsWith(href);

  /** "Gantogtokh B." → "GB", as the design's avatar shows. */
  const initials = $derived(
    user.name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join(''),
  );
</script>

<nav class="top-nav" aria-label={m.topNav.label}>
  <div class="left">
    <a class="logo" href="/" aria-label={m.topNav.home}>
      <span class="mark"><Icon name="factory" size={16} /></span>
      <span class="wordmark" aria-hidden="true">{m.app.name}</span>
    </a>
    <ul class="sections">
      {#each sections as section (section.href)}
        <li>
          <a
            href={section.href}
            class="section"
            aria-current={!onSettings && isCurrent(section.href) ? 'page' : undefined}
          >
            {section.label}
          </a>
        </li>
      {/each}
    </ul>
  </div>

  <div class="right">
    <!-- It submits, and the board it lands on filters by the text (FR-003). -->
    <form class="search" action="/tickets" role="search">
      <Icon name="search" size={15} />
      <input name="q" type="search" aria-label={m.topNav.searchLabel} placeholder={m.topNav.search} />
    </form>
    <a class="btn primary" href="/tickets/new">
      <Icon name="plus" size={15} />
      <span>{m.topNav.newTicket}</span>
    </a>
    <a
      class="settings"
      href="/settings"
      aria-label={m.topNav.settings}
      aria-current={onSettings ? 'page' : undefined}
    >
      <Icon name="settings-2" size={16} />
    </a>
    <span class="avatar" role="img" aria-label={m.topNav.account(user.name)} title={user.name}>
      <span aria-hidden="true">{initials}</span>
    </span>
  </div>
</nav>

<style>
  /* Floating: a frosted tile pinned a little below the top edge, so content
     scrolls under it rather than the page losing its bar. */
  .top-nav {
    position: sticky;
    top: 12px;
    z-index: 20;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    padding: 10px 12px 10px 16px;
    border: 1px solid transparent;
    border-radius: 18px;
    background:
      linear-gradient(#ffffffcc, #ffffffcc) padding-box,
      linear-gradient(180deg, var(--highlight), #ffffff00) border-box;
    backdrop-filter: blur(12px);
    box-shadow:
      0 1px 2px var(--shadow-soft),
      0 14px 36px var(--shadow-depth);
  }

  .left,
  .right {
    display: flex;
    align-items: center;
    min-width: 0;
  }
  .left {
    gap: 28px;
  }
  .right {
    gap: 10px;
  }

  .logo {
    display: flex;
    flex: none;
    align-items: center;
    gap: 10px;
    border-radius: 10px;
    text-decoration: none;
  }
  .mark {
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    border-radius: 9px;
    color: var(--text-inv);
    background: linear-gradient(180deg, #ffa470, var(--accent));
    box-shadow: 0 4px 10px #f26b1d55;
  }
  .wordmark {
    font: 700 17px / 1 var(--font-head);
    letter-spacing: -0.01em;
    color: var(--text);
    white-space: nowrap;
  }

  .sections {
    display: flex;
    gap: 4px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .section {
    display: block;
    padding: 8px 12px;
    border-radius: 10px;
    font: 500 var(--type-body) / 1.3 var(--font);
    color: var(--text-2);
    text-decoration: none;
    white-space: nowrap;
  }
  .section:hover {
    color: var(--text);
    background: var(--surface-2);
  }
  .section[aria-current='page'] {
    font-weight: 600;
    color: var(--text);
    background: var(--accent-soft);
  }

  .search {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 220px;
    padding: 9px 12px;
    border-radius: 11px;
    color: var(--text-3);
    background: var(--surface-2);
  }
  .search:focus-within {
    box-shadow: var(--focus-ring);
  }
  .search input {
    flex: 1;
    min-width: 0;
    padding: 0;
    border: 0;
    font: var(--type-body) / 1.3 var(--font);
    color: var(--text);
    background: transparent;
    outline: none;
  }
  .search input:focus-visible {
    box-shadow: none;
  }
  .search input::placeholder {
    color: var(--text-3);
  }

  .primary {
    padding: 10px 16px;
  }

  .settings {
    display: grid;
    flex: none;
    place-items: center;
    width: 36px;
    height: 36px;
    border-radius: 11px;
    color: var(--text-2);
    background: var(--surface-2);
  }
  .settings:hover,
  .settings[aria-current='page'] {
    color: var(--text);
    background: var(--accent-soft);
  }

  .avatar {
    display: grid;
    flex: none;
    place-items: center;
    width: 36px;
    height: 36px;
    border-radius: var(--r-pill);
    font: 700 var(--type-body) / 1 var(--font-head);
    color: #5a2a0a;
    background: linear-gradient(180deg, #ffc9a3, #f59a5b);
  }

  /* Narrower than the design: the sections move under the mark and search
     rather than the bar overflowing (spec edge case). */
  @media (max-width: 1180px) {
    .top-nav {
      flex-wrap: wrap;
    }
    .left {
      flex-wrap: wrap;
      gap: var(--space-3);
    }
    .sections {
      flex-wrap: wrap;
    }
  }
</style>
