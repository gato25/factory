import { afterAll, beforeEach, expect, test } from 'bun:test';
import { agents } from '@factory/db/schema';
import { eq } from 'drizzle-orm';
import { resolveCeilings } from '../../src/lib/snapshot/ceilings';
import { resolveSnapshot } from '../../src/lib/snapshot/resolve';
import { connect, type Scenario, seed } from '../fixtures';

const { db, sql: raw } = connect();
let scenario: Scenario;

beforeEach(async () => {
  scenario = await seed(db);
});
afterAll(async () => {
  await raw.end();
});

const resolveFor = (s: Scenario) =>
  resolveSnapshot(db, {
    ticketId: s.ticketId,
    attempt: 1,
    runId: crypto.randomUUID(),
    callbackUrl: 'https://factory.example/api/hooks/n8n',
    resumeSecret: 'secret',
  });

test('a snapshot is complete: nothing in it requires a later lookup (FR-044)', async () => {
  const { snapshot } = await resolveFor(scenario);

  expect(snapshot.ticket.reference).toBe('#142');
  expect(snapshot.ticket.acceptance_criteria).toHaveLength(2);
  expect(snapshot.repo.clone_url).toContain('shop-frontend');
  expect(snapshot.repo.default_branch).toBe('main');
  expect(snapshot.pipeline.steps).toHaveLength(2);
  expect(snapshot.limits.cost_ceiling_usd).toBe('5.0000');
  expect(snapshot.callback_url).toContain('/api/hooks/n8n');

  // Every agent a step names is carried in full, with its prompt and tools.
  for (const step of snapshot.pipeline.steps) {
    if (!step.agent_id) continue;
    const agent = snapshot.agents.find((a) => a.id === step.agent_id);
    expect(agent).toBeDefined();
    expect(agent?.system_prompt.length).toBeGreaterThan(0);
    expect(agent?.model).toMatch(/^claude-(sonnet|opus)-5$/);
  }
});

test('editing an agent afterwards does not change a resolved snapshot (SC-010)', async () => {
  const { snapshot } = await resolveFor(scenario);
  const before = snapshot.agents.find((a) => a.id === scenario.specAgentId);
  expect(before?.model).toBe('claude-sonnet-5');

  await db
    .update(agents)
    .set({ model: 'claude-haiku-4-5', systemPrompt: 'something else entirely' })
    .where(eq(agents.id, scenario.specAgentId));

  // The already-resolved document is untouched...
  expect(snapshot.agents.find((a) => a.id === scenario.specAgentId)?.model).toBe('claude-sonnet-5');
  // ...while a NEW run would pick the change up (FR-041).
  const { snapshot: later } = await resolveFor(scenario);
  expect(later.agents.find((a) => a.id === scenario.specAgentId)?.model).toBe('claude-haiku-4-5');
});

test('a design-engine agent carries no tool permissions (FR-036a)', async () => {
  await db
    .update(agents)
    .set({ engine: 'design_cli', allowedTools: ['Read', 'Write'] })
    .where(eq(agents.id, scenario.specAgentId));
  const { snapshot } = await resolveFor(scenario);
  expect(snapshot.agents.find((a) => a.id === scenario.specAgentId)?.allowed_tools).toEqual([]);
});

test('resolution refuses a pipeline whose agent has been deleted', async () => {
  await db.delete(agents).where(eq(agents.id, scenario.specAgentId));
  await expect(resolveFor(scenario)).rejects.toThrow(/no longer exists/);
});

// --- ceiling arithmetic (FR-079a) ---

test('the workspace ceiling applies when nothing lower is set', () => {
  const c = resolveCeilings({ workspace: { costUsd: '5.0000', minutes: 45 } });
  expect(c).toMatchObject({ costUsd: '5.0000', minutes: 45, costFrom: 'workspace' });
});

test("a member's lower agent limit binds", () => {
  const c = resolveCeilings({
    workspace: { costUsd: '5.0000', minutes: 45 },
    agents: [{ costUsd: '1.2500', minutes: 10 }],
  });
  expect(c.costUsd).toBe('1.2500');
  expect(c.costFrom).toBe('agent');
  expect(c.minutes).toBe(10);
});

test('a member CANNOT raise consumption above the workspace ceiling (FR-079a)', () => {
  const c = resolveCeilings({
    workspace: { costUsd: '5.0000', minutes: 45 },
    agents: [{ costUsd: '999.0000', minutes: 6000 }],
  });
  expect(c.costUsd).toBe('5.0000');
  expect(c.minutes).toBe(45);
  expect(c.costFrom).toBe('workspace');
});

test('the lowest of several agents binds, and the message names which limit applies', async () => {
  const { explainCeilings } = await import('../../src/lib/snapshot/ceilings');
  const c = resolveCeilings({
    workspace: { costUsd: '5.0000', minutes: 45 },
    pipeline: { costUsd: '3.0000', minutes: 30 },
    agents: [
      { costUsd: '2.0000', minutes: 40 },
      { costUsd: '4.0000', minutes: 5 },
    ],
  });
  expect(c.costUsd).toBe('2.0000');
  expect(c.minutes).toBe(5);
  expect(explainCeilings(c)).toContain('$2.0000 per run (from the agent)');
});

test('ceilings resolved at snapshot time are stored on the snapshot, not recomputed', async () => {
  await db.update(agents).set({ maxCostUsd: '0.5000' }).where(eq(agents.id, scenario.specAgentId));
  const { snapshot, ceilings } = await resolveFor(scenario);
  expect(ceilings.costUsd).toBe('0.5000');
  expect(snapshot.limits.cost_ceiling_usd).toBe('0.5000');
});
