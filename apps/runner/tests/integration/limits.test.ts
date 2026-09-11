import { expect, test } from 'bun:test';
import type { SnapshotAgent, StepOutcome } from '@factory/shared';
import { run as execute } from '../../src/container/host';
import {
  applyLimits,
  costBreach,
  effectiveLimits,
  TIMEOUT_EXIT_CODE,
  timeoutMsFor,
} from '../../src/engines/limits';

/**
 * FR-080 — each agent's own cost, time and turn limits, enforced within its
 * step. FR-079a — none of them may raise what the run is allowed to consume.
 */

const run = { cost_ceiling_usd: '5.0000', time_ceiling_minutes: 45 };

function agent(limits: SnapshotAgent['limits']): SnapshotAgent {
  return {
    id: 'a1',
    name: 'Implement',
    engine: 'claude_cli',
    model: 'claude-opus-5',
    system_prompt: 'do it',
    allowed_tools: ['Read'],
    skills: [],
    limits,
  };
}

const done: StepOutcome = { status: 'done', costUsd: '1.0000', durationS: 30, outputs: [] };

test('an agent with no limits of its own inherits the run ceilings', () => {
  expect(effectiveLimits(agent({}), run)).toEqual({
    maxCostUsd: '5.0000',
    maxMinutes: 45,
    maxTurns: null,
  });
});

test('an agent limit below the run ceiling is the one that applies', () => {
  expect(effectiveLimits(agent({ max_cost_usd: '1.5000', max_minutes: 10 }), run)).toEqual({
    maxCostUsd: '1.5000',
    maxMinutes: 10,
    maxTurns: null,
  });
});

test('an agent limit ABOVE the run ceiling cannot raise it (FR-079a)', () => {
  // A member setting a generous limit on their own agent must not be able to
  // spend more of the workspace's money than an administrator allowed.
  expect(effectiveLimits(agent({ max_cost_usd: '99.0000', max_minutes: 600 }), run)).toEqual({
    maxCostUsd: '5.0000',
    maxMinutes: 45,
    maxTurns: null,
  });
});

test('what the run has already spent is taken off what this step may spend', () => {
  // Otherwise the last step of an expensive run could spend the whole
  // ceiling over again.
  expect(effectiveLimits(agent({}), run, '4.2500').maxCostUsd).toBe('0.7500');
  expect(effectiveLimits(agent({ max_cost_usd: '2.0000' }), run, '4.2500').maxCostUsd).toBe(
    '0.7500',
  );
});

test('a run already at its ceiling leaves the step nothing to spend', () => {
  expect(effectiveLimits(agent({}), run, '5.0000').maxCostUsd).toBe('0.0000');
  expect(effectiveLimits(agent({}), run, '7.0000').maxCostUsd).toBe('0.0000');
});

test('turns pass through untouched — the run has no turn ceiling to cap them', () => {
  expect(effectiveLimits(agent({ max_turns: 20 }), run).maxTurns).toBe(20);
});

test('the time limit becomes a deadline the host can enforce', () => {
  expect(timeoutMsFor(effectiveLimits(agent({ max_minutes: 3 }), run))).toBe(180_000);
  expect(timeoutMsFor({ maxCostUsd: null, maxMinutes: null, maxTurns: null })).toBeUndefined();
});

test('a step that spent within its limit is left alone', () => {
  const limits = effectiveLimits(agent({ max_cost_usd: '1.5000' }), run);
  expect(costBreach(limits, '1.4999')).toBeNull();
  // Exactly the limit is within it.
  expect(costBreach(limits, '1.5000')).toBeNull();
  expect(applyLimits(done, limits, { agentName: 'Implement', exitCode: 0 })).toEqual(done);
});

test('a step that overspent becomes a failure naming the limit (FR-080)', () => {
  const limits = effectiveLimits(agent({ max_cost_usd: '0.5000' }), run);
  const outcome = applyLimits({ ...done, costUsd: '0.7300' }, limits, {
    agentName: 'Implement',
    exitCode: 0,
  });

  expect(outcome.status).toBe('failed');
  expect(outcome.error?.reason).toBe('budget_exceeded');
  expect(outcome.error?.detail).toBe(
    'Implement spent $0.7300, over the $0.5000 this step may spend.',
  );
  // What it produced and what it cost are kept: the run still has to account
  // for the money, and a document written before the overspend is real.
  expect(outcome.costUsd).toBe('0.7300');
});

test('a step killed at its deadline says so, not that a command failed', () => {
  const limits = effectiveLimits(agent({ max_minutes: 12 }), run);
  const outcome = applyLimits(
    {
      status: 'failed',
      costUsd: '0.2000',
      durationS: 720,
      outputs: [],
      error: { reason: 'command_failed', detail: 'the CLI exited 124' },
    },
    limits,
    { agentName: 'Implement', exitCode: TIMEOUT_EXIT_CODE },
  );

  expect(outcome.error?.reason).toBe('time_exceeded');
  expect(outcome.error?.detail).toBe(
    'Implement was stopped after 12 minutes, which is the longest this step may take.',
  );
});

test('a deadline outranks an overspend: the deadline is why it stopped', () => {
  const limits = effectiveLimits(agent({ max_cost_usd: '0.1000', max_minutes: 5 }), run);
  const outcome = applyLimits({ ...done, costUsd: '9.0000' }, limits, {
    agentName: 'Implement',
    exitCode: TIMEOUT_EXIT_CODE,
  });
  expect(outcome.error?.reason).toBe('time_exceeded');
});

test('a fixed-point comparison, so a fraction of a cent cannot disagree', () => {
  const limits = { maxCostUsd: '0.3000', maxMinutes: null, maxTurns: null };
  // 0.1 + 0.2 in floating point is 0.30000000000000004, which would breach.
  expect(costBreach(limits, '0.3000')).toBeNull();
  expect(costBreach(limits, '0.3001')).toEqual({ limit: '0.3000', spent: '0.3001' });
});

/**
 * The deadline against a real process, because a timeout that is only in a
 * type is not a timeout. `sleep` is used rather than docker: what is being
 * proven is that the deadline kills what it started and reports the code the
 * limits above recognise.
 */
test('the host kills a process that outlives its deadline', async () => {
  const started = Date.now();
  const result = await execute('sleep', ['30'], { timeoutMs: 400 });
  const elapsed = Date.now() - started;

  expect(result.exitCode).toBe(TIMEOUT_EXIT_CODE);
  expect(result.stderr).toContain('stopped after 400ms');
  // Killed, not waited out.
  expect(elapsed).toBeLessThan(3000);
});

test('a process that finishes inside its deadline keeps its own exit code', async () => {
  expect(await execute('sh', ['-c', 'exit 3'], { timeoutMs: 5000 })).toMatchObject({ exitCode: 3 });
  expect(await execute('sh', ['-c', 'echo hello'], { timeoutMs: 5000 })).toMatchObject({
    exitCode: 0,
    stdout: 'hello\n',
  });
});

test('no deadline means no kill', async () => {
  const result = await execute('sh', ['-c', 'sleep 0.2; echo late']);
  expect(result.exitCode).toBe(0);
  expect(result.stdout).toBe('late\n');
});
