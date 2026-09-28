<script lang="ts">
  import { m } from '$lib/i18n';

  /**
   * Merge requests opened on each of the last seven days, today marked, the
   * week's total, and today's recorded cost beside it (FR-013).
   *
   * A day with none keeps its place with a stub at the floor — an omitted day
   * would make the week look shorter than it was (spec edge case). The cost
   * is labelled as RECORDED: a run killed before its engine reported usage
   * added nothing to it.
   */
  let {
    days,
    total,
    costToday,
  }: {
    days: { date: string; count: number; today: boolean }[];
    total: number;
    costToday: string;
  } = $props();

  const TALLEST = 110;
  const most = $derived(Math.max(1, ...days.map((day) => day.count)));

  /** The weekday of a server-local YYYY-MM-DD, read as a local date. */
  function weekday(date: string): string {
    const [y, mo, d] = date.split('-').map(Number);
    return m.dashboard.week.weekdays[new Date(y ?? 0, (mo ?? 1) - 1, d ?? 1).getDay()] ?? '';
  }
  const dollars = (fixed: string) => `$${Number(fixed).toFixed(2)}`;
</script>

<section class="tile week" aria-labelledby="week-title">
  <header class="head">
    <div>
      <h2 id="week-title" class="title">{m.dashboard.week.title}</h2>
      <p class="sub">{m.dashboard.week.sub}</p>
    </div>
    <span class="n" data-total={total}>{total}</span>
  </header>

  <ol class="chart">
    {#each days as day (day.date)}
      {@const label = weekday(day.date)}
      <li
        class="day"
        class:today={day.today}
        data-date={day.date}
        data-count={day.count}
        aria-label={`${m.dashboard.week.day(label, day.count)}${day.today ? ` · ${m.dashboard.week.today}` : ''}`}
      >
        <span
          class="bar"
          class:zero={day.count === 0}
          style:height="{day.count === 0 ? 8 : Math.max(12, (day.count / most) * TALLEST)}px"
        ></span>
        <span class="d" aria-hidden="true">{label}</span>
      </li>
    {/each}
  </ol>

  <p class="cost" title={m.dashboard.week.costNote}>
    <span class="l">{m.dashboard.week.costToday}</span>
    <span class="v" data-cost={costToday}>{dollars(costToday)}</span>
  </p>
</section>

<style>
  .week {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .head {
    display: flex;
    justify-content: space-between;
    gap: 12px;
  }
  .title {
    margin: 0;
    font-family: var(--font-head);
    font-size: 19px;
    font-weight: 600;
    letter-spacing: -0.3px;
  }
  .sub {
    margin: 4px 0 0;
    font-size: var(--type-caption);
    color: var(--text-2);
  }
  .n {
    font-family: var(--font-head);
    font-size: 44px;
    font-weight: 700;
    line-height: 1;
    letter-spacing: -1.5px;
    color: var(--accent-text);
  }
  .chart {
    display: flex;
    align-items: flex-end;
    gap: 10px;
    height: 140px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .day {
    display: flex;
    flex: 1;
    flex-direction: column;
    align-items: center;
    gap: 8px;
  }
  .bar {
    width: 100%;
    border-radius: 8px;
    background: var(--text-inv-2);
  }
  .bar.zero {
    background: var(--border);
  }
  .today .bar:not(.zero) {
    background: linear-gradient(180deg, var(--accent-from), var(--accent-to));
    box-shadow: 0 4px 10px #f26b1d59;
  }
  .d {
    font-size: var(--type-caption);
    font-weight: 500;
    color: var(--text-3);
  }
  .today .d {
    font-weight: 700;
    color: var(--text);
  }
  .cost {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin: 0;
    padding: 12px 16px;
    border-radius: 16px;
    background: #f4f2efb3;
  }
  .l {
    font-size: var(--type-body);
    font-weight: 500;
    color: var(--text-2);
  }
  .v {
    font-family: var(--font-head);
    font-size: 18px;
    font-weight: 700;
    color: var(--text);
  }
</style>
