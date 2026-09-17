import { beforeEach, describe, expect, test } from 'bun:test';
import type { PipelineSnapshot } from '@factory/shared';
import { pushBranch } from '../../src/container/push';
import { FakeHost } from '../fake-host';

/**
 * Pushing a retry's branch (FR-091).
 *
 * A bare `--force-with-lease` has no expected value to lease against here: a
 * run clones the default branch with `--single-branch`, so its own branch is
 * never among the clone's refs, and it pushes to a URL rather than a named
 * remote, which has no tracking refs at all. Git refuses with "stale info",
 * and a real attempt's finished, committed work could not be pushed because an
 * earlier attempt had created the branch.
 */

const SHA = 'a'.repeat(40);

const snapshot = {
  repo: {
    clone_url: 'https://github.com/gato25/nc-factory.git',
    branch: 'factory/143-task-list',
    default_branch: 'main',
  },
} as unknown as PipelineSnapshot;

let host: FakeHost;
beforeEach(() => {
  host = new FakeHost();
});

/** The `git push …` the run actually issued. */
const pushCommand = () =>
  host.calls.map((call) => call.argv.join(' ')).find((line) => line.includes('git push')) ?? '';

describe('the lease a forced push goes under', () => {
  test('names the commit the remote branch stands at', async () => {
    host.responses.push({
      match: 'ls-remote',
      result: { exitCode: 0, stdout: `${SHA}\trefs/heads/factory/143-task-list\n`, stderr: '' },
    });

    await pushBranch(host, 'container-1', snapshot, 'token', { force: true });

    // Quoting is the shell helper's business — what matters is the pair.
    expect(pushCommand()).toMatch(
      new RegExp(`--force-with-lease='?factory/143-task-list:${SHA}'?`),
    );
  });

  test('is absent when the branch is not on the remote yet — a plain push creates it', async () => {
    host.responses.push({ match: 'ls-remote', result: { exitCode: 0, stdout: '', stderr: '' } });

    await pushBranch(host, 'container-1', snapshot, 'token', { force: true });

    expect(pushCommand()).toContain('git push ');
    expect(pushCommand()).not.toContain('force');
  });

  test('is absent when the remote cannot be read, so the push reports its own failure', async () => {
    host.responses.push({
      match: 'ls-remote',
      result: { exitCode: 128, stdout: '', stderr: 'could not read Username' },
    });

    await pushBranch(host, 'container-1', snapshot, 'token', { force: true });

    expect(pushCommand()).not.toContain('force');
  });

  test('garbage from the remote is not passed on as a commit', async () => {
    host.responses.push({
      match: 'ls-remote',
      result: { exitCode: 0, stdout: 'not-a-sha refs/heads/x\n', stderr: '' },
    });

    await pushBranch(host, 'container-1', snapshot, 'token', { force: true });

    expect(pushCommand()).not.toContain('force');
  });

  test('a push that is not a retry asks for no force at all, and reads no remote', async () => {
    await pushBranch(host, 'container-1', snapshot, 'token');

    expect(pushCommand()).not.toContain('force');
    expect(host.calls.some((call) => call.argv.join(' ').includes('ls-remote'))).toBe(false);
  });

  test('the credential reaches the remote read as environment, never in the command', async () => {
    host.responses.push({
      match: 'ls-remote',
      result: { exitCode: 0, stdout: `${SHA}\trefs/heads/b\n`, stderr: '' },
    });

    await pushBranch(host, 'container-1', snapshot, 'secret-token', { force: true });

    const read = host.calls.find((call) => call.argv.join(' ').includes('ls-remote'));
    expect(read?.argv.join(' ')).not.toContain('secret-token');
    expect(read?.options?.env?.GIT_TOKEN).toBe('secret-token');
  });
});
