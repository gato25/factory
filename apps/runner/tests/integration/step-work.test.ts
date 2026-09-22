import { beforeEach, expect, test } from 'bun:test';
import { commitPaths } from '../../src/container/commit';
import { FakeHost } from '../fake-host';

/**
 * Every step's output goes onto the branch before the next step begins.
 *
 * A sandbox lives for hours; an approval checkpoint waits for however long a
 * person takes. A run that paused overnight came back to a destroyed sandbox
 * and the recovery path built a replacement — a fresh clone, because that
 * path resumes "from the last commit on the branch". Only the design step
 * had put anything there, so the specification and the plan written before
 * the gate were gone and the step after it reported, correctly, that its
 * inputs did not exist.
 */

let host: FakeHost;
beforeEach(() => {
  host = new FakeHost();
});

const script = () =>
  host.calls.map((call) => call.argv.join(' ')).find((joined) => joined.includes('git add')) ?? '';

test('a step with outputs commits exactly those paths', async () => {
  host.responses = [{ match: 'git add', result: { stdout: 'abc123\n' } }];
  const out = await commitPaths(host, 'c1', {
    paths: ['docs/spec.md'],
    subject: 'chore(#6): step 1 output',
    whatFailed: "step 1's output",
  });
  expect(out).toEqual({ committed: true, hash: 'abc123' });
  expect(script()).toContain('git add -- ');
  expect(script()).toContain('docs/spec.md');
  expect(script()).toContain('chore(#6): step 1 output');
});

test('a step that declared no outputs does not reach git at all', async () => {
  const out = await commitPaths(host, 'c1', {
    paths: [],
    subject: 'chore(#6): step 7 output',
    whatFailed: "step 7's output",
  });
  expect(out).toEqual({ committed: false, hash: null });
  expect(host.calls).toHaveLength(0);
});

test('a step whose output is already committed makes no empty commit', async () => {
  // The implementing agent commits once per task, so by the time this runs
  // there is nothing staged. `git diff --cached --quiet` is what turns that
  // into a no-op rather than an empty commit on every step.
  host.responses = [{ match: 'git add', result: { stdout: 'NOTHING_TO_COMMIT\n' } }];
  const out = await commitPaths(host, 'c1', {
    paths: ['docs/tasks.md'],
    subject: 'chore(#6): step 5 output',
    whatFailed: "step 5's output",
  });
  expect(out).toEqual({ committed: false, hash: null });
});

test('a declared output the step chose not to write does not fail the commit', async () => {
  // `git add` on a missing path exits non-zero. A conditional output is not
  // a reason to lose the outputs that WERE written.
  expect(script()).toBe('');
  host.responses = [{ match: 'git add', result: { stdout: 'def456\n' } }];
  await commitPaths(host, 'c1', {
    paths: ['docs/spec.md', 'docs/never-written.md'],
    subject: 'chore(#6): step 1 output',
    whatFailed: "step 1's output",
  });
  expect(script()).toContain('|| true');
});

test('a commit that genuinely fails says which step it was', async () => {
  host.responses = [{ match: 'git add', result: { exitCode: 1, stderr: 'index.lock exists' } }];
  let thrown: unknown;
  try {
    await commitPaths(host, 'c1', {
      paths: ['docs/plan.md'],
      subject: 'chore(#6): step 3 output',
      whatFailed: "step 3's output",
    });
  } catch (error) {
    thrown = error;
  }
  expect((thrown as Error)?.message).toContain("step 3's output");
  expect((thrown as Error)?.message).toContain('index.lock');
});

/**
 * A workspace built part-way through an attempt takes the run's branch from
 * the remote. Each step pushes what it produced precisely so a replacement
 * can pick it up, and `git checkout -B` was throwing that away: it resets
 * the branch to whatever is checked out, which is the default branch.
 */
test('a mid-attempt workspace fetches the run branch before checking it out', async () => {
  const { cloneRepository } = await import('../../src/container/start');
  const { snapshot } = await import('../fake-host');
  await cloneRepository(host, 'c1', snapshot, 'token', { adoptBranch: true });
  const script = host.calls.map((c) => c.argv.join(' ')).join('\n');
  expect(script).toContain('git fetch');
  expect(script).toContain('FETCH_HEAD');
  // And it still works on a first attempt, where the branch is not yet on
  // the remote: the fetch is allowed to fail and the branch starts from the
  // default one.
  expect(script).toContain('|| git checkout -B');
});

test('a workspace that begins an attempt starts the branch from the default one', async () => {
  const { cloneRepository } = await import('../../src/container/start');
  const { snapshot } = await import('../fake-host');
  await cloneRepository(host, 'c1', snapshot, 'token');
  const script = host.calls.map((c) => c.argv.join(' ')).join('\n');
  expect(script).not.toContain('git fetch');
  expect(script).toContain('git checkout -B');
});
