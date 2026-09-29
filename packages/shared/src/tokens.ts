/**
 * Tokens: what a step (or a whole run) consumed, as the engine itself reported
 * it. Shown wherever the screens used to show what a run cost.
 *
 * Four counts, because the engine reports four and they mean different
 * things: what was sent in fresh, what came out, what was written to the
 * prompt cache, and what was read back from it. An agent that works through
 * a repository reads the same context on every turn, so `cache_read` is
 * usually the largest of the four by far — which is why the headline number
 * is the sum of all of them (`totalTokens`), "tokens processed", and the
 * split is kept for a screen that wants to show it.
 *
 * Snake case, like every other field that crosses the runner ⇄ application
 * boundary (callbacks.ts), so the same object is the wire shape, the runner's
 * and the application's, with nothing to map.
 */

export interface TokenUsage {
  input: number;
  output: number;
  cache_read: number;
  cache_creation: number;
}

export const NO_TOKENS: TokenUsage = Object.freeze({
  input: 0,
  output: 0,
  cache_read: 0,
  cache_creation: 0,
});

/** A count read from JSON: a whole number of at least zero, or zero. Never NaN, never negative. */
export function tokenCount(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

/**
 * Tokens from anything a peer sent. Unknown keys are dropped and bad values
 * are zero: token counts are for showing, so a malformed one must never be
 * the reason a step's outcome is refused.
 */
export function normaliseTokens(value: unknown): TokenUsage {
  const raw = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  return {
    input: tokenCount(raw.input),
    output: tokenCount(raw.output),
    cache_read: tokenCount(raw.cache_read),
    cache_creation: tokenCount(raw.cache_creation),
  };
}

/** The headline number: everything the engine processed. */
export function totalTokens(tokens: Partial<TokenUsage> | null | undefined): number {
  if (!tokens) return 0;
  return (
    tokenCount(tokens.input) +
    tokenCount(tokens.output) +
    tokenCount(tokens.cache_read) +
    tokenCount(tokens.cache_creation)
  );
}

export function addTokens(...items: (Partial<TokenUsage> | null | undefined)[]): TokenUsage {
  const sum = { ...NO_TOKENS };
  for (const item of items) {
    if (!item) continue;
    sum.input += tokenCount(item.input);
    sum.output += tokenCount(item.output);
    sum.cache_read += tokenCount(item.cache_read);
    sum.cache_creation += tokenCount(item.cache_creation);
  }
  return sum;
}

/**
 * A count a person can take in at a glance: 842, 18.4K, 1.2M.
 *
 * One decimal below ten of a unit, none from ten up — "9.6K" and "12K", not
 * "9.62K" and "12.3K" — because the digits after the first two are not
 * information anyone reads off a dashboard. Rounds to the nearest, and
 * carries: 999,950 is "1M", not "1000K".
 */
export function compactTokens(count: number): string {
  const n = tokenCount(count);
  if (n < 1_000) return String(n);
  const units: [number, string][] = [
    [1_000_000_000, 'B'],
    [1_000_000, 'M'],
    [1_000, 'K'],
  ];
  for (const [size, suffix] of units) {
    if (n < size) continue;
    const value = n / size;
    const rounded = value < 10 ? Math.round(value * 10) / 10 : Math.round(value);
    // Rounding up to the next unit ("1000K"): say it in that unit.
    if (rounded >= 1_000 && suffix !== 'B') {
      return compactTokens(size * 1_000);
    }
    return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}${suffix}`;
  }
  return String(n);
}
