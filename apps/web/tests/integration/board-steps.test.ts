import { afterAll, beforeEach, expect, test } from 'bun:test';
import { pipelineVersions, runs, stepResults, tickets } from '@factory/db/schema';
import type { PipelineSnapshot, Step } from '@factory/shared';
import { eq } from 'drizzle-orm';
import { board } from '../../src/lib/services/run-view';
import { connect, type Scenario, seed } from '../fixtures';

/**
 * specs/004-bento-redesign FR-018 and research D3: every card on the board
 * carries a step bar sized to the ticket's OWN pipeline — the steps its run
 * pinned, or before it has a run, the pipeline version the ticket pinned —
 * and never the pipeline's current definition (Constitution IV).
 */

const { db, sql: raw } = connect();
let scenario: Scenario;

beforeEach(async () => {
  scenario = await seed(db);
});
afterAll(async () => {
  await raw.end();
});

const agentSteps = (n: number): Step[] =>
  Array.from({ length: n }, () => ({
    type: 'agent',
    condition: 'always',
    agent_id: scenario.specAgentId,
    output_files: [],
  }));

let counter = 900;
async function withRun(steps: Step[], status: 'running' | 'waiting_approval', current: number) {
  counter += 1;
  const [ticket] = await db
    .insert(tickets)
    .values({
      repositoryId: scenario.repositoryId,
      createdBy: scenario.userId,
      reference: `#${counter}`,
      title: `Ticket ${counter}`,
      pipelineId: scenario.pipelineId,
      pipelineVersion: 1,
      status,
    })
    .returning();
  const [run] = await db
    .insert(runs)
    .values({
      ticketId: ticket!.id,
      attempt: 1,
      snapshot: {
        pipeline: { id: scenario.pipelineId, version: 1, name: 'Standard', steps },
        agents: [{ id: scenario.specAgentId, name: 'Spec' }],
      } as unknown as PipelineSnapshot,
      status,
      currentStepIndex: current,
      costCeilingUsd: '5.0000',
      timeCeilingMinutes: 45,
    })
    .returning();
  await db.update(tickets).set({ currentRunId: run!.id }).where(eq(tickets.id, ticket!.id));
  return { ticketId: ticket!.id, runId: run!.id };
}

test('board() returns bars of 3, 6 and 8 segments from each run’s own snapshot', async () => {
  const three = await withRun(agentSteps(2), 'running', 0);
  const six = await withRun(agentSteps(5), 'running', 2);
  const eight = await withRun(
    [
      ...agentSteps(3),
      { type: 'checkpoint', condition: 'always', approvers: 'anyone', on_timeout: 'wait' },
      ...agentSteps(3),
    ],
    'waiting_approval',
    3,
  );
  const cards = await board(db);
  const card = (id: string) => cards.find((c) => c.id === id)!;
  expect(card(three.ticketId).steps).toMatchObject({ count: 3, current: 0, state: 'running' });
  expect(card(six.ticketId).steps).toMatchObject({ count: 6, current: 2, state: 'running' });
  expect(card(eight.ticketId).steps).toMatchObject({ count: 8, current: 3, state: 'waiting' });
  expect(card(eight.ticketId).steps.kinds[3]).toBe('checkpoint');
  // The waiting card names the step its checkpoint gates, and since when.
  expect(card(eight.ticketId).gate?.step).toBe('Spec');
  expect(card(eight.ticketId).gate?.since).toBeString();
  expect(card(three.ticketId).gate).toBeNull();
});

test('a queued ticket without a run is drawn from its pinned version, nothing current', async () => {
  // seed()'s ticket is queued with no run, pinned to version 1 (two steps).
  const cards = await board(db);
  const queued = cards.find((c) => c.id === scenario.ticketId)!;
  expect(queued.steps).toEqual({
    count: 3,
    current: null,
    kinds: ['agent', 'agent', 'merge_request'],
    skipped: [],
    state: 'queued',
  });
});

test('a pipeline edited after the run started still draws the pinned version', async () => {
  const running = await withRun(agentSteps(2), 'running', 1);
  // A second version with seven steps becomes the pipeline's current one.
  await db
    .insert(pipelineVersions)
    .values({ pipelineId: scenario.pipelineId, version: 2, steps: agentSteps(7) });
  const cards = await board(db);
  expect(cards.find((c) => c.id === running.ticketId)!.steps.count).toBe(3);
  // And the unstarted ticket stays on the version it pinned, not the new one.
  expect(cards.find((c) => c.id === scenario.ticketId)!.steps.count).toBe(3);
});

test('a skipped step is marked skipped on the bar', async () => {
  const running = await withRun(agentSteps(4), 'running', 3);
  await db.insert(stepResults).values({
    runId: running.runId,
    stepIndex: 1,
    status: 'skipped',
    conditionNotMet: 'ticket has no UI change',
  });
  const cards = await board(db);
  expect(cards.find((c) => c.id === running.ticketId)!.steps.skipped).toEqual([1]);
});
