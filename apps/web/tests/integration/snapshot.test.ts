import { afterAll, beforeEach, expect, test } from 'bun:test';
import { agents, workspaces } from '@factory/db/schema';
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
    callbackUrl: 'https://factory.example/api/hooks/orchestrator',
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
  expect(snapshot.callback_url).toContain('/api/hooks/orchestrator');

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

// --- ceiling arithmetic (FR-079, FR-079a) ---

test('the workspace ceiling applies when nothing lower is set', () => {
  const c = resolveCeilings({ workspace: { costUsd: '5.0000', minutes: 45 } });
  expect(c).toMatchObject({ costUsd: '5.0000', minutes: 45, costFrom: 'workspace' });
});

test("a pipeline's lower ceiling binds, and the message names it (FR-079)", async () => {
  const { explainCeilings } = await import('../../src/lib/snapshot/ceilings');
  const c = resolveCeilings({
    workspace: { costUsd: '5.0000', minutes: 45 },
    pipeline: { costUsd: '3.0000', minutes: 30 },
  });
  expect(c.costUsd).toBe('3.0000');
  expect(c.costFrom).toBe('pipeline');
  expect(c.minutes).toBe(30);
  expect(explainCeilings(c)).toContain('$3.0000 per run (from the pipeline)');
});

test('a pipeline CANNOT raise consumption above the workspace ceiling (FR-079a)', () => {
  const c = resolveCeilings({
    workspace: { costUsd: '5.0000', minutes: 45 },
    pipeline: { costUsd: '999.0000', minutes: 6000 },
  });
  expect(c.costUsd).toBe('5.0000');
  expect(c.minutes).toBe(45);
  expect(c.costFrom).toBe('workspace');
});

/**
 * An agent's limits are per-STEP (FR-080) and deliberately do not enter the
 * run's ceiling. Folding them in would mean an agent allowed $0.75 a step,
 * inside a five-step pipeline, capped the whole run at $0.75 — so the run
 * would fail after its first step for consuming exactly what it was allowed.
 */
test("an agent's per-step limit does not become the run's ceiling", () => {
  const c = resolveCeilings({ workspace: { costUsd: '5.0000', minutes: 45 } });
  expect(c.costUsd).toBe('5.0000');
  expect(c.minutes).toBe(45);
});

test('cost is compared as scaled integers, so a fraction of a cent cannot drift', () => {
  const c = resolveCeilings({
    workspace: { costUsd: '0.3000', minutes: 45 },
    pipeline: { costUsd: '0.1000', minutes: 45 },
  });
  expect(c.costUsd).toBe('0.1000');
  // And an equal value does not change the source, so the message stays true.
  const equal = resolveCeilings({
    workspace: { costUsd: '2.0000', minutes: 45 },
    pipeline: { costUsd: '2.0000', minutes: 45 },
  });
  expect(equal.costFrom).toBe('workspace');
});

test('ceilings resolved at snapshot time are stored on the snapshot, not recomputed', async () => {
  const { workspaces } = await import('@factory/db/schema');
  await db.update(workspaces).set({ defaultCostCeilingUsd: '2.5000' });
  const { snapshot, ceilings } = await resolveFor(scenario);

  expect(ceilings.costUsd).toBe('2.5000');
  expect(snapshot.limits.cost_ceiling_usd).toBe('2.5000');

  // Changing it afterwards does not reach the snapshot already taken.
  await db.update(workspaces).set({ defaultCostCeilingUsd: '9.0000' });
  expect(snapshot.limits.cost_ceiling_usd).toBe('2.5000');
});

test("an agent's per-step limit travels on the agent, not on the run", async () => {
  await db.update(agents).set({ maxCostUsd: '0.5000' }).where(eq(agents.id, scenario.specAgentId));
  const { snapshot } = await resolveFor(scenario);

  // On the agent, where the runner caps the step against it (FR-080).
  const spec = snapshot.agents.find((agent) => agent.id === scenario.specAgentId);
  expect(spec?.limits.max_cost_usd).toBe('0.5000');
  // Not on the run: a step's limit is not the run's ceiling (FR-079).
  expect(snapshot.limits.cost_ceiling_usd).toBe('5.0000');
});

test("the snapshot pins the sandbox's limits, so what an administrator set applies", async () => {
  await db.update(workspaces).set({
    sandboxImage: 'code-factory/sandbox:pinned',
    sandboxCpu: 4,
    sandboxMemoryMb: 8192,
    sandboxWallClockMinutes: 30,
    sandboxNetworkDuringImplement: true,
  });

  const { snapshot } = await resolveSnapshot(db, {
    ticketId: scenario.ticketId,
    runId: crypto.randomUUID(),
    attempt: 1,
    callbackUrl: 'https://factory.example/api/hooks/orchestrator',
    resumeSecret: 's',
  });

  // Without this the Runner used figures compiled into it, so every sandbox
  // limit an administrator set was ignored (FR-085).
  expect(snapshot.sandbox).toEqual({
    image: 'code-factory/sandbox:pinned',
    cpu: 4,
    memory_mb: 8192,
    wall_clock_minutes: 30,
    network_during_implement: true,
  });
});

test('changing a sandbox limit does not reshape a run already resolved', async () => {
  const first = await resolveSnapshot(db, {
    ticketId: scenario.ticketId,
    runId: crypto.randomUUID(),
    attempt: 1,
    callbackUrl: 'https://factory.example/api/hooks/orchestrator',
    resumeSecret: 's',
  });
  await db.update(workspaces).set({ sandboxMemoryMb: 65536 });

  // The same reason the ceilings are pinned: a container already running
  // cannot be reshaped, so its recorded limits must be what it started with.
  expect(first.snapshot.sandbox?.memory_mb).not.toBe(65536);
});
