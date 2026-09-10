import { expect, test } from 'bun:test';
import type { Step, StepOutcome } from '@factory/shared';
import { buildArgv, buildPrompt, runClaudeStep } from '../../src/engines/claude-cli';
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
