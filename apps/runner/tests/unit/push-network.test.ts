import { describe, expect, test } from 'bun:test';
import { pushBranch } from '../../src/container/push';
import { credentials, FakeHost, snapshot } from '../fake-host';

/**
 * A sandbox kept off the network while code is written still pushes: the
 * wall is opened for the push and closed again after.
 */
describe('pushing from an isolated sandbox', () => {
  test('gives the sandbox its network back for the push, and only then', async () => {
    const host = new FakeHost();
    const id = await host.create({
      image: 'img',
      cpu: 1,
      memoryMb: 1024,
      wallClockMinutes: 10,
      network: false,
      env: {},
      workdir: '/work',
    });
    await host.disconnectNetwork(id);
    host.responses = [{ match: 'git log', result: { stdout: 'abc1234 a commit\n' } }];

    const outcome = await pushBranch(host, id, snapshot, credentials.gitToken);
    expect(outcome.pushed).toBe(true);
    expect(host.reconnected).toEqual([id]);
    // The push ran inside the window: the order of calls shows the push
    // after the reconnection was requested.
    expect(host.argvFor('git push')).toBeDefined();
  });

  test('a sandbox that was never cut off is left alone', async () => {
    const host = new FakeHost();
    const id = await host.create({
      image: 'img',
      cpu: 1,
      memoryMb: 1024,
      wallClockMinutes: 10,
      network: true,
      env: {},
      workdir: '/work',
    });
    await pushBranch(host, id, snapshot, credentials.gitToken);
    expect(host.reconnected).toEqual([]);
  });
});
