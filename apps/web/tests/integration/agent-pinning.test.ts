import { afterAll, beforeEach, expect, test } from 'bun:test';
import { agentSkills, agents, runs, skills, users } from '@factory/db/schema';
import { eq } from 'drizzle-orm';
import { resetAgent, updateAgent } from '../../src/lib/services/agent';
import type { SessionUser } from '../../src/lib/services/auth';
import { startRun } from '../../src/lib/services/run';
import { createSkill, deleteSkill, updateSkill } from '../../src/lib/services/skill';
import { connect, type Scenario, seed } from '../fixtures';

/**
 * FR-041 and SC-010 — agent changes apply only to runs started afterwards.
 * The mechanism is the snapshot: a run resolves every agent and every skill
 * once, at the start, and never looks again (FR-044). So this measures what
 * the snapshot holds, not what a rule says.
 */

const { db, sql: raw } = connect();
let scenario: Scenario;
let admin: SessionUser;
const base = { callbackBaseUrl: 'https://factory.example' };

import type { PipelineSnapshot, SnapshotAgent } from '@factory/shared';

const specIn = (
  snapshot: Pick<PipelineSnapshot, 'agents'>,
  id: string,
): SnapshotAgent | undefined => snapshot.agents.find((agent) => agent.id === id);

beforeEach(async () => {
  scenario = await seed(db);
  const [row] = await db
    .insert(users)
    .values({ name: 'Admin', email: 'admin@netgroup.mn', role: 'admin' })
    .returning();
  if (!row) throw new Error('no admin');
  admin = { id: row.id, name: row.name, email: row.email, role: 'admin' };
});
afterAll(async () => {
  await raw.end();
});

test('a run in flight keeps the instructions it started with', async () => {
  const first = await startRun(db, { ticketId: scenario.ticketId, ...base });
  const before = specIn(first.snapshot, scenario.specAgentId);
  expect(before?.system_prompt).toBe('write docs/spec.md');

  await updateAgent(
    db,
    scenario.specAgentId,
    { systemPrompt: 'COMPLETELY DIFFERENT INSTRUCTIONS' },
    admin,
  );

  // The run's own snapshot is what it executes, and it has not moved.
  const [run] = await db.select().from(runs).where(eq(runs.id, first.run.id)).limit(1);
  expect(specIn(run?.snapshot ?? { agents: [] }, scenario.specAgentId)?.system_prompt).toBe(
    'write docs/spec.md',
  );
});

test('a run started afterwards reads the change', async () => {
  const first = await startRun(db, { ticketId: scenario.ticketId, ...base });
  await db
    .update(runs)
    .set({ status: 'failed', finishedAt: new Date() })
    .where(eq(runs.id, first.run.id));

  await updateAgent(db, scenario.specAgentId, { systemPrompt: 'write it differently' }, admin);
  const second = await startRun(db, { ticketId: scenario.ticketId, ...base });

  expect(specIn(second.snapshot, scenario.specAgentId)?.system_prompt).toBe('write it differently');
  // And the first attempt still reads what it started with.
  const [before] = await db.select().from(runs).where(eq(runs.id, first.run.id)).limit(1);
  expect(specIn(before?.snapshot ?? { agents: [] }, scenario.specAgentId)?.system_prompt).toBe(
    'write docs/spec.md',
  );
});

test('a withheld tool stays withheld for a run already going, and vice versa', async () => {
  const first = await startRun(db, { ticketId: scenario.ticketId, ...base });
  expect(specIn(first.snapshot, scenario.specAgentId)?.allowed_tools).toEqual(['Read', 'Write']);

  // Grant Bash to the agent AFTER the run started.
  await updateAgent(db, scenario.specAgentId, { allowedTools: ['Read', 'Write', 'Bash'] }, admin);

  const [run] = await db.select().from(runs).where(eq(runs.id, first.run.id)).limit(1);
  // The run in flight still cannot reach Bash: its snapshot never gained it.
  expect(specIn(run?.snapshot ?? { agents: [] }, scenario.specAgentId)?.allowed_tools).toEqual([
    'Read',
    'Write',
  ]);
});

test('the model a run uses is the model it pinned', async () => {
  const first = await startRun(db, { ticketId: scenario.ticketId, ...base });
  expect(specIn(first.snapshot, scenario.specAgentId)?.model).toBe('claude-sonnet-5');

  await updateAgent(db, scenario.specAgentId, { model: 'claude-haiku-4-5' }, admin);
  const [run] = await db.select().from(runs).where(eq(runs.id, first.run.id)).limit(1);
  expect(specIn(run?.snapshot ?? { agents: [] }, scenario.specAgentId)?.model).toBe(
    'claude-sonnet-5',
  );
});

test("an agent's own limits are pinned too", async () => {
  await updateAgent(db, scenario.specAgentId, { maxTurns: 20 }, admin);
  const first = await startRun(db, { ticketId: scenario.ticketId, ...base });
  expect(specIn(first.snapshot, scenario.specAgentId)?.limits.max_turns).toBe(20);

  await updateAgent(db, scenario.specAgentId, { maxTurns: 200 }, admin);
  const [run] = await db.select().from(runs).where(eq(runs.id, first.run.id)).limit(1);
  expect(specIn(run?.snapshot ?? { agents: [] }, scenario.specAgentId)?.limits.max_turns).toBe(20);
});

test("a skill's CONTENT is pinned, not merely its name (SC-010)", async () => {
  const created = await createSkill(
    db,
    { name: 'house-style', description: 'When writing prose', content: 'Be brief.' },
    admin,
  );
  await db.insert(agentSkills).values({ agentId: scenario.specAgentId, skillId: created.id });

  const first = await startRun(db, { ticketId: scenario.ticketId, ...base });
  const held = specIn(first.snapshot, scenario.specAgentId)?.skills ?? [];
  expect(held).toEqual([
    { name: 'house-style', description: 'When writing prose', content: 'Be brief.' },
  ]);

  // Rewrite the skill entirely underneath the run.
  await updateSkill(db, created.id, { content: 'Write at length, with exclamation marks!' }, admin);

  const [run] = await db.select().from(runs).where(eq(runs.id, first.run.id)).limit(1);
  expect(specIn(run?.snapshot ?? { agents: [] }, scenario.specAgentId)?.skills[0]?.content).toBe(
    'Be brief.',
  );
});

test('deleting a skill does not reach a run holding it', async () => {
  const created = await createSkill(
    db,
    { name: 'house-style', description: 'When writing prose', content: 'Be brief.' },
    admin,
  );
  await db.insert(agentSkills).values({ agentId: scenario.specAgentId, skillId: created.id });
  const first = await startRun(db, { ticketId: scenario.ticketId, ...base });

  const { detachedFrom } = await deleteSkill(db, created.id, admin);
  // The delete says what it detached, so the effect is not a surprise.
  expect(detachedFrom.map((agent) => agent.name)).toEqual(['Spec']);
  expect(await db.select().from(skills).where(eq(skills.id, created.id))).toHaveLength(0);

  // The run still carries the content it read.
  const [run] = await db.select().from(runs).where(eq(runs.id, first.run.id)).limit(1);
  expect(specIn(run?.snapshot ?? { agents: [] }, scenario.specAgentId)?.skills[0]?.content).toBe(
    'Be brief.',
  );
});

test('attaching a skill after the start does not reach the run', async () => {
  const first = await startRun(db, { ticketId: scenario.ticketId, ...base });
  expect(specIn(first.snapshot, scenario.specAgentId)?.skills).toEqual([]);

  const created = await createSkill(
    db,
    { name: 'late', description: 'Too late', content: 'Nope.' },
    admin,
  );
  await db.insert(agentSkills).values({ agentId: scenario.specAgentId, skillId: created.id });

  const [run] = await db.select().from(runs).where(eq(runs.id, first.run.id)).limit(1);
  expect(specIn(run?.snapshot ?? { agents: [] }, scenario.specAgentId)?.skills).toEqual([]);
});

test('Reset to default does not reach a run either (FR-040, FR-041)', async () => {
  // Give the agent a shipped configuration to go back to.
  await db
    .update(agents)
    .set({
      defaultConfig: {
        name: 'Spec',
        description: null,
        engine: 'claude_cli',
        model: 'claude-sonnet-5',
        systemPrompt: 'write docs/spec.md',
        allowedTools: ['Read', 'Write'],
      },
    })
    .where(eq(agents.id, scenario.specAgentId));
  await updateAgent(db, scenario.specAgentId, { systemPrompt: 'my own version' }, admin);

  const first = await startRun(db, { ticketId: scenario.ticketId, ...base });
  expect(specIn(first.snapshot, scenario.specAgentId)?.system_prompt).toBe('my own version');

  await resetAgent(db, scenario.specAgentId, admin);
  const [row] = await db.select().from(agents).where(eq(agents.id, scenario.specAgentId)).limit(1);
  expect(row?.systemPrompt).toBe('write docs/spec.md');

  // The run keeps the edited version it started with.
  const [run] = await db.select().from(runs).where(eq(runs.id, first.run.id)).limit(1);
  expect(specIn(run?.snapshot ?? { agents: [] }, scenario.specAgentId)?.system_prompt).toBe(
    'my own version',
  );
});

test('a reset is refused on an agent that never shipped', async () => {
  let refused: Error | null = null;
  try {
    await resetAgent(db, scenario.specAgentId, admin);
  } catch (error) {
    refused = error as Error;
  }
  expect(refused?.message).toContain('created here rather than shipped');
});
