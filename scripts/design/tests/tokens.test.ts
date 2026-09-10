import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { load } from '../resolve';

/**
 * The token layer in `apps/web/src/app.css` is a copy of `design.pen`'s
 * `variables` block. A copy nobody checks stops being one — the palette had
 * already drifted on every single value before this existed — so the file is
 * read here and compared, rather than trusted.
 */

// Quotes are normalised: the formatter decides between ' and " and that is
// not a fact about the design.
const CSS = readFileSync(resolve(import.meta.dir, '../../../apps/web/src/app.css'), 'utf8').replace(
  /"/g,
  "'",
);
const { variables } = load();

/** `--name: value;` as the CSS actually declares it. */
function declared(name: string): string | null {
  const found = CSS.match(new RegExp(`--${name}\\s*:\\s*([^;]+);`));
  return found ? (found[1] as string).trim() : null;
}

test('every variable the design defines is declared, with its value', () => {
  const wrong: string[] = [];
  for (const [name, variable] of Object.entries(variables)) {
    const actual = declared(name);
    if (actual === null) {
      wrong.push(`--${name} is not declared at all (design: ${variable.value})`);
      continue;
    }
    if (variable.type === 'color') {
      // Case only; a design tool writes #ECEEF2 and a stylesheet may not.
      if (actual.toUpperCase() !== String(variable.value).toUpperCase()) {
        wrong.push(`--${name} is ${actual}, design says ${variable.value}`);
      }
    } else if (variable.type === 'number') {
      if (actual !== `${variable.value}px`) {
        wrong.push(`--${name} is ${actual}, design says ${variable.value}px`);
      }
    } else if (!actual.includes(`'${variable.value}'`)) {
      // A typeface may carry fallbacks, but the design's face has to be first.
      wrong.push(`--${name} is ${actual}, which does not lead with '${variable.value}'`);
    }
  }
  expect(wrong).toEqual([]);
});

test('the design defines every token, so none is invented here', () => {
  // A colour declared in the CSS that the design does not name is a decision
  // taken outside the design file, which is the thing this is meant to stop.
  const invented = [...CSS.matchAll(/^\s*--([a-z0-9-]+)\s*:/gm)]
    .map((m) => m[1] as string)
    .filter((name) => !(name in variables));
  expect(invented).toEqual([]);
});

test('the typefaces are self-hosted, so a screen does not depend on a font service', () => {
  for (const family of ['Inter', 'Geist', 'Geist Mono']) {
    expect(CSS).toContain(`font-family: '${family}';`);
  }
  expect(CSS).not.toContain('fonts.googleapis.com');
  expect(CSS).not.toContain('fonts.gstatic.com');
  // Every face points at a file this repository ships.
  const sources = [...CSS.matchAll(/src:\s*url\('([^']+)'\)/g)].map((m) => m[1] as string);
  expect(sources.length).toBeGreaterThan(0);
  expect(sources.every((s) => s.startsWith('/fonts/'))).toBe(true);
});
