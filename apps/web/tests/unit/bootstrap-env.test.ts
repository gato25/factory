import { describe, expect, test } from 'bun:test';
import { bootstrapFromEnv } from '../../src/lib/config';

/**
 * What a fresh workspace is given from the environment.
 *
 * Pure, so it is tested against literal environments rather than the one
 * this test happens to run in — which is the whole reason it takes `env` as
 * a parameter. A version that read `process.env` directly would pass or fail
 * depending on the developer's own `.env`.
 */

describe('addresses', () => {
  test('the address is taken when present', () => {
    const out = bootstrapFromEnv({ RUNNER_BASE_URL: 'http://localhost:8080' });
    expect(out.runnerBaseUrl).toBe('http://localhost:8080');
  });

  test('an empty environment still gets the local address', () => {
    // The point of the default: with nothing configured at all, the address
    // is still filled in, because the execution service's own default decided it.
    expect(bootstrapFromEnv({})).toEqual({ runnerBaseUrl: 'http://localhost:8080' });
  });

  test('a deployment gets no default — the variable is still required there', () => {
    // A deployment's services are somewhere else by definition. Pointing it
    // at its own localhost would turn a missing variable into a connection
    // refused much further along.
    expect(bootstrapFromEnv({ NODE_ENV: 'production' })).toEqual({});
  });

  test('a set variable wins over the default', () => {
    const out = bootstrapFromEnv({ RUNNER_BASE_URL: 'http://runner.internal:8080' });
    expect(out.runnerBaseUrl).toBe('http://runner.internal:8080');
  });

  test('a value that is not an address is left out rather than stored', () => {
    // The settings screen and `loadWebConfig` both refuse it with a message
    // that names the variable; seeding it silently would bypass both. It does
    // NOT fall back to the default either — replacing a typo with localhost
    // would start the application against the wrong service and call it well.
    const out = bootstrapFromEnv({ RUNNER_BASE_URL: 'not a url' });
    expect(out.runnerBaseUrl).toBeUndefined();
  });

  test('a blank variable is treated as unset, and takes the default', () => {
    expect(bootstrapFromEnv({ RUNNER_BASE_URL: '   ' }).runnerBaseUrl).toBe(
      'http://localhost:8080',
    );
  });

  test('surrounding whitespace is not part of an address', () => {
    expect(bootstrapFromEnv({ RUNNER_BASE_URL: '  http://runner:8080  ' }).runnerBaseUrl).toBe(
      'http://runner:8080',
    );
  });
});

describe('the model credential', () => {
  test('an API key is taken, and the log may say where it came from', () => {
    const out = bootstrapFromEnv({ ANTHROPIC_API_KEY: 'sk-ant-api03-example' });
    expect(out.modelKey).toEqual({ value: 'sk-ant-api03-example', from: 'ANTHROPIC_API_KEY' });
  });

  test('a subscription token is taken when there is no API key', () => {
    const out = bootstrapFromEnv({ CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat01-example' });
    expect(out.modelKey?.from).toBe('CLAUDE_CODE_OAUTH_TOKEN');
  });

  test('the API key wins when both are set — the same order the runner uses', () => {
    const out = bootstrapFromEnv({
      ANTHROPIC_API_KEY: 'api',
      CLAUDE_CODE_OAUTH_TOKEN: 'oauth',
    });
    expect(out.modelKey).toEqual({ value: 'api', from: 'ANTHROPIC_API_KEY' });
  });

  test('a blank key is no key', () => {
    expect(bootstrapFromEnv({ ANTHROPIC_API_KEY: '   ' }).modelKey).toBeUndefined();
  });

  test('nothing else in the environment is picked up', () => {
    // Only the named variables. A seed that swept up unrelated values would
    // be a way for something to reach the database that nobody intended.
    const out = bootstrapFromEnv({
      NODE_ENV: 'production',
      SESSION_SECRET: 'x',
      DATABASE_URL: 'postgres://a',
      PATH: '/bin',
    });
    expect(out).toEqual({});
  });
});
