import { describe, expect, test } from 'bun:test';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  DEVELOPMENT_AUTH_TOKEN,
  developmentCredentialAllowed,
  envValue,
  loadRunnerConfig,
} from '../../src/config';

/**
 * What the service starts with, read from an environment that was copied
 * from `.env.example` — which is to say, one full of blank values.
 */

describe('a blank value is an absent value', () => {
  test('an empty or whitespace variable reads as unset', () => {
    expect(envValue({ A: '' }, 'A')).toBeUndefined();
    expect(envValue({ A: '   ' }, 'A')).toBeUndefined();
    expect(envValue({}, 'A')).toBeUndefined();
    expect(envValue({ A: ' x ' }, 'A')).toBe('x');
  });

  test('a blank FACTORY_WORK_DIR gets the default, not an empty root', () => {
    // `.env.example` ships `FACTORY_WORK_DIR=`. Copied verbatim, the runner
    // used to start with `workDir: ''` and make every run's directory relative
    // to its own working directory.
    const config = loadRunnerConfig({ FACTORY_WORK_DIR: '' });
    expect(config.workDir).toBe(join(homedir(), '.code-factory', 'runs'));
  });

  test('a blank port, state dir and image get their defaults', () => {
    const config = loadRunnerConfig({ RUNNER_PORT: '', FACTORY_STATE_DIR: ' ', SANDBOX_IMAGE: '' });
    expect(config.port).toBe(8080);
    expect(config.stateDir).toBe(join(homedir(), '.code-factory', 'state'));
    expect(config.sandboxImage).toBe('code-factory/sandbox:latest');
  });

  test('a blank EXECUTION_HOST means the default host, not a refused one', () => {
    expect(loadRunnerConfig({ EXECUTION_HOST: '' }).executionHost).toBe('process');
  });
});

describe('the credential the service starts with', () => {
  test('the development credential stands in only for a localhost service', () => {
    expect(developmentCredentialAllowed({}, 'http://localhost:8080')).toBe(true);
    expect(developmentCredentialAllowed({}, 'http://127.0.0.1:8080')).toBe(true);
    expect(developmentCredentialAllowed({ NODE_ENV: 'development' }, 'http://localhost:8080')).toBe(
      true,
    );
    expect(developmentCredentialAllowed({ NODE_ENV: 'production' }, 'http://localhost:8080')).toBe(
      false,
    );
    expect(developmentCredentialAllowed({}, 'https://runner.example.com')).toBe(false);
    expect(developmentCredentialAllowed({}, 'not a url')).toBe(false);
  });

  test('a production service with no credential configured refuses to start', () => {
    // The credential is the whole boundary once the service is hosted; a
    // well-known default is no credential at all (constitution Principle V).
    expect(() => loadRunnerConfig({ NODE_ENV: 'production' })).toThrow(/RUNNER_AUTH_TOKEN/);
    expect(() => loadRunnerConfig({ NODE_ENV: 'production' })).toThrow(/NODE_ENV=production/);
  });

  test('a service at a public address with no credential configured refuses to start', () => {
    expect(() => loadRunnerConfig({ RUNNER_BASE_URL: 'https://runner.example.com' })).toThrow(
      /RUNNER_BASE_URL=https:\/\/runner\.example\.com/,
    );
  });

  test('a configured credential is accepted anywhere', () => {
    const config = loadRunnerConfig({
      NODE_ENV: 'production',
      RUNNER_BASE_URL: 'https://runner.example.com',
      RUNNER_AUTH_TOKEN: 'a-real-credential',
    });
    expect(config.authToken).toBe('a-real-credential');
  });

  test('the example placeholder is refused everywhere, development included', () => {
    expect(() => loadRunnerConfig({ RUNNER_AUTH_TOKEN: 'change-me' })).toThrow(/placeholder/);
  });

  test('the development credential is what a bare development start gets', () => {
    expect(loadRunnerConfig({}).authToken).toBe(DEVELOPMENT_AUTH_TOKEN);
  });
});
