/**
 * How the design writes a time: "12 мин өмнө", not a timestamp.
 *
 * A skill's header says when it was last edited, and a reader wants the
 * distance, not the date — "2 хоногийн өмнө" answers "is this current?" in a
 * way "2026 оны 9 сарын 11, 14:02" does not. The exact time stays available as
 * a title attribute wherever this is used, because the distance is useless
 * once somebody is actually comparing two events.
 *
 * The wording is written out rather than taken from `Intl.RelativeTimeFormat`,
 * which says "12 минутын өмнө" where the design says "12 мин өмнө", and which
 * needs a full ICU build to say anything Mongolian at all. The units a person
 * reads here are short enough to spell once and be sure of.
 */

/** Singular is not a separate form in Mongolian, so a unit is one word each. */
const STEPS: [past: string, future: string, size: number][] = [
  ['жилийн өмнө', 'жилийн дараа', 365 * 24 * 60 * 60 * 1000],
  ['сарын өмнө', 'сарын дараа', 30 * 24 * 60 * 60 * 1000],
  ['долоо хоногийн өмнө', 'долоо хоногийн дараа', 7 * 24 * 60 * 60 * 1000],
  ['хоногийн өмнө', 'хоногийн дараа', 24 * 60 * 60 * 1000],
  ['цагийн өмнө', 'цагийн дараа', 60 * 60 * 1000],
  ['мин өмнө', 'мин дараа', 60 * 1000],
];

export function ago(when: Date | string, now: Date = new Date()): string {
  const then = typeof when === 'string' ? new Date(when) : when;
  const elapsed = now.getTime() - then.getTime();
  if (!Number.isFinite(elapsed)) return 'тодорхойгүй хугацаанд';

  for (const [past, future, size] of STEPS) {
    const n = Math.round(elapsed / size);
    // Rounding, so 36 hours reads "2 хоногийн өмнө" rather than "1 хоногийн өмнө".
    if (Math.abs(n) >= 1) return `${Math.abs(n)} ${n > 0 ? past : future}`;
  }
  return 'дөнгөж сая';
}

export function exact(when: Date | string): string {
  const then = typeof when === 'string' ? new Date(when) : when;
  return Number.isNaN(then.getTime()) ? '' : then.toLocaleString('mn-MN');
}
