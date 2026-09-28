import { expect, test } from 'bun:test';
import { runnerSummary } from '../../src/lib/services/connections';

/**
 * specs/004-bento-redesign research D13, Constitution V: the settings page
 * says whether the execution service's credential is configured, and nothing
 * else about it. `runnerSummary` is the only thing the settings query reads
 * the token through, so what it returns is all that can ever reach a page.
 */

const TOKEN = 'rnr_Zx9-Q4mK7tLp2Vw8Bc3Hs6Ne1Yf5Dj0';

test('a configured token reads as set', () => {
  expect(runnerSummary({ RUNNER_AUTH_TOKEN: TOKEN })).toEqual({ tokenSet: true });
});

test('an absent or blank token reads as not set', () => {
  expect(runnerSummary({})).toEqual({ tokenSet: false });
  expect(runnerSummary({ RUNNER_AUTH_TOKEN: '' })).toEqual({ tokenSet: false });
  expect(runnerSummary({ RUNNER_AUTH_TOKEN: '   ' })).toEqual({ tokenSet: false });
});

test('no part of the token leaves it, however it is serialised', () => {
  const summary = runnerSummary({ RUNNER_AUTH_TOKEN: TOKEN, OTHER: 'x' });
  const serialised = [
    JSON.stringify(summary),
    String(Object.values(summary)),
    Object.keys(summary).join(),
  ];
  // Every run of eight characters: a prefix, a suffix or a middle is still a leak.
  for (let at = 0; at + 8 <= TOKEN.length; at += 1) {
    const piece = TOKEN.slice(at, at + 8);
    for (const text of serialised) expect(text).not.toContain(piece);
  }
  // A boolean and nothing more: no length, no hash, no masked form.
  expect(Object.keys(summary)).toEqual(['tokenSet']);
  expect(typeof summary.tokenSet).toBe('boolean');
});
