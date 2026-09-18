import { afterAll, beforeEach, expect, test } from 'bun:test';
import { agents, pipelines, skills, users } from '@factory/db/schema';
import { eq } from 'drizzle-orm';
import {
  createAgent,
  deleteAgent,
  duplicateAgent,
  updateAgent,
} from '../../src/lib/services/agent';
import type { SessionUser } from '../../src/lib/services/auth';
import { canChangeOwned } from '../../src/lib/services/authz';
import { ownershipOf, requireChangeable } from '../../src/lib/services/ownership';
import { savePipeline } from '../../src/lib/services/pipeline';
import { createSkill, deleteSkill, updateSkill } from '../../src/lib/services/skill';
import { connect, type Scenario, seed } from '../fixtures';

/**
 * FR-006, FR-006a, FR-006b, FR-006c — one ownership rule across pipelines,
 * agents and skills: any member creates and changes their own with no
 * administrator involved; another member's is readable and usable but not
 * changeable; an administrator may change any; and a shipped default belongs
 * to nobody, so it is available to everyone and administrator-only to change.
 */

const { db, sql: raw } = connect();
let scenario: Scenario;
let mine: SessionUser;
let theirs: SessionUser;
let admin: SessionUser;

async function member(name: string, role: 'member' | 'admin' = 'member'): Promise<SessionUser> {
  const [row] = await db
    .insert(users)
    .values({ name, email: `${name.toLowerCase()}@netgroup.mn`, role })
    .returning();
  if (!row) throw new Error('no user');
  return { id: row.id, name: row.name, email: row.email, role: row.role };
}

async function refusal(work: () => Promise<unknown>): Promise<string> {
  try {
    await work();
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error('expected a refusal');
}

beforeEach(async () => {
  scenario = await seed(db);
  mine = { id: scenario.userId, name: 'Bat', email: 'bat@netgroup.mn', role: 'member' };
  theirs = await member('Sara');
  admin = await member('Admin', 'admin');
});
afterAll(async () => {
  await raw.end();
});

// --- the predicate the whole rule rests on ---

test('the rule is: owner, or administrator, and nobody else', () => {
  expect(canChangeOwned(mine, mine.id)).toBe(true);
  expect(canChangeOwned(theirs, mine.id)).toBe(false);
  expect(canChangeOwned(admin, mine.id)).toBe(true);
  // A shipped default has no owner: administrators only (FR-006b).
  expect(canChangeOwned(mine, null)).toBe(false);
  expect(canChangeOwned(admin, null)).toBe(true);
  expect(canChangeOwned(null, mine.id)).toBe(false);
});

// --- agents ---

test('any member creates an agent, with no administrator involved (FR-006)', async () => {
  const created = await createAgent(db, { name: 'Reviewer', systemPrompt: 'object' }, mine);
  const ownership = await ownershipOf(db, 'agent', created.id, mine);

  expect(ownership.ownerId).toBe(mine.id);
  expect(ownership.ownerName).toBe('Bat');
  expect(ownership.isDefault).toBe(false);
  expect(ownership.mayChange).toBe(true);
});

test("another member's agent is readable and usable, not changeable (FR-006c)", async () => {
  const created = await createAgent(db, { name: 'Reviewer' }, mine);

  // Readable, with who owns it (FR-006d).
  const seen = await ownershipOf(db, 'agent', created.id, theirs);
  expect(seen.name).toBe('Reviewer');
  expect(seen.ownerName).toBe('Bat');
  expect(seen.mayChange).toBe(false);

  // Not changeable — and told what they CAN do.
  const message = await refusal(() => updateAgent(db, created.id, { name: 'Mine now' }, theirs));
  expect(message).toBe(
    'Энэ агент Bat-д харьяалагдана. Та үүнийг ашиглаж, хуулбарлаж болно, гэхдээ өөрчилж болохгүй.',
  );

  // And it really did not change.
  const [row] = await db.select().from(agents).where(eq(agents.id, created.id)).limit(1);
  expect(row?.name).toBe('Reviewer');
});

test('an administrator may change any agent', async () => {
  const created = await createAgent(db, { name: 'Reviewer' }, mine);
  await updateAgent(db, created.id, { name: 'Reviewer, edited' }, admin);

  const [row] = await db.select().from(agents).where(eq(agents.id, created.id)).limit(1);
  expect(row?.name).toBe('Reviewer, edited');
});

test('a shipped agent is available to everyone and administrator-only to change', async () => {
  // The fixture's agents have no owner, which is what shipped means.
  const ownership = await ownershipOf(db, 'agent', scenario.specAgentId, mine);
  expect(ownership.isDefault).toBe(true);
  expect(ownership.ownerName).toBeNull();
  expect(ownership.mayChange).toBe(false);

  const message = await refusal(() =>
    updateAgent(db, scenario.specAgentId, { name: 'Spec, edited' }, mine),
  );
  expect(message).toBe(
    'Энэ агент Code Factory-тай хамт ирдэг. Та үүнийг ашиглаж, хуулбарлаж болно; ' +
      'зөвхөн администратор өөрчилнө.',
  );

  // An administrator may.
  await updateAgent(db, scenario.specAgentId, { name: 'Spec, edited' }, admin);
  const [row] = await db.select().from(agents).where(eq(agents.id, scenario.specAgentId)).limit(1);
  expect(row?.name).toBe('Spec, edited');
});

test('duplicating is how a shipped agent becomes yours to change (FR-006b)', async () => {
  const copy = await duplicateAgent(db, scenario.specAgentId, mine);
  const ownership = await ownershipOf(db, 'agent', copy.id, mine);

  expect(copy.name).toBe('Spec (copy)');
  expect(ownership.ownerId).toBe(mine.id);
  expect(ownership.mayChange).toBe(true);
  // And the original is untouched.
  expect((await ownershipOf(db, 'agent', scenario.specAgentId, mine)).isDefault).toBe(true);
});

test('only the owner or an administrator may delete an agent', async () => {
  const created = await createAgent(db, { name: 'Reviewer' }, mine);
  expect(await refusal(() => deleteAgent(db, created.id, theirs))).toContain('belongs to Bat');

  await deleteAgent(db, created.id, mine);
  expect(await db.select().from(agents).where(eq(agents.id, created.id))).toHaveLength(0);
});

// --- skills ---

test('a skill follows the same rule as an agent', async () => {
  const created = await createSkill(
    db,
    { name: 'house-style', description: 'When writing prose', content: 'Be brief.' },
    mine,
  );

  expect((await ownershipOf(db, 'skill', created.id, mine)).mayChange).toBe(true);
  expect((await ownershipOf(db, 'skill', created.id, theirs)).mayChange).toBe(false);
  expect((await ownershipOf(db, 'skill', created.id, admin)).mayChange).toBe(true);

  expect(await refusal(() => updateSkill(db, created.id, { content: 'x' }, theirs))).toContain(
    'belongs to Bat',
  );
  expect(await refusal(() => deleteSkill(db, created.id, theirs))).toContain('belongs to Bat');

  // The owner may, and so may an administrator.
  await updateSkill(db, created.id, { content: 'Be very brief.' }, mine);
  const [row] = await db.select().from(skills).where(eq(skills.id, created.id)).limit(1);
  expect(row?.content).toBe('Be very brief.');
  await updateSkill(db, created.id, { content: 'Admin says so.' }, admin);
});

// --- pipelines ---

test('a pipeline follows the same rule too', async () => {
  await db.update(pipelines).set({ ownerId: mine.id }).where(eq(pipelines.id, scenario.pipelineId));
  const steps = [
    { type: 'agent' as const, condition: 'always' as const, agent_id: scenario.implementAgentId },
  ];

  expect(
    await refusal(() => savePipeline(db, { pipelineId: scenario.pipelineId, steps }, theirs)),
  ).toContain('belongs to someone else');
  expect((await savePipeline(db, { pipelineId: scenario.pipelineId, steps }, mine)).version).toBe(
    2,
  );
  expect((await savePipeline(db, { pipelineId: scenario.pipelineId, steps }, admin)).version).toBe(
    3,
  );
});

test('requireChangeable returns the ownership when it passes', async () => {
  const created = await createAgent(db, { name: 'Reviewer' }, mine);
  const ownership = await requireChangeable(db, 'agent', created.id, mine);
  expect(ownership.mayChange).toBe(true);
  expect(ownership.kind).toBe('agent');
});

test('someone signed out is told to sign in, not that it belongs to someone', async () => {
  const created = await createAgent(db, { name: 'Reviewer' }, mine);
  expect(await refusal(() => requireChangeable(db, 'agent', created.id, null))).toBe(
    'you must be signed in',
  );
});
