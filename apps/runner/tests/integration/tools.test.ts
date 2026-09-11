import { beforeEach, expect, test } from 'bun:test';
import type { SnapshotAgent, Step } from '@factory/shared';
import { buildArgv, runClaudeStep } from '../../src/engines/claude-cli';
import { LogSink } from '../../src/stream/logs';
import { FakeHost, snapshot } from '../fake-host';

/**
 * FR-039 — an agent must not be able to take an action requiring a tool it
 * has not been permitted. The mechanism is the CLI's own allowlist: what is
 * not passed is not available, so withholding is enforced by the tool rather
 * than asked for in a prompt.
 *
 * That distinction is the whole point. A prompt saying "do not run commands"
 * is a request; an allowlist without Bash is a wall.
 */

let host: FakeHost;

function sink() {
  const chunks: { seq: number; stream: string; text: string }[] = [];
  return {
    chunks,
    logs: new LogSink({
      send: (c) => {
        chunks.push(c);
      },
    }),
  };
}

const agentWith = (tools: string[]): SnapshotAgent => ({
  ...(snapshot.agents[0] as SnapshotAgent),
  allowed_tools: tools,
});

const step = snapshot.pipeline.steps[0] as Step;

function toolsPassedTo(argv: string[]): string[] {
  const at = argv.indexOf('--allowedTools');
  return at === -1 ? [] : (argv[at + 1]?.split(',') ?? []);
}

beforeEach(() => {
  host = new FakeHost();
  host.files.set('/work/docs/spec.md', '# Spec');
  host.responses = [{ match: 'claude', result: { stdout: '{"total_cost_usd":0.1}' } }];
});

test('exactly the permitted tools are passed, and nothing else', () => {
  const argv = buildArgv(
    { step, snapshot, agent: agentWith(['Read', 'Write']), containerId: 'c1', logs: sink().logs },
    'prompt',
  );
  expect(toolsPassedTo(argv)).toEqual(['Read', 'Write']);
  // Not merely absent from a list — absent from the invocation entirely.
  expect(argv.join(' ')).not.toContain('Bash');
  expect(argv.join(' ')).not.toContain('GitPush');
});

test('an agent permitted nothing is passed no allowlist rather than an empty one', () => {
  // An empty --allowedTools would be read by the CLI as a filter it cannot
  // satisfy; the flag is omitted, and the agent's own configuration is what
  // says it may do nothing.
  const argv = buildArgv(
    { step, snapshot, agent: agentWith([]), containerId: 'c1', logs: sink().logs },
    'prompt',
  );
  expect(argv).not.toContain('--allowedTools');
});

test('a design-engine agent is passed no tool permissions at all (FR-036a)', () => {
  const designAgent: SnapshotAgent = {
    ...agentWith(['Read', 'Bash']),
    engine: 'design_cli',
  };
  const argv = buildArgv(
    { step, snapshot, agent: designAgent, containerId: 'c1', logs: sink().logs },
    'prompt',
  );
  // The snapshot already empties them, and the invocation carries none.
  expect(argv).not.toContain('--allowedTools');
});

test('the prompt does not substitute for the allowlist', async () => {
  const { logs } = sink();
  await runClaudeStep(host, {
    step,
    snapshot,
    agent: agentWith(['Read']),
    containerId: 'c1',
    logs,
  });

  const call = host.calls.find((c) => c.argv[0] === 'claude');
  const prompt = call?.argv[call.argv.indexOf('-p') + 1] ?? '';
  // Withholding is not asked for in words. If it were, an agent could
  // reason its way past it.
  expect(prompt.toLowerCase()).not.toContain('do not use');
  expect(prompt.toLowerCase()).not.toContain('you may not');
  expect(toolsPassedTo(call?.argv ?? [])).toEqual(['Read']);
});

test('the allowlist reaches the invocation for real, not only the builder', async () => {
  const { logs } = sink();
  await runClaudeStep(host, {
    step,
    snapshot,
    agent: agentWith(['Read', 'Edit']),
    containerId: 'c1',
    logs,
  });
  const call = host.calls.find((c) => c.argv[0] === 'claude');
  expect(toolsPassedTo(call?.argv ?? [])).toEqual(['Read', 'Edit']);
});

test('a step whose agent lacks Write cannot satisfy a required document', async () => {
  // The honest consequence of withholding: the step fails for want of the
  // output rather than quietly writing it anyway.
  const noWrite = new FakeHost();
  noWrite.responses = [{ match: 'claude', result: { stdout: '{"total_cost_usd":0.05}' } }];
  // No file appears in the workspace, because nothing could write one.
  const { logs } = sink();
  const outcome = await runClaudeStep(noWrite, {
    step,
    snapshot,
    agent: agentWith(['Read']),
    containerId: 'c1',
    logs,
  });

  expect(outcome.status).toBe('failed');
  expect(outcome.error?.reason).toBe('missing_output');
  expect(outcome.error?.detail).toContain('docs/spec.md');
});

test('the tools an agent holds are the ones its snapshot holds, not the ones it asks for', () => {
  // A prompt mentioning a tool changes nothing: the allowlist comes from the
  // snapshot alone.
  const argv = buildArgv(
    { step, snapshot, agent: agentWith(['Read']), containerId: 'c1', logs: sink().logs },
    'Please use Bash to run the tests.',
  );
  expect(toolsPassedTo(argv)).toEqual(['Read']);
});

test('a turn limit is passed as a limit, not as a suggestion', () => {
  const argv = buildArgv(
    {
      step,
      snapshot,
      agent: { ...agentWith(['Read']), limits: { max_turns: 12 } },
      containerId: 'c1',
      logs: sink().logs,
    },
    'prompt',
  );
  expect(argv[argv.indexOf('--max-turns') + 1]).toBe('12');
});
