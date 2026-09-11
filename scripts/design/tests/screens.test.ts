import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { artboards, labels } from '../resolve';
import { SCREENS } from '../screens';

/**
 * Binds each screen to its artboard through `scripts/design/screens.ts`.
 *
 * Two directions, both load-bearing. A phrase in `takes` has to be in the
 * artboard — so redrawing the design and leaving the screen alone fails
 * here — and in the screen's own source — so rewording the screen and
 * leaving the design alone fails too. A phrase in `omits` has to be in the
 * artboard and absent from the source, which keeps the reasons for the
 * things we deliberately did not build honest: if the artboard drops one,
 * the note explaining it is stale.
 *
 * This is not a pixel comparison. It checks the words, which are the part
 * of a design that carries meaning and the part that silently drifts.
 */

const ROOT = resolve(import.meta.dir, '../../..');

/**
 * Whitespace is the formatter's business, not the design's, and `&amp;` is
 * the markup's way of writing `&`.
 */
const flat = (text: string) => text.replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

/**
 * Comments do not count. A component that explains why it leaves something
 * out would otherwise fail the check for mentioning it — and a phrase that
 * appears only in a comment is not on the screen.
 */
const codeOnly = (text: string) =>
  text.replace(/<!--[\s\S]*?-->/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');

const BOARDS = new Map(
  artboards().map((board) => [board.name ?? '', flat([...new Set(labels(board))].join('  '))]),
);

const source = new Map<string, string>();
function read(file: string): string {
  const cached = source.get(file);
  if (cached !== undefined) return cached;
  const text = flat(codeOnly(readFileSync(resolve(ROOT, file), 'utf8')));
  source.set(file, text);
  return text;
}

test('every screen names an artboard that exists', () => {
  const missing = SCREENS.filter((screen) => !BOARDS.has(screen.artboard)).map((s) => s.artboard);
  expect(missing).toEqual([]);
});

test('every phrase a screen takes is still in its artboard', () => {
  const gone: string[] = [];
  for (const screen of SCREENS) {
    const board = BOARDS.get(screen.artboard) ?? '';
    for (const phrase of [...screen.takes, ...(screen.omits ?? []).map((o) => o.label)]) {
      if (!board.includes(flat(phrase))) gone.push(`${screen.artboard}: ${flat(phrase)}`);
    }
  }
  expect(gone).toEqual([]);
});

test('every phrase a screen takes is still in the screen', () => {
  const gone: string[] = [];
  for (const screen of SCREENS) {
    const files = screen.files.map(read);
    for (const phrase of screen.takes) {
      if (!files.some((file) => file.includes(flat(phrase)))) {
        gone.push(`${screen.artboard}: ${flat(phrase)}`);
      }
    }
  }
  expect(gone).toEqual([]);
});

test('what a screen deliberately leaves out stays left out', () => {
  const crept: string[] = [];
  for (const screen of SCREENS) {
    const files = screen.files.map(read);
    for (const omitted of screen.omits ?? []) {
      if (files.some((file) => file.includes(flat(omitted.label)))) {
        crept.push(`${screen.artboard}: ${omitted.label}`);
      }
    }
  }
  expect(crept).toEqual([]);
});

test('every omission says why', () => {
  const silent: string[] = [];
  for (const screen of SCREENS) {
    for (const omitted of screen.omits ?? []) {
      // A one-word reason is not a reason. These are read by whoever next
      // wonders why the screen and the artboard disagree.
      if (omitted.why.trim().length < 40) silent.push(`${screen.artboard}: ${omitted.label}`);
    }
  }
  expect(silent).toEqual([]);
});

test('every artboard that is a screen is covered', () => {
  // 13 System Architecture is a diagram of how the parts fit together, not
  // a screen anybody navigates to.
  const notScreens = ['13 System Architecture'];
  const uncovered = [...BOARDS.keys()]
    .filter((name) => !notScreens.includes(name))
    .filter((name) => !SCREENS.some((screen) => screen.artboard === name));
  expect(uncovered).toEqual([]);
});
