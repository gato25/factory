import { describe, expect, test } from 'bun:test';
import { FactoryError } from '@factory/shared';
import { authenticate, constantTimeEqual } from '../../src/auth';
import { loadRunnerConfig } from '../../src/config';

/**
 * Authentication used to be defence in depth behind a private network. Once
 * the execution service is reachable from outside, this is the
 * whole boundary (002 FR-018, constitution Principle V) — and the comparison
 * is written here rather than taken from `node:crypto`, so the property it
 * used to get for free now needs proving.
 */

function requestWith(header?: string): Request {
  return new Request('https://runner.example/runs/x/start', {
    method: 'POST',
    headers: header ? { authorization: header } : {},
  });
}

describe('authenticate', () => {
  test('accepts the expected credential', () => {
    expect(() => authenticate(requestWith('Bearer s3cret'), 's3cret')).not.toThrow();
  });

  test('refuses a wrong credential, a missing header and the wrong scheme', () => {
    for (const header of [undefined, '', 'Bearer wrong', 's3cret', 'Basic s3cret', 'Bearer ']) {
      expect(() => authenticate(requestWith(header), 's3cret')).toThrow(FactoryError);
    }
  });

  test('says nothing about the run it was asked for', () => {
    // 002 FR-019: a refusal must not distinguish a run that exists from one
    // that does not, so the message cannot carry anything about the request.
    try {
      authenticate(requestWith('Bearer wrong'), 's3cret');
      throw new Error('expected a refusal');
    } catch (error) {
      expect(error).toBeInstanceOf(FactoryError);
      expect((error as FactoryError).message).toBe('unauthorised');
    }
  });
});

describe('constantTimeEqual', () => {
  test('is equality', () => {
    expect(constantTimeEqual('', '')).toBe(true);
    expect(constantTimeEqual('abc', 'abc')).toBe(true);
    expect(constantTimeEqual('abc', 'abd')).toBe(false);
    expect(constantTimeEqual('abc', 'abcd')).toBe(false);
    expect(constantTimeEqual('abcd', 'abc')).toBe(false);
    expect(constantTimeEqual('', 'a')).toBe(false);
  });

  test('handles characters outside the ASCII range', () => {
    expect(constantTimeEqual('tökén', 'tökén')).toBe(true);
    expect(constantTimeEqual('tökén', 'token')).toBe(false);
  });

  /**
   * The property that matters: rejecting a credential wrong in its FIRST
   * character must take as long as rejecting one wrong in its LAST. A
   * short-circuiting comparison fails this and leaks the secret one character
   * at a time.
   *
   * Timing in a JIT runtime is noisy, so this measures many iterations and
   * compares medians with a generous tolerance. It is here to catch somebody
   * replacing the loop with `===`, which shows up as an order-of-magnitude
   * difference, not to measure nanoseconds.
   */
  test('does not return sooner when the difference comes earlier', () => {
    const secret = 'a'.repeat(512);
    const wrongAtStart = `b${'a'.repeat(511)}`;
    const wrongAtEnd = `${'a'.repeat(511)}b`;

    const median = (candidate: string): number => {
      const samples: number[] = [];
      for (let round = 0; round < 21; round += 1) {
        const started = Bun.nanoseconds();
        for (let i = 0; i < 2000; i += 1) constantTimeEqual(candidate, secret);
        samples.push(Bun.nanoseconds() - started);
      }
      return samples.sort((a, b) => a - b)[10] as number;
    };

    // Warm the JIT so the first measurement is not the slow one.
    median(wrongAtStart);

    const early = median(wrongAtStart);
    const late = median(wrongAtEnd);
    const ratio = Math.max(early, late) / Math.min(early, late);
    expect(ratio).toBeLessThan(3);
  });
});

describe('the credential the service starts with', () => {
  test('starts with the development credential when nothing is configured', () => {
    // This service sits on a machine the team administers, so the credential
    // is defence in depth there rather than the whole boundary, and a default
    // lets development start with nothing set. `bun run dev` refuses the
    // example placeholder, and a deployment reachable from the internet must
    // set the variable explicitly.
    const config = loadRunnerConfig({});
    expect(config.authToken).toBe('dev-only-token');
    expect(config.previousAuthToken).toBeUndefined();
  });

  test('the rotation window is read, and an empty value closes it', () => {
    const open = loadRunnerConfig({ RUNNER_AUTH_TOKEN: 'new', RUNNER_AUTH_TOKEN_PREVIOUS: 'old' });
    expect(open.previousAuthToken).toBe('old');

    const closed = loadRunnerConfig({ RUNNER_AUTH_TOKEN: 'new', RUNNER_AUTH_TOKEN_PREVIOUS: '' });
    expect(closed.previousAuthToken).toBeUndefined();
  });
});
