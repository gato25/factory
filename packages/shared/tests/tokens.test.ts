import { describe, expect, test } from 'bun:test';
import {
  addTokens,
  compactTokens,
  NO_TOKENS,
  normaliseTokens,
  tokenCount,
  totalTokens,
} from '../src/tokens';

/**
 * Tokens are for showing, so the rules are about never showing something
 * wrong: a count is a whole number of at least zero, a malformed peer is
 * zeros rather than a refusal, and a big number is rounded, not cut.
 */

describe('a count read from JSON', () => {
  test('a whole number stays', () => {
    expect(tokenCount(1234)).toBe(1234);
    expect(tokenCount('1234')).toBe(1234);
  });

  test('anything else is zero: negative, fractional junk, NaN, absent, text', () => {
    expect(tokenCount(-5)).toBe(0);
    expect(tokenCount(Number.NaN)).toBe(0);
    expect(tokenCount(Number.POSITIVE_INFINITY)).toBe(0);
    expect(tokenCount(undefined)).toBe(0);
    expect(tokenCount(null)).toBe(0);
    expect(tokenCount('many')).toBe(0);
  });

  test('a fraction is rounded, since a token is not divisible', () => {
    expect(tokenCount(12.6)).toBe(13);
  });
});

describe('what a peer sent', () => {
  test('the four counts are kept', () => {
    expect(normaliseTokens({ input: 3, output: 45, cache_read: 900, cache_creation: 12 })).toEqual({
      input: 3,
      output: 45,
      cache_read: 900,
      cache_creation: 12,
    });
  });

  test('nothing, or the wrong kind of thing, is zeros — never an error', () => {
    expect(normaliseTokens(undefined)).toEqual(NO_TOKENS);
    expect(normaliseTokens(null)).toEqual(NO_TOKENS);
    expect(normaliseTokens('lots')).toEqual(NO_TOKENS);
    expect(normaliseTokens([1, 2, 3])).toEqual(NO_TOKENS);
    expect(normaliseTokens({ input: 'x', output: -1 })).toEqual(NO_TOKENS);
  });

  test('keys that are not ours are dropped', () => {
    const out = normaliseTokens({ input: 1, total: 999, __proto__: { input: 50 } });
    expect(out).toEqual({ input: 1, output: 0, cache_read: 0, cache_creation: 0 });
  });
});

describe('sums', () => {
  test('the headline is all four counts', () => {
    expect(totalTokens({ input: 3, output: 45, cache_read: 900, cache_creation: 12 })).toBe(960);
  });

  test('a partial or missing object counts what it has', () => {
    expect(totalTokens({ output: 7 })).toBe(7);
    expect(totalTokens(undefined)).toBe(0);
    expect(totalTokens(null)).toBe(0);
  });

  test('adding many is field by field, and skips what is absent', () => {
    expect(
      addTokens(
        { input: 1, output: 2, cache_read: 3, cache_creation: 4 },
        undefined,
        { input: 10, output: 20, cache_read: 30, cache_creation: 40 },
        null,
      ),
    ).toEqual({ input: 11, output: 22, cache_read: 33, cache_creation: 44 });
  });

  test('adding does not change what it was given', () => {
    const a = { input: 1, output: 1, cache_read: 1, cache_creation: 1 };
    addTokens(a, a);
    expect(a).toEqual({ input: 1, output: 1, cache_read: 1, cache_creation: 1 });
    expect(addTokens()).toEqual(NO_TOKENS);
    expect(NO_TOKENS).toEqual({ input: 0, output: 0, cache_read: 0, cache_creation: 0 });
  });
});

describe('a count a person can take in', () => {
  test.each([
    [0, '0'],
    [7, '7'],
    [842, '842'],
    [999, '999'],
    [1_000, '1K'],
    [1_234, '1.2K'],
    [9_949, '9.9K'],
    [9_960, '10K'],
    [18_400, '18K'],
    [123_456, '123K'],
    [999_499, '999K'],
    [1_000_000, '1M'],
    [1_240_000, '1.2M'],
    [12_340_000, '12M'],
    [2_500_000_000, '2.5B'],
  ])('%d reads as %s', (count, shown) => {
    expect(compactTokens(count)).toBe(shown);
  });

  test('rounding up into the next unit says so in that unit', () => {
    // Not "1000K": 999,950 rounds to a thousand thousands, which is a million.
    expect(compactTokens(999_950)).toBe('1M');
    expect(compactTokens(999_950_000)).toBe('1B');
  });

  test('a negative or broken count reads as zero', () => {
    expect(compactTokens(-4)).toBe('0');
    expect(compactTokens(Number.NaN)).toBe('0');
  });
});
