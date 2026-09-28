import { describe, expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { checkStartup, PLACEHOLDER_SESSION_SECRET } from '../../src/lib/config';

/**
 * What the server refuses to start on (hooks.server.ts `init`).
 *
 * Pure, and given its environment, so every case is a literal environment
 * rather than whatever `.env` the machine running the test happens to have.
 */

const SECRET = 'a'.repeat(64);
const KEY = randomBytes(32).toString('base64');

/** A development machine's `.env`, as `.env.example` asks for it. */
const development = {
  DATABASE_URL: 'postgres://postgres:postgres@localhost:5432/factory',
  RUNNER_AUTH_TOKEN: 'a-development-token',
  SESSION_SECRET: SECRET,
};

/** A deployment's environment, as docs/operations.md asks for it. */
const deployment = {
  DATABASE_URL: 'postgres://factory:secret@127.0.0.1:5432/factory',
  RUNNER_BASE_URL: 'http://127.0.0.1:8080',
  RUNNER_AUTH_TOKEN: 'b'.repeat(64),
  PUBLIC_BASE_URL: 'https://factory.example.com',
  ORIGIN: 'https://factory.example.com',
  BODY_SIZE_LIMIT: '10M',
  SESSION_SECRET: SECRET,
  SECRET_ENCRYPTION_KEY: KEY,
};

const deployed = (env: NodeJS.ProcessEnv) => checkStartup(env, { deployment: true });

describe('a development machine', () => {
  test('its .env is enough: the addresses have defaults, the key is optional', () => {
    expect(checkStartup(development, { deployment: false })).toEqual({
      problems: [],
      warnings: [],
    });
  });

  test('a missing required value is still a reason not to start', () => {
    const { problems } = checkStartup(
      { ...development, SESSION_SECRET: '' },
      { deployment: false },
    );
    expect(problems).toEqual(['missing required configuration: SESSION_SECRET']);
  });

  test('the placeholder secret is left alone here — it is somebody’s own machine', () => {
    const { problems } = checkStartup(
      { ...development, SESSION_SECRET: PLACEHOLDER_SESSION_SECRET },
      { deployment: false },
    );
    expect(problems).toEqual([]);
  });

  test('an encryption key that is set but malformed is refused even here', () => {
    const { problems } = checkStartup(
      { ...development, SECRET_ENCRYPTION_KEY: 'not-32-bytes' },
      { deployment: false },
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('SECRET_ENCRYPTION_KEY must decode to 32 bytes');
  });
});

describe('a deployment', () => {
  test('a complete environment starts with nothing to say', () => {
    expect(deployed(deployment)).toEqual({ problems: [], warnings: [] });
  });

  test('NODE_ENV=production makes it one when nobody says otherwise', () => {
    const { problems } = checkStartup({ ...development, NODE_ENV: 'production' });
    expect(problems.length).toBeGreaterThan(0);
  });

  test('the development defaults do not stand in for a missing address', () => {
    const { problems } = deployed({ ...deployment, PUBLIC_BASE_URL: '' });
    expect(problems[0]).toContain('missing required configuration: PUBLIC_BASE_URL');
  });

  test('with nothing handed over, it says that the built server does not read .env', () => {
    const { problems } = deployed({ SECRET_ENCRYPTION_KEY: KEY });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(
      'missing required configuration: DATABASE_URL, RUNNER_BASE_URL, RUNNER_AUTH_TOKEN, PUBLIC_BASE_URL, SESSION_SECRET',
    );
    expect(problems[0]).toContain('does not read .env');
  });

  test('with the file handed over but a blank left in it, it names the blank and nothing more', () => {
    const { problems } = deployed({ ...deployment, SESSION_SECRET: '' });
    expect(problems).toEqual(['missing required configuration: SESSION_SECRET']);
  });

  test('the session secret from .env.example is refused: anybody can read it', () => {
    const { problems } = deployed({ ...deployment, SESSION_SECRET: PLACEHOLDER_SESSION_SECRET });
    expect(problems).toEqual([
      'SESSION_SECRET is the placeholder from .env.example, which anybody can read — generate one with `openssl rand -hex 32`',
    ]);
  });

  test('a short session secret is refused, and the message never carries it', () => {
    const { problems } = deployed({ ...deployment, SESSION_SECRET: 'hunter2-short' });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('shorter than 32 characters');
    expect(problems.join('\n')).not.toContain('hunter2');
  });

  test('the runner token from .env.example is refused', () => {
    const { problems } = deployed({ ...deployment, RUNNER_AUTH_TOKEN: 'change-me' });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('RUNNER_AUTH_TOKEN is the placeholder');
  });

  test('without an encryption key nothing could be stored, so it will not start', () => {
    const { problems } = deployed({ ...deployment, SECRET_ENCRYPTION_KEY: '' });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('SECRET_ENCRYPTION_KEY is not set');
  });

  test('a plain-HTTP address is refused: the Secure session cookie would never be kept', () => {
    const { problems } = deployed({
      ...deployment,
      PUBLIC_BASE_URL: 'http://factory.example.com',
      ORIGIN: 'http://factory.example.com',
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('PUBLIC_BASE_URL must be an https:// address');
  });

  test('plain HTTP on this machine itself is allowed — browsers keep the cookie there', () => {
    const { problems } = deployed({
      ...deployment,
      PUBLIC_BASE_URL: 'http://localhost:3000',
      ORIGIN: 'http://localhost:3000',
    });
    expect(problems).toEqual([]);
  });

  test('ORIGIN and PUBLIC_BASE_URL naming different addresses is refused', () => {
    const { problems } = deployed({ ...deployment, ORIGIN: 'https://other.example.com' });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('ORIGIN and PUBLIC_BASE_URL name different addresses');
  });

  test('ORIGIN and BODY_SIZE_LIMIT unset are warnings, not refusals', () => {
    const { problems, warnings } = deployed({
      ...deployment,
      ORIGIN: '',
      BODY_SIZE_LIMIT: '',
    });
    expect(problems).toEqual([]);
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain('ORIGIN is not set');
    expect(warnings[1]).toContain('BODY_SIZE_LIMIT is not set');
  });

  test('every problem is reported at once, so one restart fixes them all', () => {
    const { problems } = deployed({
      ...deployment,
      SESSION_SECRET: PLACEHOLDER_SESSION_SECRET,
      RUNNER_AUTH_TOKEN: 'change-me',
      SECRET_ENCRYPTION_KEY: '',
    });
    expect(problems).toHaveLength(3);
  });

  test('no message carries any value it was given', () => {
    const env = {
      ...deployment,
      SESSION_SECRET: 'x'.repeat(10),
      SECRET_ENCRYPTION_KEY: 'bm90LWEta2V5',
      DATABASE_URL: '',
    };
    const text = deployed(env).problems.join('\n');
    expect(text).not.toContain('xxxxxxxxxx');
    expect(text).not.toContain('bm90LWEta2V5');
  });
});
