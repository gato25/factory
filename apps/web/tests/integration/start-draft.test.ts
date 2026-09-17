import { afterAll, beforeEach, expect, test } from 'bun:test';
import { pipelines, pipelineVersions, tickets } from '@factory/db/schema';
import { FactoryError, type Step } from '@factory/shared';
import { eq } from 'drizzle-orm';
import { startRun } from '../../src/lib/services/run';
import { createTicket } from '../../src/lib/services/ticket';
import { connect, type Scenario, seed } from '../fixtures';

/**
 * Starting a ticket that was saved as a draft (FR-017).
 *
 * A draft carries the pipeline its author chose and no version, because the
 * version is pinned when the run starts — that is what keeps a later edit of
 * the pipeline away from a run already going (FR-027, SC-010). Nothing used to
 * do that pinning: creation wrote the version only for a ticket started at
 * once, and the snapshot resolver refused a ticket with nothing pinned. Every
 * draft was therefore permanently unstartable, and the refusal read as though
 * its author had done something wrong.
 */

const { db, sql: raw } = connect();
let scenario: Scenario;

beforeEach(async () => {
  scenario = await seed(db);
});
afterAll(async () => {
  await raw.end();
});

const draft = async (pipelineId?: string) =>
  createTicket(
    db,
    { repositoryId: scenario.repositoryId, pipelineId, title: 'Add a task list', start: false },
    scenario.userId,
  );

const start = (ticketId: string) =>
  startRun(db, { ticketId, callbackBaseUrl: 'https://factory.example' });

test('a draft is saved with its pipeline and nothing pinned', async () => {
  const ticket = await draft(scenario.pipelineId);
  expect(ticket.status).toBe('draft');
  expect(ticket.pipelineId).toBe(scenario.pipelineId);
  expect(ticket.pipelineVersion).toBeNull();
});

test('starting a draft pins the version and produces a run', async () => {
  const ticket = await draft(scenario.pipelineId);

  const { run, snapshot } = await start(ticket.id);

  expect(run.status).toBe('queued');
  expect(snapshot.pipeline.version).toBe(scenario.pipelineVersion);

  const [after] = await db.select().from(tickets).where(eq(tickets.id, ticket.id)).limit(1);
  expect(after?.pipelineVersion).toBe(scenario.pipelineVersion);
});

test('the version pinned is the one current at the start, not at the saving', async () => {
  const ticket = await draft(scenario.pipelineId);

  // The pipeline is edited while the draft waits. A draft started afterwards
  // runs the pipeline as it stands that day; the pin is what stops it moving
  // again once the run is going.
  const steps: Step[] = [
    { type: 'agent', condition: 'always', agent_id: scenario.specAgentId, output_files: [] },
  ];
  await db
    .insert(pipelineVersions)
    .values({ pipelineId: scenario.pipelineId, version: 2, steps });
  await db.update(pipelines).set({ currentVersion: 2 }).where(eq(pipelines.id, scenario.pipelineId));

  const { snapshot } = await start(ticket.id);

  expect(snapshot.pipeline.version).toBe(2);
  expect(snapshot.pipeline.steps).toHaveLength(1);
});

test('a draft whose pipeline is gone says which thing is missing', async () => {
  const ticket = await draft(scenario.pipelineId);
  await db.update(tickets).set({ pipelineId: null }).where(eq(tickets.id, ticket.id));

  const failure = await start(ticket.id).catch((error: unknown) => error);

  expect(failure).toBeInstanceOf(FactoryError);
  expect((failure as FactoryError).message).toMatch(/pipeline/);
});
