import { afterAll, beforeEach, expect, test } from 'bun:test';
import { agents, pipelines, pipelineVersions } from '@factory/db/schema';
import type { Step } from '@factory/shared';
import { eq } from 'drizzle-orm';
import { DEFAULT_AGENTS } from '../../src/lib/services/agent-defaults';
import { installDefaults } from '../../src/lib/services/install-defaults';
import { DEFAULT_PIPELINES } from '../../src/lib/services/pipeline-defaults';
import { ensureWorkspace } from '../../src/lib/services/workspace';
import { connect, reset } from '../fixtures';

/**
 * FR-033 and FR-034 — the shipped agents, and three shipped pipelines
 * differing only in how much human oversight they impose.
 *
 * Both were defined in source and neither was ever installed:
 * `DEFAULT_AGENTS` was imported and unused, `DEFAULT_PIPELINES` had no
 * reader. A fresh deployment had no agents and no pipelines, so no ticket
 * could be created at all — a ticket needs a pipeline.
 */

const { db, sql: raw } = connect();

beforeEach(async () => {
  await reset(db);
});
afterAll(async () => {
  await raw.end();
});

const steps = async (name: string): Promise<Step[]> => {
  const [pipeline] = await db.select().from(pipelines).where(eq(pipelines.name, name)).limit(1);
  if (!pipeline) throw new Error(`no ${name} pipeline`);
  const [version] = await db
    .select()
    .from(pipelineVersions)
    .where(eq(pipelineVersions.pipelineId, pipeline.id))
    .limit(1);
  return (version?.steps ?? []) as Step[];
};

test('an empty database gets every shipped agent and all three pipelines', async () => {
  const result = await installDefaults(db);

  expect(result.agentsCreated.sort()).toEqual(DEFAULT_AGENTS.map((a) => a.name).sort());
  expect(result.pipelinesCreated.sort()).toEqual(DEFAULT_PIPELINES.map((p) => p.name).sort());
  // Three, differing only in how much oversight they impose (FR-034).
  expect(result.pipelinesCreated).toHaveLength(3);
  expect(result.pipelinesCreated.sort()).toEqual(['Стандарт', 'Хурдан засвар', 'Хяналттай']);
});

test('every step names a real agent, not the slug it was written with', async () => {
  await installDefaults(db);
  const installed = await db.select().from(agents);
  const ids = new Set(installed.map((a) => a.id));

  for (const pipeline of DEFAULT_PIPELINES) {
    for (const step of await steps(pipeline.name)) {
      if (step.type !== 'agent') continue;
      // A slug where a UUID belongs is a pipeline that fails at that step,
      // at the worst possible moment — which is what `agentStep` produces
      // and what installing has to fix.
      expect(step.agent_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/);
      expect(ids.has(step.agent_id as string)).toBe(true);
    }
  }
});

test('the three pipelines differ in their gates and nothing else', async () => {
  await installDefaults(db);
  const gates = async (name: string) =>
    (await steps(name)).filter((s) => s.type === 'checkpoint').length;
  const work = async (name: string) =>
    (await steps(name)).filter((s) => s.type === 'agent').map((s) => s.output_files);

  expect(await gates('Хурдан засвар')).toBe(0);
  expect(await gates('Стандарт')).toBe(1);
  expect(await gates('Хяналттай')).toBe(3);
  // The same work in each; only the oversight changes.
  expect(await work('Хурдан засвар')).toEqual(await work('Стандарт'));
  expect(await work('Стандарт')).toEqual(await work('Хяналттай'));
});

test('each shipped agent records what it shipped as, so a reset has a target', async () => {
  await installDefaults(db);
  for (const shipped of DEFAULT_AGENTS) {
    const [row] = await db.select().from(agents).where(eq(agents.name, shipped.name)).limit(1);
    expect(row?.kind).toBe('default');
    // FR-040: resetting a modified default restores what shipped, and this
    // is the only record of what that was.
    const config = row?.defaultConfig as { systemPrompt?: string; model?: string } | null;
    expect(config?.systemPrompt).toBe(shipped.systemPrompt);
    expect(config?.model).toBe(shipped.model);
  }
});

test('a shipped pipeline has no owner, because it belongs to the workspace', async () => {
  await installDefaults(db);
  const rows = await db.select().from(pipelines);
  expect(rows.every((row) => row.ownerId === null)).toBe(true);
});

test('installing twice installs nothing twice', async () => {
  await installDefaults(db);
  const again = await installDefaults(db);

  expect(again.agentsCreated).toEqual([]);
  expect(again.pipelinesCreated).toEqual([]);
  expect(again.agentsKept.sort()).toEqual(DEFAULT_AGENTS.map((a) => a.name).sort());
  expect(await db.select().from(pipelines)).toHaveLength(3);
});

test('a re-install does not undo a change somebody made', async () => {
  await installDefaults(db);
  await db
    .update(agents)
    .set({ systemPrompt: 'somebody rewrote this', model: 'claude-haiku-4-5' })
    .where(eq(agents.name, 'Тодорхойлолт агент'));

  // A re-install is not a reset: that is `resetAgent`, which the person
  // themselves asks for. Overwriting here would discard their work without
  // their asking.
  await installDefaults(db);
  const [row] = await db
    .select()
    .from(agents)
    .where(eq(agents.name, 'Тодорхойлолт агент'))
    .limit(1);
  expect(row?.systemPrompt).toBe('somebody rewrote this');
  expect(row?.model).toBe('claude-haiku-4-5');
});

test('a fresh deployment installs them by itself, on first use', async () => {
  // Nothing has been created: `reset` emptied every table, including the
  // workspace. The first read is what makes the deployment exist.
  expect(await db.select().from(pipelines)).toHaveLength(0);

  await ensureWorkspace(db);

  // Without this a fresh deployment had a working settings screen and no way
  // to start anything, because a ticket needs a pipeline.
  expect(await db.select().from(pipelines)).toHaveLength(3);
  expect((await db.select().from(agents)).length).toBe(DEFAULT_AGENTS.length);
});

test('a second first-use does not install a second set', async () => {
  await ensureWorkspace(db);
  await ensureWorkspace(db);
  expect(await db.select().from(pipelines)).toHaveLength(3);
});
