import { describe, expect, test } from 'bun:test';
import { catalogueFor } from '../../src/lib/i18n';
import { spent } from '../../src/lib/step-kind';

/**
 * The Live Output panel's meta line: how long a step took and how many tokens
 * it processed. It used to end in a dollar figure.
 */

const mn = catalogueFor('mn');
const en = catalogueFor('en');

describe('a step’s meta line', () => {
  test('time then tokens, in the catalogue’s own words', () => {
    const step = { durationS: 130, tokens: 14_200 };
    expect(spent(step, en)).toBe('2m 10s · 14K tokens');
    expect(spent(step, mn)).toBe(`${mn.time.duration(2, 10)} · ${mn.tokens.count('14K')}`);
    expect(spent(step, mn)).toContain('токен');
  });

  test('a small count is written whole, a large one compactly', () => {
    expect(spent({ durationS: 5, tokens: 842 }, en)).toBe('5s · 842 tokens');
    expect(spent({ durationS: 5, tokens: 1_200_000 }, en)).toBe('5s · 1.2M tokens');
  });

  test('a step that used no tokens says nothing of them, rather than "0 tokens"', () => {
    expect(spent({ durationS: 30, tokens: 0 }, en)).toBe('30s');
    expect(spent({ durationS: 30, tokens: undefined }, en)).toBe('30s');
  });

  test('a step that has not run has no meta line at all', () => {
    expect(spent({ durationS: undefined, tokens: undefined }, en)).toBe('');
    expect(spent({ durationS: 0, tokens: 0 }, en)).toBe('');
  });

  test('tokens alone, for a step still running that has none timed yet', () => {
    expect(spent({ durationS: undefined, tokens: 9_600 }, en)).toBe('9.6K tokens');
  });

  test('it is never money', () => {
    for (const words of [en, mn]) {
      expect(spent({ durationS: 130, tokens: 1_234_567 }, words)).not.toContain('$');
    }
  });
});
