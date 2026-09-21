/**
 * How the design writes a time: "2 days ago", not a timestamp.
 *
 * A skill's header says when it was last edited, and a reader wants the
 * distance, not the date — "2 days ago" answers "is this current?" in a way
 * "11 Sep 2026, 14:02" does not. The exact time stays available as a title
 * attribute wherever this is used, because the distance is useless once
 * somebody is actually comparing two events.
 */

import { DEFAULT_LOCALE, m } from './i18n';

/**
 * `Intl` already speaks the language, so a distance needs no catalogue entry:
 * `mn` gives "1 цагийн өмнө", which is the phrase the artboard draws. Only the
 * two ends of the scale it has no unit for are words of ours.
 */
const RELATIVE = new Intl.RelativeTimeFormat(DEFAULT_LOCALE, { numeric: 'auto' });

const STEPS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 60 * 60 * 1000],
  ['month', 30 * 24 * 60 * 60 * 1000],
  ['week', 7 * 24 * 60 * 60 * 1000],
  ['day', 24 * 60 * 60 * 1000],
  ['hour', 60 * 60 * 1000],
  ['minute', 60 * 1000],
];

export function ago(when: Date | string, now: Date = new Date()): string {
  const then = typeof when === 'string' ? new Date(when) : when;
  const elapsed = now.getTime() - then.getTime();
  if (!Number.isFinite(elapsed)) return m.time.unknown;

  for (const [unit, size] of STEPS) {
    const n = Math.round(elapsed / size);
    // Rounding, so 36 hours reads "2 days ago" rather than "1 day ago".
    if (Math.abs(n) >= 1) return RELATIVE.format(-n, unit);
  }
  return m.time.justNow;
}

export function exact(when: Date | string): string {
  const then = typeof when === 'string' ? new Date(when) : when;
  return Number.isNaN(then.getTime()) ? '' : then.toLocaleString(DEFAULT_LOCALE);
}
