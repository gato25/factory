/**
 * How the design writes a time: "2 days ago", not a timestamp.
 *
 * A skill's header says when it was last edited, and a reader wants the
 * distance, not the date — "2 days ago" answers "is this current?" in a way
 * "11 Sep 2026, 14:02" does not. The exact time stays available as a title
 * attribute wherever this is used, because the distance is useless once
 * somebody is actually comparing two events.
 */

import { DEFAULT_LOCALE, type Messages, m } from './i18n';
import type { TimeUnit } from './i18n/mn';

/**
 * How long ago, in the catalogue's words — "4 мин өмнө", "5 өдрийн өмнө".
 *
 * This leaned on `Intl.RelativeTimeFormat('mn')` and read "12 minutes ago" on
 * every Mongolian screen: neither Node nor the browser here carries Mongolian
 * locale data, and `Intl` falls back to English without saying so. The
 * catalogue owns the phrase instead (specs/004-bento-redesign FR-026).
 */
const STEPS: [TimeUnit, number][] = [
  ['year', 365 * 24 * 60 * 60 * 1000],
  ['month', 30 * 24 * 60 * 60 * 1000],
  ['week', 7 * 24 * 60 * 60 * 1000],
  ['day', 24 * 60 * 60 * 1000],
  ['hour', 60 * 60 * 1000],
  ['minute', 60 * 1000],
];

export function ago(when: Date | string, now: Date = new Date(), words: Messages = m): string {
  const then = typeof when === 'string' ? new Date(when) : when;
  const elapsed = now.getTime() - then.getTime();
  if (!Number.isFinite(elapsed)) return words.time.unknown;

  for (const [unit, size] of STEPS) {
    // The largest unit that has wholly passed, so five days is "5 days ago"
    // and not a rounded-up week — then rounded within it, so 36 hours reads
    // "2 days ago" rather than "1 day ago".
    if (Math.abs(elapsed) < size) continue;
    const n = Math.round(Math.abs(elapsed) / size);
    return elapsed >= 0 ? words.time.ago(n, unit) : words.time.in(n, unit);
  }
  return words.time.justNow;
}

export function exact(when: Date | string): string {
  const then = typeof when === 'string' ? new Date(when) : when;
  return Number.isNaN(then.getTime()) ? '' : then.toLocaleString(DEFAULT_LOCALE);
}
