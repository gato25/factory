import { expect, test } from 'bun:test';
import type { Step, StepOutcome } from '@factory/shared';
import { buildArgv, buildPrompt, runClaudeStep } from '../../src/engines/claude-cli';
import {
  buildDesignArgv,
  designConfig,
  runDesignStep,
  screenName,
} from '../../src/engines/design-cli';
import { runShellStep } from '../../src/engines/shell';
import { addCosts, normaliseCost, usageFromClaudeJson } from '../../src/engines/usage';
import { LogSink } from '../../src/stream/logs';
import { credentials, FakeHost, snapshot } from '../fake-host';

/**
 * contracts/step-engines.md — one interface, several implementations. These
 * are the obligations EVERY engine carries, asserted against each of them, so
 * a new engine cannot quietly skip one (Constitution Principle II).
 */

const agent = snapshot.agents[0]!;
const agentStep = snapshot.pipeline.steps[0] as Step;
const shellStep: Step = { type: 'shell', condition: 'always', command: 'bun test' };
const designStep: Step = { type: 'design', condition: 'ticket_has_ui' };
const designAgent = {
  ...snapshot.agents[0]!,
  name: 'Design',
  engine: 'design_cli' as const,
  model: 'pen-default',
  allowed_tools: [],
};

/** A host where the design tool succeeds and leaves what it was asked to. */
function designingHost(screens = ['00-login.png', '01-callback.png']) {
  const host = new FakeHost();
  host.files.set('/work/docs/design/ui.pen', '{"version":"2.17"}');
  host.files.set('/work/.factory/design-usage.json', '{"cost_usd":0.31,"duration_ms":41000}');
  host.responses = [{ match: 'ls -1', result: { stdout: `${screens.join('\n')}\n` } }];
  return host;
}

function runDesign(host: FakeHost, logs: LogSink, extra: Record<string, unknown> = {}) {
  return runDesignStep(host, {
    step: designStep,
    snapshot,
    agent: designAgent,
    containerId: 'c1',
    logs,
    ...extra,
  });
}

function sink(secrets: string[] = []) {
  const chunks: { seq: number; stream: string; text: string }[] = [];
  return {
    chunks,
    logs: new LogSink({
      secrets,
      send: (c) => {
        chunks.push(c);
      },
    }),
  };
}

// --- obligation: stream output while running (FR-076, FR-107) ---

test('the agent engine streams its output as it arrives', async () => {
  const host = new FakeHost();
  host.files.set('/work/docs/spec.md', '# Spec');
  host.responses = [{ match: 'claude', result: { stdout: 'thinking…\nwrote docs/spec.md\n' } }];
  const { chunks, logs } = sink();
  await runClaudeStep(host, { step: agentStep, snapshot, agent, containerId: 'c1', logs });
  expect(chunks.length).toBeGreaterThan(0);
  expect(chunks.map((c) => c.text).join('')).toContain('wrote docs/spec.md');
});

test('the shell engine streams its output too', async () => {
  const host = new FakeHost();
  host.responses = [{ match: 'bun test', result: { stdout: '12 pass 0 fail\n' } }];
  const { chunks, logs } = sink();
  await runShellStep(host, { step: shellStep, containerId: 'c1', logs });
  expect(chunks.map((c) => c.text).join('')).toContain('12 pass');
});

test('the design engine streams its output, naming the command (FR-107)', async () => {
  const host = designingHost();
  host.responses.unshift({ match: 'pen', result: { stdout: 'drawing 00-login…\n' } });
  const { chunks, logs } = sink();
  await runDesign(host, logs);

  const text = chunks.map((c) => c.text).join('');
  // On the same terms as an agent step: the command, then its output.
  expect(text).toContain('$ pen ');
  expect(text).toContain('drawing 00-login…');
});

// --- obligation: redact at ingest, never at display (Principle V) ---

test('a credential printed by any engine never reaches a log chunk', async () => {
  const host = new FakeHost();
  host.files.set('/work/docs/spec.md', '# Spec');
  host.responses = [{ match: 'claude', result: { stdout: `using ${credentials.gitToken}\n` } }];
  const { chunks, logs } = sink([credentials.gitToken]);
  await runClaudeStep(host, { step: agentStep, snapshot, agent, containerId: 'c1', logs });
  const all = chunks.map((c) => c.text).join('');
  expect(all).not.toContain(credentials.gitToken);
  expect(all).toContain('[redacted]');
});

test('a credential split across two writes is still redacted, because chunks break on lines', () => {
  const { chunks, logs } = sink([credentials.gitToken]);
  logs.write('stdout', `token is ${credentials.gitToken.slice(0, 10)}`);
  logs.write('stdout', `${credentials.gitToken.slice(10)}\n`);
  logs.end();
  const all = chunks.map((c) => c.text).join('');
  expect(all).not.toContain(credentials.gitToken);
});

test('a credential printed by the design tool never reaches a log chunk', async () => {
  const host = designingHost();
  host.responses.unshift({
    match: 'pen',
    result: { stdout: `POST /v1/designs key=${credentials.designKey ?? 'pen-live-abc123'}\n` },
  });
  const { chunks, logs } = sink([credentials.gitToken, 'pen-live-abc123']);
  await runDesign(host, logs);
  expect(chunks.map((c) => c.text).join('')).not.toContain('pen-live-abc123');
});

/**
 * A step's failure detail is retained and shown to a person, so it is step
 * output in every sense FR-084 means. Every engine must redact it, not only
 * the chunks it streamed.
 */
test('a credential in stderr never reaches a failure detail, in any engine', async () => {
  const secret = credentials.modelKey;

  const agentHost = new FakeHost();
  agentHost.responses = [{ match: 'claude', result: { exitCode: 1, stderr: `auth ${secret}` } }];
  const agentOutcome = await runClaudeStep(agentHost, {
    step: agentStep,
    snapshot,
    agent,
    containerId: 'c1',
    logs: sink([secret]).logs,
  });
  expect(agentOutcome.error?.detail ?? '').not.toContain(secret);
  expect(agentOutcome.error?.detail ?? '').toContain('[redacted]');

  const shellHost = new FakeHost();
  shellHost.responses = [{ match: 'bun test', result: { exitCode: 1, stderr: `token ${secret}` } }];
  const shellOutcome = await runShellStep(shellHost, {
    step: shellStep,
    containerId: 'c1',
    logs: sink([secret]).logs,
  });
  expect(shellOutcome.error?.detail ?? '').not.toContain(secret);

  const designHost = designingHost();
  designHost.responses.unshift({
    match: 'pen',
    result: { exitCode: 1, stderr: `key ${secret}` },
  });
  const designOutcome = await runDesign(designHost, sink([secret]).logs);
  expect(designOutcome.error?.detail ?? '').not.toContain(secret);
});

// --- obligation: cost comes from the engine's own usage, never an estimate ---

test('the agent engine reports the cost the CLI reported', async () => {
  const host = new FakeHost();
  host.files.set('/work/docs/spec.md', '# Spec');
  host.responses = [
    {
      match: 'claude',
      result: {
        stdout: JSON.stringify({
          total_cost_usd: 0.4237,
          duration_ms: 12_000,
          session_id: 'sess_1',
          num_turns: 5,
        }),
      },
    },
  ];
  const { logs } = sink();
  const outcome = await runClaudeStep(host, {
    step: agentStep,
    snapshot,
    agent,
    containerId: 'c1',
    logs,
  });
  expect(outcome.costUsd).toBe('0.4237');
  expect(outcome.sessionId).toBe('sess_1');
  expect(outcome.durationS).toBe(12);
});

test('unreadable usage is zero, never a guess — a guess would be enforced against a ceiling', () => {
  expect(usageFromClaudeJson('not json at all').costUsd).toBe('0.0000');
  expect(normaliseCost(undefined)).toBe('0.0000');
  expect(normaliseCost(-5)).toBe('0.0000');
  expect(normaliseCost('0.5')).toBe('0.5000');
});

test('the design engine reports the cost the tool reported, against the same budget (FR-108)', async () => {
  const host = designingHost();
  const { logs } = sink();
  const outcome = await runDesign(host, logs);

  // The tool's own number, in the same four-decimal form the ledger stores.
  expect(outcome.costUsd).toBe('0.3100');
  expect(outcome.durationS).toBe(41);
});

test('a design tool that reports no usage costs zero, never a guess', async () => {
  const host = designingHost();
  host.files.delete('/work/.factory/design-usage.json');
  const { logs } = sink();
  expect((await runDesign(host, logs)).costUsd).toBe('0.0000');
});

test('a shell step costs nothing, because no model ran', async () => {
  const host = new FakeHost();
  const { logs } = sink();
  const outcome = await runShellStep(host, { step: shellStep, containerId: 'c1', logs });
  expect(outcome.costUsd).toBe('0.0000');
});

test('costs add without floating-point drift', () => {
  expect(addCosts('0.1000', '0.1000', '0.1000', '0.1000')).toBe('0.4000');
});

// --- obligation: a failure is reported, with its detail retained ---

test('a non-zero exit fails the step and keeps the error detail (FR-055c)', async () => {
  const host = new FakeHost();
  host.responses = [
    { match: 'bun test', result: { exitCode: 1, stderr: '3 tests failed in cart.test.ts' } },
  ];
  const { logs } = sink();
  const outcome = await runShellStep(host, { step: shellStep, containerId: 'c1', logs });
  expect(outcome.status).toBe('failed');
  expect(outcome.error?.detail).toContain('3 tests failed in cart.test.ts');
  expect(outcome.error?.detail).toContain('`bun test` exited 1');
});

test('a missing declared output fails the agent step even when the CLI succeeded (FR-051)', async () => {
  const host = new FakeHost(); // docs/spec.md deliberately absent
  host.responses = [
    { match: 'claude', result: { stdout: JSON.stringify({ total_cost_usd: 0.2 }) } },
  ];
  const { logs } = sink();
  const outcome = await runClaudeStep(host, {
    step: agentStep,
    snapshot,
    agent,
    containerId: 'c1',
    logs,
  });
  expect(outcome.status).toBe('failed');
  expect(outcome.error?.reason).toBe('missing_output');
  // The cost already incurred is still reported — the work happened.
  expect(outcome.costUsd).toBe('0.2000');
});

test('a design step that exported no screen fails, keeping what it produced (FR-104)', async () => {
  const host = designingHost([]);
  const { logs } = sink();
  const outcome = await runDesign(host, logs);

  expect(outcome.status).toBe('failed');
  expect(outcome.error?.reason).toBe('missing_output');
  expect(outcome.error?.detail).toContain('exported no screen');
  // The source it did write is retained for inspection.
  expect(outcome.outputs).toEqual([
    { kind: 'design_file', path: 'docs/design/ui.pen', version: 1 },
  ]);
});

test('a design step with screens but no source fails, keeping the screens (FR-104)', async () => {
  const host = designingHost();
  host.files.delete('/work/docs/design/ui.pen');
  const { logs } = sink();
  const outcome = await runDesign(host, logs);

  expect(outcome.status).toBe('failed');
  expect(outcome.error?.detail).toContain('no editable design source');
  expect(outcome.outputs.map((o) => o.path)).toEqual([
    'docs/design/screens/00-login.png',
    'docs/design/screens/01-callback.png',
  ]);
});

test('a rejected design credential says where it is configured (FR-083b)', async () => {
  const host = designingHost();
  host.responses.unshift({
    match: 'pen',
    result: { exitCode: 1, stderr: 'HTTP 401 Unauthorized' },
  });
  const { logs } = sink();
  const outcome = await runDesign(host, logs);

  expect(outcome.status).toBe('failed');
  expect(outcome.error?.reason).toBe('credential_invalid');
  expect(outcome.error?.detail).toContain('Settings → Design');
});

test('a shell step with no command fails rather than passing vacuously', async () => {
  const host = new FakeHost();
  const { logs } = sink();
  const outcome = await runShellStep(host, {
    step: { type: 'shell', condition: 'always' },
    containerId: 'c1',
    logs,
  });
  expect(outcome.status).toBe('failed');
  expect(outcome.error?.detail).toContain('no command');
});

// --- obligation: an agent cannot reach a tool it was not permitted (FR-039) ---

test('only permitted tools are passed to the CLI', () => {
  const argv = buildArgv(
    { step: agentStep, snapshot, agent, containerId: 'c1', logs: sink().logs },
    'prompt',
  );
  expect(argv).toContain('--allowedTools');
  expect(argv[argv.indexOf('--allowedTools') + 1]).toBe('Read,Write');
  expect(argv).toContain('--model');
  expect(argv[argv.indexOf('--model') + 1]).toBe('claude-sonnet-5');
  expect(argv).toContain('--max-turns');
});

test('a design-engine agent is given no tool permissions at all (FR-036a)', () => {
  const designAgent = { ...agent, engine: 'design_cli' as const, allowed_tools: [] };
  const argv = buildArgv(
    { step: agentStep, snapshot, agent: designAgent, containerId: 'c1', logs: sink().logs },
    'prompt',
  );
  expect(argv).not.toContain('--allowedTools');
});

// --- obligation: the ceiling is passed down so the process can be killed (FR-080) ---

test('a design time limit becomes a timeout on the invocation too', async () => {
  const host = designingHost();
  const { logs } = sink();
  await runDesign(host, logs, { agent: { ...designAgent, limits: { max_minutes: 4 } } });
  const call = host.calls.find((c) => c.argv[0] === 'pen');
  expect(call?.options?.timeoutMs).toBe(240_000);
});

test('an agent time limit becomes a timeout on the invocation', async () => {
  const host = new FakeHost();
  host.files.set('/work/docs/spec.md', '# Spec');
  host.responses = [{ match: 'claude', result: { stdout: '{}' } }];
  const { logs } = sink();
  await runClaudeStep(host, {
    step: agentStep,
    snapshot,
    agent: { ...agent, limits: { ...agent.limits, max_minutes: 3 } },
    containerId: 'c1',
    logs,
  });
  const call = host.calls.find((c) => c.argv.includes('claude'));
  expect(call?.options?.timeoutMs).toBe(180_000);
});

// --- the prompt names inputs and outputs, and carries feedback and screens ---

test('the step prompt names the files to produce', () => {
  const prompt = buildPrompt({
    step: agentStep,
    snapshot,
    agent,
    containerId: 'c1',
    logs: sink().logs,
  });
  expect(prompt).toContain('#142');
  expect(prompt).toContain('docs/spec.md');
});

test('change-request feedback reaches the agent that runs again (FR-038)', () => {
  const prompt = buildPrompt({
    step: agentStep,
    snapshot,
    agent,
    containerId: 'c1',
    logs: sink().logs,
    feedback: 'The plan misses the callback screen.',
  });
  expect(prompt).toContain('reviewer requested changes');
  expect(prompt).toContain('misses the callback screen');
});

test('screens reach the steps that follow a design step (FR-109)', () => {
  const prompt = buildPrompt({
    step: agentStep,
    snapshot,
    agent,
    containerId: 'c1',
    logs: sink().logs,
    designScreens: ['docs/design/screens/00-login.png'],
  });
  expect(prompt).toContain('00-login.png');
  expect(prompt).toContain('Build the interface to match');
});

test('every outcome satisfies the StepOutcome shape', async () => {
  const host = new FakeHost();
  const { logs } = sink();
  const outcome: StepOutcome = await runShellStep(host, {
    step: shellStep,
    containerId: 'c1',
    logs,
  });
  expect(['done', 'failed']).toContain(outcome.status);
  expect(outcome.costUsd).toMatch(/^\d+\.\d{4}$/);
  expect(typeof outcome.durationS).toBe('number');
  expect(Array.isArray(outcome.outputs)).toBe(true);
});

// --- obligations specific to the design engine ---

test('the design step writes its source and screens where the config says (FR-103)', async () => {
  const host = designingHost();
  const { logs } = sink();
  const outcome = await runDesign(host, logs);

  const argv = host.calls.find((c) => c.argv[0] === 'pen')?.argv ?? [];
  expect(argv).toContain('--source');
  expect(argv[argv.indexOf('--source') + 1]).toBe('docs/design/ui.pen');
  expect(argv[argv.indexOf('--export-dir') + 1]).toBe('docs/design/screens');
  expect(argv[argv.indexOf('--export-scale') + 1]).toBe('2');

  expect(outcome.status).toBe('done');
  expect(outcome.outputs).toEqual([
    { kind: 'design_file', path: 'docs/design/ui.pen', version: 1 },
    {
      kind: 'screen',
      path: 'docs/design/screens/00-login.png',
      version: 1,
      screen_name: 'login',
    },
    {
      kind: 'screen',
      path: 'docs/design/screens/01-callback.png',
      version: 1,
      screen_name: 'callback',
    },
  ]);
});

test('a step config overrides the defaults rather than being ignored', () => {
  const configured: Step = {
    type: 'design',
    condition: 'always',
    design: {
      source_path: 'design/app.pen',
      export_dir: 'design/out',
      export_scale: 3,
      screens: ['Sign in', 'Callback'],
    },
  };
  expect(designConfig(configured)).toEqual({
    source_path: 'design/app.pen',
    export_dir: 'design/out',
    export_scale: 3,
    screens: ['Sign in', 'Callback'],
  });
  const argv = buildDesignArgv(
    { step: configured, snapshot, agent: designAgent, containerId: 'c1', logs: sink().logs },
    false,
  );
  expect(argv[argv.indexOf('--screens') + 1]).toBe('Sign in,Callback');
});

/**
 * FR-106 — the existing source is revised, not replaced. This is what keeps a
 * reviewer's earlier accepted work from being silently redrawn.
 */
test('an existing design source is revised, not started from an empty canvas', async () => {
  const host = designingHost();
  const { logs } = sink();
  const outcome = await runDesign(host, logs);

  expect(host.calls.find((c) => c.argv[0] === 'pen')?.argv[1]).toBe('revise');
  expect(outcome.summary).toContain('Revised');
});

test('a first run with no source creates one', async () => {
  const host = designingHost();
  host.files.delete('/work/docs/design/ui.pen');
  // It writes the source during the run, so the check must happen first.
  host.responses.unshift({
    match: 'pen create',
    result: { stdout: 'created\n' },
  });
  const { logs } = sink();
  await runDesign(host, logs);
  expect(host.calls.find((c) => c.argv[0] === 'pen')?.argv[1]).toBe('create');
});

test("a reviewer's feedback reaches the design tool as a brief (FR-061a, FR-038)", async () => {
  const host = designingHost();
  const { logs } = sink();
  await runDesign(host, logs, { feedback: 'The sign-in button is below the fold.' });

  const brief = host.files.get('/work/.factory/design-brief.md') ?? '';
  expect(brief).toContain('Requested changes');
  expect(brief).toContain('The sign-in button is below the fold.');
  // And the ticket it is designing for, so a revision is not context-free.
  expect(brief).toContain('Add Google OAuth sign-in');
  expect(brief).toContain('A Google button appears');
});

test('the design source and the screens are committed to the branch (FR-105)', async () => {
  const host = designingHost();
  host.responses.unshift({ match: 'git add', result: { stdout: 'abc1234\n' } });
  const { logs } = sink();
  await runDesign(host, logs);

  const commit = host.calls.find((c) => c.argv.join(' ').includes('git add'));
  const script = commit?.argv.join(' ') ?? '';
  // The paths as arguments, not as quoted text — see design-outputs.test.ts.
  expect(script).toContain('git add -- ');
  expect(script).toContain('docs/design/ui.pen');
  expect(script).toContain('docs/design/screens/00-login.png');
  expect(script).toContain('git commit -m');
  // A re-run with nothing changed must not make an empty commit.
  expect(script).toContain('git diff --cached --quiet');
});

test('a screen name comes from its file name, without the ordering prefix', () => {
  expect(screenName('docs/design/screens/00-sign-in.png')).toBe('sign in');
  expect(screenName('docs/design/screens/12_reset_password.webp')).toBe('reset password');
  expect(screenName('anywhere/else.png')).toBe('else');
});

test('the design brief is a file, so it carries no credential', async () => {
  const host = designingHost();
  const { logs } = sink();
  await runDesign(host, logs);
  const argv = host.calls.find((c) => c.argv[0] === 'pen')?.argv ?? [];
  // The brief is referenced by path; nothing secret is on the command line.
  expect(argv).toContain('--brief');
  for (const secret of [credentials.gitToken, credentials.modelKey]) {
    expect(argv.join(' ')).not.toContain(secret);
  }
});

test('every design outcome satisfies the StepOutcome shape too', async () => {
  const host = designingHost();
  const { logs } = sink();
  const outcome: StepOutcome = await runDesign(host, logs);
  expect(['done', 'failed']).toContain(outcome.status);
  expect(outcome.costUsd).toMatch(/^\d+\.\d{4}$/);
  expect(typeof outcome.durationS).toBe('number');
  expect(Array.isArray(outcome.outputs)).toBe(true);
});
