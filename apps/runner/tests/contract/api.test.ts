import { expect, test } from 'bun:test';
import { destroyRunWorkspace } from '../../src/container/destroy';
import { pushBranch, pushedWithoutMergeRequest } from '../../src/container/push';
import { buildEnvironment, pipelineNeedsDesign, secretValues } from '../../src/container/secrets';
import { startRunWorkspace } from '../../src/container/start';
import { credentials, FakeHost, snapshot } from '../fake-host';

/** contracts/runner.md — the four operations, and what each must guarantee. */

// --- 1. POST /runs/{run_id}/start ---

test('start creates one fresh non-root container with the configured ceilings', async () => {
  const host = new FakeHost();
  const { containerId } = await startRunWorkspace(host, {
    snapshot,
    credentials,
    sandbox: {
      image: 'code-factory/sandbox:latest',
      cpu: 2,
      memoryMb: 4096,
      wallClockMinutes: 45,
      // These fixtures run the standard pipeline, whose agent steps reach the
      // model from inside the sandbox; the isolated combination is refused.
      networkDuringImplement: true,
    },
  });
  expect(containerId).toBe('container-1');
  expect(host.created).toHaveLength(1);
  expect(host.created[0]).toMatchObject({
    image: 'code-factory/sandbox:latest',
    cpu: 2,
    memoryMb: 4096,
    wallClockMinutes: 45,
    network: true,
    workdir: '/work',
  });
});

test('credentials reach the container as environment, never as workspace files (FR-083)', async () => {
  const host = new FakeHost();
  await startRunWorkspace(host, {
    snapshot,
    credentials,
    sandbox: {
      image: 'i',
      cpu: 1,
      memoryMb: 512,
      wallClockMinutes: 10,
      networkDuringImplement: true,
    },
  });
  const env = host.created[0]?.env ?? {};
  expect(env.ANTHROPIC_API_KEY).toBe(credentials.modelKey);
  expect(env.GIT_TOKEN).toBe(credentials.gitToken);
  // Nothing written into the workspace may contain a credential.
  for (const [path, content] of host.files) {
    expect(content).not.toContain(credentials.gitToken);
    expect(content).not.toContain(credentials.modelKey);
    expect(path.startsWith('/work')).toBe(true);
  }
});

test('the design credential is supplied only to a pipeline that has a design step (FR-083a)', () => {
  expect(pipelineNeedsDesign(snapshot)).toBe(false);
  expect(buildEnvironment(snapshot, credentials).PEN_CLI_KEY).toBeUndefined();

  const withDesign = {
    ...snapshot,
    pipeline: {
      ...snapshot.pipeline,
      steps: [
        ...snapshot.pipeline.steps,
        { type: 'design' as const, condition: 'always' as const },
      ],
    },
  };
  expect(pipelineNeedsDesign(withDesign)).toBe(true);
  expect(
    buildEnvironment(withDesign, { ...credentials, designKey: 'pen_key_1234' }).PEN_CLI_KEY,
  ).toBe('pen_key_1234');
});

test('a design step with no credential fails at start, naming where to configure it (FR-083b)', () => {
  const withDesign = {
    ...snapshot,
    pipeline: {
      ...snapshot.pipeline,
      steps: [{ type: 'design' as const, condition: 'always' as const }],
    },
  };
  expect(() => buildEnvironment(withDesign, credentials)).toThrow(/Settings → Design/);
});

test('start clones the CURRENT default branch, then checks out the run branch (FR-048)', async () => {
  const host = new FakeHost();
  await startRunWorkspace(host, {
    snapshot,
    credentials,
    sandbox: {
      image: 'i',
      cpu: 1,
      memoryMb: 512,
      wallClockMinutes: 10,
      // These fixtures run the standard pipeline, whose agent steps reach the
      // model from inside the sandbox; the isolated combination is refused.
      networkDuringImplement: true,
    },
  });
  const clone = host.calls.map((c) => c.argv.join(' ')).find((s) => s.includes('git clone'));
  expect(clone).toContain('--branch main');
  expect(clone).toContain('git checkout -B factory/142-add-google-oauth-sign-in');
  // The stored remote must not keep the credential in it.
  expect(clone).toContain('git remote set-url origin');
});

test('a rejected token is reported as a credential problem, not a sandbox problem', async () => {
  const host = new FakeHost();
  host.responses = [
    { match: 'git clone', result: { exitCode: 128, stderr: 'fatal: Authentication failed' } },
  ];
  await expect(
    startRunWorkspace(host, {
      snapshot,
      credentials,
      sandbox: {
        image: 'i',
        cpu: 1,
        memoryMb: 512,
        wallClockMinutes: 10,
        // These fixtures run the standard pipeline, whose agent steps reach the
        // model from inside the sandbox; the isolated combination is refused.
        networkDuringImplement: true,
      },
    }),
  ).rejects.toThrow(/access token was rejected/);
  // And no half-prepared sandbox is left behind.
  expect(host.destroyed).toEqual(['container-1']);
});

test("agent prompts and skills are written with the run's values substituted (FR-037)", async () => {
  const host = new FakeHost();
  await startRunWorkspace(host, {
    snapshot,
    credentials,
    sandbox: {
      image: 'i',
      cpu: 1,
      memoryMb: 512,
      wallClockMinutes: 10,
      // These fixtures run the standard pipeline, whose agent steps reach the
      // model from inside the sandbox; the isolated combination is refused.
      networkDuringImplement: true,
    },
  });
  const prompt = host.files.get('/work/.claude/agents/spec.md');
  expect(prompt).toContain('Add Google OAuth sign-in');
  expect(prompt).toContain('factory/142-add-google-oauth-sign-in');
  expect(prompt).not.toContain('{{');
  expect(host.files.get('/work/.claude/skills/house-style/SKILL.md')).toContain('Be brief.');
  expect(host.files.get('/work/.factory/ticket.json')).toContain('#142');
});

// --- 3. POST /runs/{run_id}/verify-and-push ---

test('push runs NO tests of its own (FR-055a, FR-055b)', async () => {
  const host = new FakeHost();
  host.responses = [{ match: 'git log', result: { stdout: 'abc123 feat(#142): add button\n' } }];
  const outcome = await pushBranch(host, 'c1', snapshot, credentials.gitToken);
  expect(outcome.pushed).toBe(true);
  const commands = host.calls.map((c) => c.argv.join(' ')).join('\n');
  expect(commands).not.toMatch(/npm test|pytest|bun test|go test|make test/);
});

test('push reports the commits it put on the branch', async () => {
  const host = new FakeHost();
  host.responses = [
    {
      match: 'git log',
      result: { stdout: 'abc123 feat(#142): add button\ndef456 test(#142): cover it\n' },
    },
  ];
  const outcome = await pushBranch(host, 'c1', snapshot, credentials.gitToken);
  expect(outcome.pushed && outcome.commits).toEqual([
    { hash: 'abc123', subject: 'feat(#142): add button' },
    { hash: 'def456', subject: 'test(#142): cover it' },
  ]);
});

test('a rejected push is reported without discarding anything', async () => {
  const host = new FakeHost();
  host.responses = [
    { match: 'git push', result: { exitCode: 1, stderr: 'remote: 403 Forbidden' } },
  ];
  const outcome = await pushBranch(host, 'c1', snapshot, credentials.gitToken);
  expect(outcome.pushed).toBe(false);
  expect(outcome.pushed === false && outcome.reason).toMatch(/token was rejected/);
});

test('pushed-but-no-merge-request is distinguishable from total failure (FR-098)', () => {
  const error = pushedWithoutMergeRequest('provider answered 502');
  expect(error.message).toContain('branch was pushed');
  expect(error.message).toContain('code is safe on the branch');
});

// --- 4. DELETE /runs/{run_id} ---

test('a sandbox is released when the run ends (SC-012)', async () => {
  const host = new FakeHost();
  const result = await destroyRunWorkspace(host, 'c1', { outcome: 'done', retainFailedHours: 0 });
  expect(result.destroyed).toBe(true);
  expect(host.destroyed).toEqual(['c1']);
});

test('a failed run may be retained for diagnosis, then destroyed (FR-086)', async () => {
  const host = new FakeHost();
  const retained = await destroyRunWorkspace(host, 'c1', {
    outcome: 'failed',
    retainFailedHours: 24,
  });
  expect(retained.destroyed).toBe(false);
  expect(retained.retainedUntil).toBeDefined();
  expect(host.destroyed).toEqual([]);

  // With retention off, even a failure is released.
  await destroyRunWorkspace(host, 'c2', { outcome: 'failed', retainFailedHours: 0 });
  expect(host.destroyed).toEqual(['c2']);
});

test('every secret in play is offered to the redactor (Principle V)', () => {
  expect(secretValues(credentials)).toEqual([credentials.gitToken, credentials.modelKey]);
  expect(secretValues({ ...credentials, designKey: 'pen_1234' })).toHaveLength(3);
});
