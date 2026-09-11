import { describe, expect, test } from 'bun:test';
import { loadRunnerConfig } from '../../src/config';
import { dockerHost } from '../../src/container/host';
import { hostFor } from '../../src/container/hosts';

/**
 * 002 FR-025 and SC-010: which execution host a deployment uses is one
 * configuration change and no code change. That is the rollback for this whole
 * migration, so it is worth a test of its own rather than being assumed from
 * the fact that a switch statement exists.
 *
 * FR-026 is the other half, and this file is evidence for it too: it resolves
 * hosts without an account for, or network reach to, any hosted service.
 */

const base = { RUNNER_PORT: '8080', RUNNER_AUTH_TOKEN: 'token' };

describe('choosing an execution host', () => {
  test('defaults to the locally administered host', () => {
    // An existing deployment that has never heard of the hosted host keeps
    // behaving exactly as it did.
    expect(loadRunnerConfig({ ...base }).executionHost).toBe('docker');
  });

  test('reads the choice from configuration', () => {
    expect(loadRunnerConfig({ ...base, EXECUTION_HOST: 'docker' }).executionHost).toBe('docker');
    expect(loadRunnerConfig({ ...base, EXECUTION_HOST: 'hosted' }).executionHost).toBe('hosted');
  });

  test('refuses a host nobody implements, at startup, naming what it got', () => {
    // Failing here rather than at the first run is the point: a deployment
    // configured wrongly should not accept a ticket and then fail it.
    expect(() => loadRunnerConfig({ ...base, EXECUTION_HOST: 'kubernetes' })).toThrow(
      /EXECUTION_HOST must be 'docker' or 'hosted', not 'kubernetes'/,
    );
  });

  test('resolves the configured name to the host itself', () => {
    expect(hostFor('docker')).toBe(dockerHost);
  });

  test('the hosted host says it is not built yet, and points at the work', () => {
    // Replaced by T022–T025. Asserted rather than left implicit so that
    // finishing the hosted host is what makes this test change, and nothing
    // else silently can.
    expect(() => hostFor('hosted')).toThrow(/not implemented yet/);
    expect(() => hostFor('hosted')).toThrow(/T005/);
  });

  test('the runner no longer asks for a database', () => {
    // 002 D11: nothing in apps/runner/src read DATABASE_URL, and a Worker
    // bundle has no business carrying a Postgres driver. A run gets everything
    // it needs from the request.
    const config = loadRunnerConfig({ ...base });
    expect('databaseUrl' in config).toBe(false);
    expect(Object.keys(config).sort()).toEqual([
      'authToken',
      'executionHost',
      'port',
      'sandboxImage',
    ]);
  });
});
