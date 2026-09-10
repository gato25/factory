import { afterAll, beforeEach, expect, test } from 'bun:test';
import {
  pipelines,
  pipelineVersions,
  repositories,
  runs,
  tickets,
  users,
} from '@factory/db/schema';
import type { Step } from '@factory/shared';
import { eq } from 'drizzle-orm';
import {
  duplicatePipeline,
  getPipeline,
  insertStep,
  moveStep,
  removeStep,
  savePipeline,
} from '../../src/lib/services/pipeline';
import { startRun } from '../../src/lib/services/run';
import { connect, type Scenario, seed } from '../fixtures';

/**
 * FR-027 and SC-010 — a save advances the version and changes the behaviour
 * of zero runs already in flight. That is only true because a run pins a
 * version row and the rows are insert-only: nothing about editing a pipeline
 * can reach a run that already read one.
 */

const { db, sql: raw } = connect();
let scenario: Scenario;
let owner: { id: string; name: string; email: string; role: 'member' };

const base = { callbackBaseUrl: 'https://factory.example' };

async function currentSteps(pipelineId: string, version: number) {
  const rows = await db
    .select()
    .from(pipelineVersions)
    .where(eq(pipelineVersions.pipelineId, pipelineId));
  return (rows.find((row) => row.version === version)?.steps ?? []) as Step[];
}

beforeEach(async () => {
  scenario = await seed(db);
  owner = { id: scenario.userId, name: 'Bat', email: 'bat@netgroup.mn', role: 'member' };
  // The fixture's pipeline has no owner, so give it one to edit.
  await db
    .update(pipelines)
    .set({ ownerId: scenario.userId })
    .where(eq(pipelines.id, scenario.pipelineId));
});
afterAll(async () => {
  await raw.end();
});

test('a save writes a new version row and advances the pointer', async () => {
  const before = await currentSteps(scenario.pipelineId, 1);
  const next = insertStep(before, 1, {
    type: 'checkpoint',
    condition: 'always',
    approvers: 'anyone',
  });

  const { version } = await savePipeline(
    db,
    { pipelineId: scenario.pipelineId, steps: next },
    owner,
  );
  expect(version).toBe(2);

  const [pipeline] = await db
    .select()
    .from(pipelines)
    .where(eq(pipelines.id, scenario.pipelineId))
    .limit(1);
  expect(pipeline?.currentVersion).toBe(2);

  // Version 1 is untouched: the rows are insert-only.
  expect(await currentSteps(scenario.pipelineId, 1)).toEqual(before);
  expect((await currentSteps(scenario.pipelineId, 2)).length).toBe(before.length + 1);
});

test('a run in flight keeps executing the version it started with (SC-010)', async () => {
  const started = await startRun(db, { ticketId: scenario.ticketId, ...base });
  await db.update(runs).set({ status: 'running' }).where(eq(runs.id, started.run.id));
  const pinned = structuredClone(started.snapshot.pipeline.steps);
  expect(started.snapshot.pipeline.version).toBe(1);

  // Rearrange the pipeline completely underneath it.
  const rearranged = insertStep(moveStep(await currentSteps(scenario.pipelineId, 1), 0, 1), 0, {
    type: 'shell',
    condition: 'always',
    command: 'bun install',
  });
  const { version, runsUnaffected } = await savePipeline(
    db,
    { pipelineId: scenario.pipelineId, steps: rearranged },
    owner,
  );
  expect(version).toBe(2);
  // And the save says so, rather than leaving it to be discovered.
  expect(runsUnaffected).toBe(1);

  // The run's own snapshot is what it executes, and it has not moved.
  const [run] = await db.select().from(runs).where(eq(runs.id, started.run.id)).limit(1);
  expect(run?.snapshot.pipeline.version).toBe(1);
  expect(run?.snapshot.pipeline.steps).toEqual(pinned);
});

test('a run started AFTER the save reads the new version', async () => {
  const first = await startRun(db, { ticketId: scenario.ticketId, ...base });
  await db
    .update(runs)
    .set({ status: 'failed', finishedAt: new Date() })
    .where(eq(runs.id, first.run.id));

  const withGate = insertStep(await currentSteps(scenario.pipelineId, 1), 1, {
    type: 'checkpoint',
    condition: 'always',
    approvers: 'anyone',
  });
  await savePipeline(db, { pipelineId: scenario.pipelineId, steps: withGate }, owner);
  // The ticket must be pointed at the new version to pick it up: a retry
  // reproduces what the ticket was queued against (FR-088).
  await db.update(tickets).set({ pipelineVersion: 2 }).where(eq(tickets.id, scenario.ticketId));

  const second = await startRun(db, { ticketId: scenario.ticketId, ...base });
  expect(second.snapshot.pipeline.version).toBe(2);
  expect(second.snapshot.pipeline.steps.some((step) => step.type === 'checkpoint')).toBe(true);
  // And the first attempt still reads version 1.
  const [before] = await db.select().from(runs).where(eq(runs.id, first.run.id)).limit(1);
  expect(before?.snapshot.pipeline.version).toBe(1);
});

test('several saves stack versions, and every one stays readable', async () => {
  let steps = await currentSteps(scenario.pipelineId, 1);
  for (let i = 0; i < 3; i++) {
    steps = insertStep(steps, steps.length, {
      type: 'shell',
      condition: 'always',
      command: `bun run check-${i}`,
    });
    const { version } = await savePipeline(db, { pipelineId: scenario.pipelineId, steps }, owner);
    expect(version).toBe(i + 2);
  }

  const detail = await getPipeline(db, scenario.pipelineId, owner);
  expect(detail.currentVersion).toBe(4);
  expect(detail.versions.map((v) => v.version)).toEqual([4, 3, 2, 1]);
  expect(detail.versions.map((v) => v.stepCount)).toEqual([5, 4, 3, 2]);
});

test('a concurrent save is refused rather than overwriting', async () => {
  const steps = await currentSteps(scenario.pipelineId, 1);
  // Someone else's save landed first, taking version 2.
  await db.insert(pipelineVersions).values({
    pipelineId: scenario.pipelineId,
    version: 2,
    steps,
    createdBy: owner.id,
  });

  let refused: Error | null = null;
  try {
    await savePipeline(db, { pipelineId: scenario.pipelineId, steps }, owner);
  } catch (error) {
    refused = error as Error;
  }
  expect(refused?.message).toContain('Someone else saved this pipeline');
});

test('only the owner or an administrator may save', async () => {
  const steps = await currentSteps(scenario.pipelineId, 1);
  const [row] = await db
    .insert(users)
    .values({ name: 'Sara', email: 'sara@netgroup.mn' })
    .returning();
  if (!row) throw new Error('no second member');
  const stranger = { id: row.id, name: row.name, email: row.email, role: 'member' as const };

  let refused: Error | null = null;
  try {
    await savePipeline(db, { pipelineId: scenario.pipelineId, steps }, stranger);
  } catch (error) {
    refused = error as Error;
  }
  expect(refused?.message).toContain('belongs to someone else');

  // An administrator may.
  const admin = { ...stranger, role: 'admin' as const };
  expect((await savePipeline(db, { pipelineId: scenario.pipelineId, steps }, admin)).version).toBe(
    2,
  );
});

test('the detail says how many repositories use the pipeline (FR-030)', async () => {
  const detail = await getPipeline(db, scenario.pipelineId, owner);
  // The fixture points its one repository at this pipeline.
  expect(detail.repositoriesUsing).toBe(1);

  await db
    .update(repositories)
    .set({ defaultPipelineId: null })
    .where(eq(repositories.id, scenario.repositoryId));
  expect((await getPipeline(db, scenario.pipelineId, owner)).repositoriesUsing).toBe(0);
});

test('duplicating makes a new pipeline at version 1, owned by whoever copied it', async () => {
  const copy = await duplicatePipeline(db, scenario.pipelineId, owner);
  expect(copy.name).toBe('Standard (copy)');

  const detail = await getPipeline(db, copy.id, owner);
  expect(detail.currentVersion).toBe(1);
  expect(detail.ownerId).toBe(owner.id);
  expect(detail.steps).toEqual(await currentSteps(scenario.pipelineId, 1));
  // Nothing uses it yet, and editing it cannot reach the original.
  expect(detail.repositoriesUsing).toBe(0);

  await savePipeline(db, { pipelineId: copy.id, steps: removeStep(detail.steps, 0) }, owner);
  const [original] = await db
    .select()
    .from(pipelines)
    .where(eq(pipelines.id, scenario.pipelineId))
    .limit(1);
  expect(original?.currentVersion).toBe(1);
});

test('copying a copy does not stack the suffix forever', async () => {
  const first = await duplicatePipeline(db, scenario.pipelineId, owner);
  const second = await duplicatePipeline(db, first.id, owner);
  expect(second.name).toBe('Standard (copy)');
});
