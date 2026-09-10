import { afterAll, beforeEach, expect, test } from 'bun:test';
import { agents, pipelineVersions, workspaces } from '@factory/db/schema';
import type { SnapshotAgent } from '@factory/shared';
import { eq } from 'drizzle-orm';
import { effectiveLimits } from '../../../runner/src/engines/limits';
import { startRun } from '../../src/lib/services/run';
import { connect, type Scenario, seed } from '../fixtures';

/**
 * FR-079a — a limit a member sets on their own agent is capped at the
 * workspace ceiling, so it can only ever LOWER what a run may consume. The
 * cap happens twice on purpose: once when the snapshot is resolved, so the
 * run carries the right number, and once in the runner, so the step cannot
 * exceed what is left.
 */

const { db, sql: raw } = connect();
let scenario: Scenario;
const base = { callbackBaseUrl: 'https://factory.example' };

const spec = (snapshot: { agents: SnapshotAgent[] }, id: string) =>
  snapshot.agents.find((agent) => agent.id === id);

beforeEach(async () => {
  scenario = await seed(db);
  await db
    .update(workspaces)
    .set({ defaultCostCeilingUsd: '5.0000', defaultTimeCeilingMinutes: 45 });
});
afterAll(async () => {
  await raw.end();
});

test("a member's generous agent limit cannot raise the run's ceiling", async () => {
  // A member sets a limit far above what an administrator allowed.
  await db
    .update(agents)
    .set({ maxCostUsd: '99.0000', maxMinutes: 600 })
    .where(eq(agents.id, scenario.specAgentId));

  const started = await startRun(db, { ticketId: scenario.ticketId, ...base });
  // The run's own ceiling is the workspace's, not the agent's.
  expect(started.run.costCeilingUsd).toBe('5.0000');
  expect(started.run.timeCeilingMinutes).toBe(45);

  // And within the step, the effective limit is the run's too.
  const agent = spec(started.snapshot, scenario.specAgentId);
  if (!agent) throw new Error('no agent in the snapshot');
  const limits = effectiveLimits(agent, started.snapshot.limits);
  expect(limits.maxCostUsd).toBe('5.0000');
  expect(limits.maxMinutes).toBe(45);
});

test('a limit BELOW the ceiling is the one that applies', async () => {
  await db
    .update(agents)
    .set({ maxCostUsd: '0.7500', maxMinutes: 10 })
    .where(eq(agents.id, scenario.specAgentId));

  const started = await startRun(db, { ticketId: scenario.ticketId, ...base });
  const agent = spec(started.snapshot, scenario.specAgentId);
  if (!agent) throw new Error('no agent in the snapshot');

  const limits = effectiveLimits(agent, started.snapshot.limits);
  expect(limits.maxCostUsd).toBe('0.7500');
  expect(limits.maxMinutes).toBe(10);
  // The run's ceiling is unchanged: lowering a step does not lower the run.
  expect(started.run.costCeilingUsd).toBe('5.0000');
});

test('a pipeline-level limit is capped at the workspace ceiling too (FR-079a)', async () => {
  // A pipeline whose steps ask for more than the workspace allows.
  await db
    .update(pipelineVersions)
    .set({
      steps: [
        {
          type: 'agent',
          condition: 'always',
          agent_id: scenario.specAgentId,
          output_files: ['docs/spec.md'],
        },
        { type: 'agent', condition: 'always', agent_id: scenario.implementAgentId },
      ],
    })
    .where(eq(pipelineVersions.pipelineId, scenario.pipelineId));
  await db.update(agents).set({ maxCostUsd: '50.0000' });

  const started = await startRun(db, { ticketId: scenario.ticketId, ...base });
  expect(Number(started.snapshot.limits.cost_ceiling_usd)).toBeLessThanOrEqual(5);
});

test('what the run has already spent is taken off what a step may spend', async () => {
  const started = await startRun(db, { ticketId: scenario.ticketId, ...base });
  const agent = spec(started.snapshot, scenario.specAgentId);
  if (!agent) throw new Error('no agent in the snapshot');

  // With $4.25 gone, a step may spend the $0.75 that is left — not the
  // whole ceiling over again.
  expect(effectiveLimits(agent, started.snapshot.limits, '4.2500').maxCostUsd).toBe('0.7500');
  expect(effectiveLimits(agent, started.snapshot.limits, '5.0000').maxCostUsd).toBe('0.0000');
});

test('an agent with no limits of its own simply inherits the run ceiling', async () => {
  const started = await startRun(db, { ticketId: scenario.ticketId, ...base });
  const implement = spec(started.snapshot, scenario.implementAgentId);
  if (!implement) throw new Error('no agent in the snapshot');

  expect(implement.limits.max_cost_usd).toBeUndefined();
  expect(effectiveLimits(implement, started.snapshot.limits).maxCostUsd).toBe('5.0000');
});

test('lowering the workspace ceiling lowers what a later run may consume', async () => {
  const first = await startRun(db, { ticketId: scenario.ticketId, ...base });
  expect(first.run.costCeilingUsd).toBe('5.0000');
  await db.update(workspaces).set({ defaultCostCeilingUsd: '1.0000' });

  // The run in flight keeps the ceiling it started with; a new one does not.
  const { runs } = await import('@factory/db/schema');
  await db
    .update(runs)
    .set({ status: 'failed', finishedAt: new Date() })
    .where(eq(runs.id, first.run.id));
  const second = await startRun(db, { ticketId: scenario.ticketId, ...base });

  expect(second.run.costCeilingUsd).toBe('1.0000');
  const [before] = await db.select().from(runs).where(eq(runs.id, first.run.id)).limit(1);
  expect(before?.costCeilingUsd).toBe('5.0000');
});
