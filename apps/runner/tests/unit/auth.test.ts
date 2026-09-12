import { describe, expect, test } from 'bun:test';
import { FactoryError } from '@factory/shared';
import { authenticate, constantTimeEqual } from '../../src/auth';
import { loadRunnerConfig } from '../../src/config';

/**
 * Authentication used to be defence in depth behind a private network. Once
 * the execution service is hosted it has a public address, so this is the
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

describe('what a hosted deployment refuses to start without', () => {
  /**
   * The change of threat model that came with hosting, as a test rather than a
   * comment. On the locally administered host the credential was defence in
   * depth behind a private network, and a development default was harmless. A
   * Worker has a public address by construction, so the same default would be
   * a service anyone who read the repository could drive.
   */
  test("EXECUTION_HOST='hosted' will not start on the development credential", () => {
    expect(() => loadRunnerConfig({ EXECUTION_HOST: 'hosted' })).toThrow(
      /requires RUNNER_AUTH_TOKEN to be set explicitly/,
    );
  });

  test('the locally administered host still starts with nothing configured', () => {
    // Deliberately unchanged. An existing deployment that has not been told
    // about any of this keeps working exactly as it did (FR-025).
    const config = loadRunnerConfig({});
    expect(config.executionHost).toBe('docker');
    expect(config.authToken).toBe('dev-only-token');
  });

  test('a hosted deployment starts once the credential is set', () => {
    const config = loadRunnerConfig({
      EXECUTION_HOST: 'hosted',
      RUNNER_AUTH_TOKEN: 'a-real-secret',
    });
    expect(config.executionHost).toBe('hosted');
    expect(config.previousAuthToken).toBeUndefined();
  });

  test('the rotation window is read, and an empty value closes it', () => {
    const open = loadRunnerConfig({
      EXECUTION_HOST: 'hosted',
      RUNNER_AUTH_TOKEN: 'new',
      RUNNER_AUTH_TOKEN_PREVIOUS: 'old',
    });
    expect(open.previousAuthToken).toBe('old');

    const closed = loadRunnerConfig({
      EXECUTION_HOST: 'hosted',
      RUNNER_AUTH_TOKEN: 'new',
      RUNNER_AUTH_TOKEN_PREVIOUS: '',
    });
    expect(closed.previousAuthToken).toBeUndefined();
  });
});
