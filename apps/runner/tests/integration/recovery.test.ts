import { beforeEach, expect, test } from 'bun:test';
import { FactoryError } from '@factory/shared';
import { buildReplacement, isSandboxLoss, withSandboxRecovery } from '../../src/container/recover';
import { branchExistsRemotely, resetRunBranch } from '../../src/container/reset';
import { credentials, FakeHost, snapshot } from '../fake-host';

/**
 * A sandbox that disappears mid-step is attempted once more in a new sandbox,
 * resuming from the last commit on the branch, and a second loss fails
 * (FR-093). A branch a previous attempt already wrote to is brought back to a
 * known state first (FR-091).
 */

let host: FakeHost;
const sandbox = {
  image: 'factory/runner:1',
  cpu: 2,
  memoryMb: 4096,
  wallClockMinutes: 60,
  networkDuringImplement: false,
};
const input = { snapshot, credentials, sandbox };
const lost = () => new FactoryError('sandbox_lost', 'the sandbox went away');

beforeEach(() => {
  host = new FakeHost();
});

test('a step that succeeds is left alone: no second sandbox', async () => {
  const result = await withSandboxRecovery(
    host,
    'container-1',
    input,
    async (id) => `ran in ${id}`,
  );

  expect(result).toEqual({ outcome: 'ran in container-1', recovered: false });
  expect(host.created).toHaveLength(0);
  expect(host.destroyed).toHaveLength(0);
});

test('a lost sandbox earns exactly one more, and the step runs again in it', async () => {
  const ranIn: string[] = [];
  const result = await withSandboxRecovery(host, 'the-original', input, async (id) => {
    ranIn.push(id);
    if (ranIn.length === 1) throw lost();
    return 'done';
  });

  expect(result.outcome).toBe('done');
  expect(result.recovered).toBe(true);
  // A new container, and the step ran in THAT one, not in the corpse.
  expect(host.created).toHaveLength(1);
  expect(ranIn).toEqual(['the-original', 'container-1']);
  // The one that went away is not left behind.
  expect(host.destroyed).toEqual(['the-original']);
});

test('the replacement resumes from the last commit on the branch', async () => {
  host.responses = [
    { match: 'refs/heads/factory/142', result: { exitCode: 0, stdout: 'abc123def\n' } },
  ];

  const result = await withSandboxRecovery(host, 'the-original', input, async () => {
    if (host.created.length === 0) throw lost();
    return 'done';
  });

  expect(result.resumedFrom).toBe('abc123def');
  // It fetched that branch specifically, then checked it out.
  const fetch = host.calls.find((c) => c.argv.join(' ').includes('refs/heads/factory/142'));
  expect(fetch?.argv.join(' ')).toContain(
    'git checkout -B factory/142-add-google-oauth-sign-in refs/remotes/origin/factory/142-add-google-oauth-sign-in',
  );
  // The credential reached git through the environment, never the workspace.
  expect(fetch?.options?.env?.GIT_TOKEN).toBe(credentials.gitToken);
  expect([...host.files.keys()].some((path) => path.includes('GIT_TOKEN'))).toBe(false);
});

test('a branch no previous attempt pushed leaves the replacement where it started', async () => {
  // The fetch fails because the branch is not there; HEAD is the clone's.
  host.responses = [
    {
      match: 'refs/heads/factory/142',
      result: { exitCode: 128, stderr: "couldn't find remote ref" },
    },
    { match: 'rev-parse HEAD', result: { exitCode: 0, stdout: 'mainhead1\n' } },
  ];

  const result = await withSandboxRecovery(host, 'the-original', input, async () => {
    if (host.created.length === 0) throw lost();
    return 'done';
  });

  expect(result.recovered).toBe(true);
  expect(result.resumedFrom).toBe('mainhead1');
});

test('a second loss fails, and says the committed work is still there', async () => {
  let failure: FactoryError | null = null;
  try {
    await withSandboxRecovery(host, 'the-original', input, async () => {
      throw lost();
    });
  } catch (error) {
    failure = error as FactoryError;
  }

  expect(failure?.reason).toBe('sandbox_lost');
  expect(failure?.message).toBe(
    'The sandbox disappeared while the step was running, and the replacement did too. ' +
      'The work committed to the branch is still there.',
  );
  // Once, not repeatedly: exactly one replacement was built.
  expect(host.created).toHaveLength(1);
});

test("a step's own failure is not a sandbox loss and gets no second sandbox", async () => {
  let failure: Error | null = null;
  try {
    await withSandboxRecovery(host, 'the-original', input, async () => {
      throw new FactoryError('missing_output', 'docs/spec.md was never written');
    });
  } catch (error) {
    failure = error as Error;
  }

  expect(failure?.message).toBe('docs/spec.md was never written');
  expect(host.created).toHaveLength(0);
  expect(host.destroyed).toHaveLength(0);
});

test('a failure in the replacement that is the step own passes straight through', async () => {
  let failure: Error | null = null;
  try {
    await withSandboxRecovery(host, 'the-original', input, async () => {
      if (host.created.length === 0) throw lost();
      throw new FactoryError('command_failed', 'the tests did not pass');
    });
  } catch (error) {
    failure = error as Error;
  }

  // Not dressed up as a sandbox problem: the replacement worked, the step did not.
  expect(failure).toBeInstanceOf(FactoryError);
  expect((failure as FactoryError).reason).toBe('command_failed');
  expect(failure?.message).toBe('the tests did not pass');
});

test('a replacement that cannot be built leaves nothing behind', async () => {
  host.createFails = true;

  let failure: Error | null = null;
  try {
    await withSandboxRecovery(host, 'the-original', input, async () => {
      throw lost();
    });
  } catch (error) {
    failure = error as Error;
  }

  expect(failure?.message).toBe('daemon unavailable');
  expect(host.created).toHaveLength(0);
});

test('the replacement reads the same prompts and skills as the sandbox it replaces', async () => {
  await buildReplacement(host, input);

  // From the snapshot, so a skill edited since cannot reach this run (FR-044).
  expect(host.files.get('/work/.claude/agents/spec.md')).toBe(
    'Write docs/spec.md for Add Google OAuth sign-in on factory/142-add-google-oauth-sign-in.\n',
  );
  expect(host.files.get('/work/.claude/skills/house-style/SKILL.md')).toContain('Be brief.');
});

test('isSandboxLoss recognises only a lost sandbox', () => {
  expect(isSandboxLoss(new FactoryError('sandbox_lost', 'gone'))).toBe(true);
  expect(isSandboxLoss(new FactoryError('command_failed', 'exit 1'))).toBe(false);
  expect(isSandboxLoss(new Error('gone'))).toBe(false);
  expect(isSandboxLoss('sandbox_lost')).toBe(false);
});

/** FR-091 — a branch a previous attempt wrote to starts from a known state. */
test('a branch a previous attempt pushed is put back to the default branch', async () => {
  host.responses = [
    { match: 'git fetch', result: { exitCode: 0 } },
    {
      match: 'rev-parse refs/remotes/origin/factory/142',
      result: { exitCode: 0, stdout: 'old1234\n' },
    },
    { match: 'git checkout -B', result: { exitCode: 0, stdout: 'newhead5\n' } },
  ];

  const outcome = await resetRunBranch(host, 'container-1', snapshot, credentials.gitToken);

  expect(outcome.existedRemotely).toBe(true);
  // Where the previous attempt's work can still be found.
  expect(outcome.previousHead).toBe('old1234');
  expect(outcome.head).toBe('newhead5');
  // It reset to the default branch, not to the previous attempt's tip.
  expect(host.argvFor('git checkout -B')?.join(' ')).toContain(
    'git checkout -B factory/142-add-google-oauth-sign-in origin/main',
  );
});

test('a branch no previous attempt pushed needs no history to discard', async () => {
  host.responses = [
    { match: 'git fetch', result: { exitCode: 128, stderr: "couldn't find remote ref" } },
    { match: 'git checkout -B', result: { exitCode: 0, stdout: 'newhead5\n' } },
  ];

  const outcome = await resetRunBranch(host, 'container-1', snapshot, credentials.gitToken);
  expect(outcome.existedRemotely).toBe(false);
  expect(outcome.previousHead).toBeNull();
  expect(outcome.head).toBe('newhead5');
});

test('a reset that cannot happen is an error, not a silent carry-on', async () => {
  host.responses = [
    { match: 'git fetch', result: { exitCode: 0 } },
    { match: 'git checkout -B', result: { exitCode: 1, stderr: 'index is locked' } },
  ];

  let failure: Error | null = null;
  try {
    await resetRunBranch(host, 'container-1', snapshot, credentials.gitToken);
  } catch (error) {
    failure = error as Error;
  }
  expect(failure?.message).toBe(
    'could not put factory/142-add-google-oauth-sign-in back to main: index is locked',
  );
});

test('whether the branch already exists can be asked without changing it', async () => {
  host.responses = [{ match: 'ls-remote', result: { exitCode: 0, stdout: 'abc refs/heads/x' } }];
  expect(await branchExistsRemotely(host, 'container-1', snapshot, credentials.gitToken)).toBe(
    true,
  );
  // Asking changed nothing.
  expect(host.calls.every((c) => !c.argv.join(' ').includes('checkout'))).toBe(true);

  host.responses = [{ match: 'ls-remote', result: { exitCode: 2 } }];
  expect(await branchExistsRemotely(host, 'container-2', snapshot, credentials.gitToken)).toBe(
    false,
  );
});
