import { beforeEach, expect, test } from 'bun:test';
import type { Callback, Step } from '@factory/shared';
import {
  callbackSender,
  destroyRun,
  fetchCredentials,
  memoryStore,
  runStep,
  startRun,
  verifyAndPush,
} from '../../src/runs';
import { credentials, FakeHost, snapshot } from '../fake-host';

/**
 * The four operations in contracts/runner.md, driven without a server. What
 * matters here is the sequencing: a step cannot run before a sandbox exists,
 * a step is dispatched by type and nothing else, and the credential values
 * come from the app rather than through the orchestrator (FR-083).
 */

let host: FakeHost;
let store: ReturnType<typeof memoryStore>;
let sent: Callback[];

const sandbox = {
  image: 'factory/runner:1',
  cpu: 2,
  memoryMb: 4096,
  wallClockMinutes: 60,
  networkDuringImplement: false,
};
const context = () => ({ snapshot, credentials, sandbox });
const send = async (callback: Callback) => {
  sent.push(callback);
};

beforeEach(() => {
  host = new FakeHost();
  store = memoryStore();
  sent = [];
  host.files.set('/work/docs/spec.md', '# Spec');
  host.responses = [{ match: 'claude', result: { stdout: '{"total_cost_usd":0.42}' } }];
});

test('start creates one sandbox and remembers it', async () => {
  const result = await startRun(host, store, context());

  expect(result.container_id).toBe('container-1');
  expect(host.created).toHaveLength(1);
  expect(host.created[0]?.workdir).toBe('/work');
  // Non-root, with the configured ceilings (FR-046, FR-085).
  expect(host.created[0]?.cpu).toBe(2);
  expect(host.created[0]?.wallClockMinutes).toBe(60);
  expect(host.created[0]?.network).toBe(false);
  expect(store.get(snapshot.run_id)?.containerId).toBe('container-1');
});

test('start writes each agent prompt and skill into the workspace (FR-037)', async () => {
  await startRun(host, store, context());
  expect(host.files.get('/work/.claude/agents/spec.md')).toContain('Add Google OAuth sign-in');
  expect(host.files.get('/work/.claude/skills/house-style/SKILL.md')).toContain('Be brief.');
});

test('a second attempt brings the branch back to a known state (FR-091)', async () => {
  host.responses = [
    { match: 'git fetch', result: { exitCode: 0 } },
    { match: 'rev-parse refs/remotes', result: { exitCode: 0, stdout: 'old123\n' } },
    { match: 'git checkout -B', result: { exitCode: 0, stdout: 'new456\n' } },
  ];
  await startRun(host, store, { ...context(), snapshot: { ...snapshot, attempt: 2 } });

  // The reset points the branch at the default branch, not at whatever the
  // previous attempt left. The clone also runs a `checkout -B`, so the
  // assertion names the reset's own form.
  expect(
    host.calls.some((call) =>
      call.argv
        .join(' ')
        .includes("git checkout -B 'factory/142-add-google-oauth-sign-in' 'origin/main'"),
    ),
  ).toBe(true);
});

test('a first attempt does not reset anything', async () => {
  await startRun(host, store, context());
  expect(
    host.calls.some((call) => call.argv.join(' ').includes('refs/remotes/origin/factory')),
  ).toBe(false);
});

test('a step before a sandbox exists is refused, not attempted', async () => {
  let refused: Error | null = null;
  try {
    await runStep(
      host,
      store,
      snapshot.run_id,
      0,
      { step: snapshot.pipeline.steps[0] as Step },
      send,
    );
  } catch (error) {
    refused = error as Error;
  }
  expect(refused?.message).toContain('no sandbox');
  expect(host.calls).toHaveLength(0);
});

test('a step reports it started, streams its output, and returns its outcome', async () => {
  await startRun(host, store, context());
  host.responses.unshift({
    match: 'claude',
    result: { stdout: 'thinking…\n{"total_cost_usd":0.42,"num_turns":3}' },
  });

  const outcome = await runStep(
    host,
    store,
    snapshot.run_id,
    0,
    { step: snapshot.pipeline.steps[0] as Step },
    send,
  );

  expect(outcome.status).toBe('done');
  expect(outcome.costUsd).toBe('0.4200');
  expect(sent.some((callback) => callback.event === 'step_started')).toBe(true);
  expect(sent.some((callback) => callback.event === 'log_chunk')).toBe(true);
});

test('a shell step is dispatched by type, with no agent needed', async () => {
  await startRun(host, store, context());
  host.responses.unshift({ match: 'bun test', result: { stdout: '12 pass\n' } });

  const outcome = await runStep(
    host,
    store,
    snapshot.run_id,
    1,
    { step: { type: 'shell', condition: 'always', command: 'bun test' } },
    send,
  );
  expect(outcome.status).toBe('done');
  expect(outcome.costUsd).toBe('0.0000');
});

test("a checkpoint is not the Runner's to run", async () => {
  await startRun(host, store, context());
  let refused: Error | null = null;
  try {
    await runStep(
      host,
      store,
      snapshot.run_id,
      1,
      { step: { type: 'checkpoint', condition: 'always', approvers: 'anyone' } },
      send,
    );
  } catch (error) {
    refused = error as Error;
  }
  expect(refused?.message).toContain("not the Runner's to run");
});

test('a step naming an agent the run has no definition for is refused', async () => {
  await startRun(host, store, context());
  let refused: Error | null = null;
  try {
    await runStep(
      host,
      store,
      snapshot.run_id,
      0,
      { step: { type: 'agent', condition: 'always', agent_id: 'nobody' } },
      send,
    );
  } catch (error) {
    refused = error as Error;
  }
  expect(refused?.message).toContain('no definition for');
});

test('a classification is reported as its own event (FR-099)', async () => {
  await startRun(host, store, context());
  host.files.set(
    '/work/docs/spec.md',
    '# Spec\n\n```factory\nhas_ui: true\nrationale: A button appears.\n```',
  );

  await runStep(
    host,
    store,
    snapshot.run_id,
    0,
    { step: snapshot.pipeline.steps[0] as Step },
    send,
  );

  const classified = sent.find((callback) => callback.event === 'ticket_classified');
  expect(classified).toMatchObject({ has_ui: true, rationale: 'A button appears.' });
});

test('a credential printed by a step never reaches a log chunk', async () => {
  await startRun(host, store, context());
  host.responses.unshift({
    match: 'claude',
    result: { stdout: `pushing with ${credentials.gitToken}\n{"total_cost_usd":0.1}` },
  });

  await runStep(
    host,
    store,
    snapshot.run_id,
    0,
    { step: snapshot.pipeline.steps[0] as Step },
    send,
  );

  const text = sent
    .filter((callback) => callback.event === 'log_chunk')
    .map((callback) => (callback as { text: string }).text)
    .join('');
  expect(text).not.toContain(credentials.gitToken);
});

test('verify-and-push runs no tests of its own (FR-055a, FR-055b)', async () => {
  await startRun(host, store, context());
  host.responses.unshift({ match: 'git push', result: { exitCode: 0 } });
  host.responses.unshift({ match: 'git log', result: { stdout: 'abc1 first\ndef2 second\n' } });

  const outcome = await verifyAndPush(host, store, snapshot.run_id);
  expect(outcome.pushed).toBe(true);

  // Nothing that looks like a test command was run.
  const commands = host.calls.map((call) => call.argv.join(' ')).join(' | ');
  expect(commands).not.toContain('bun test');
  expect(commands).not.toContain('npm test');
  expect(commands).not.toContain('pytest');
});

test('a second attempt pushes with a lease rather than blindly (FR-091)', async () => {
  await startRun(host, store, { ...context(), snapshot: { ...snapshot, attempt: 2 } });
  host.responses.unshift({ match: 'git push', result: { exitCode: 0 } });
  await verifyAndPush(host, store, snapshot.run_id);

  const push = host.calls.find((call) => call.argv.join(' ').includes('git push'));
  expect(push?.argv.join(' ')).toContain('--force-with-lease');
});

test('destroy releases the sandbox and forgets the run (SC-012)', async () => {
  await startRun(host, store, context());
  const result = await destroyRun(host, store, snapshot.run_id, { outcome: 'done' });

  expect(result.released).toBe(true);
  expect(host.destroyed).toEqual(['container-1']);
  expect(store.get(snapshot.run_id)).toBeUndefined();
});

test("a failed run's sandbox is retained for the configured window (FR-086)", async () => {
  await startRun(host, store, context());
  const result = await destroyRun(host, store, snapshot.run_id, {
    outcome: 'failed',
    retainFailedHours: 4,
  });

  expect(result.released).toBe(false);
  expect(result.retainedUntil).toBeTruthy();
  expect(host.destroyed).toEqual([]);
  // Still this run's, so whatever sweeps it up has the container id.
  expect(store.get(snapshot.run_id)?.containerId).toBe('container-1');
});

test('destroying a run with no sandbox is a no-op, not an error', async () => {
  expect(await destroyRun(host, store, 'never-started')).toEqual({
    released: false,
    retainedUntil: undefined,
  });
});

// --- the credential exchange (FR-083) ---

test('credentials come from the app, authenticated with the run secret', async () => {
  const seen: { url: string; auth: string | undefined }[] = [];
  const resolved = await fetchCredentials(snapshot, async (url, init) => {
    seen.push({ url, auth: (init?.headers as Record<string, string>)?.authorization });
    return Response.json({
      credentials: { gitToken: 'glpat-x', modelKey: 'sk-y' },
    });
  });

  expect(resolved).toEqual({ gitToken: 'glpat-x', modelKey: 'sk-y' });
  expect(seen[0]?.url).toBe(`https://factory.example/api/runs/${snapshot.run_id}/credentials`);
  expect(seen[0]?.auth).toBe(`Bearer ${snapshot.resume_secret}`);
});

test('a refused exchange fails the start rather than proceeding without them', async () => {
  let refused: Error | null = null;
  try {
    await fetchCredentials(snapshot, async () =>
      Response.json({ error: 'unauthorised' }, { status: 401 }),
    );
  } catch (error) {
    refused = error as Error;
  }
  expect(refused?.message).toBe('unauthorised');
});

test('an exchange returning nothing usable is refused rather than half-used', async () => {
  let refused: Error | null = null;
  try {
    await fetchCredentials(snapshot, async () => Response.json({ credentials: { gitToken: 'x' } }));
  } catch (error) {
    refused = error as Error;
  }
  expect(refused?.message).toContain('no usable credentials');
});

test('a callback that cannot be delivered does not fail the step that produced it', async () => {
  const sender = callbackSender(snapshot, async () => {
    throw new Error('the app is down');
  });
  // It resolves rather than throwing: a lost log chunk is not a failed step.
  await sender({
    run_id: snapshot.run_id,
    attempt: 1,
    step_index: 0,
    event: 'step_started',
  } as Callback);
});
