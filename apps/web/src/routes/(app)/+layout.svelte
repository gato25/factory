<script lang="ts">
  import '../../app.css';
  import type { Snippet } from 'svelte';
  import TopNav from '$components/TopNav.svelte';

  /**
   * The shared frame (spec.md §4; specs/004-bento-redesign FR-001): the page
   * ground, one floating top bar, and the screen under it. The design's
   * artboards are 1440 wide with a 28px gutter and the bar 20px from the top;
   * read `bun scripts/design/report.ts "01 Dashboard"` beside this file.
   *
   * A screen names itself: the old frame's header carried every page's
   * title, and the bento screens put their own at the top of their first
   * tile, as each artboard does.
   */
  let {
    data,
    children,
  }: {
    data: { user: { name: string; email: string; role: string } };
    children: Snippet;
  } = $props();
</script>

<div class="frame">
  <TopNav user={data.user} />
  <main>{@render children()}</main>
</div>

<style>
  .frame {
    display: flex;
    flex-direction: column;
    gap: 20px;
    min-height: 100vh;
    padding: 20px 28px 28px;
  }

  main {
    min-width: 0;
  }

  @media (max-width: 720px) {
    .frame {
      padding: 12px 16px 20px;
    }
  }
</style>
