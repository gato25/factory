import { afterAll, beforeEach, expect, test } from 'bun:test';
import { artifacts, runs, tickets } from '@factory/db/schema';
import type { PipelineSnapshot } from '@factory/shared';
import {
  firstAttempt,
  firstAttemptOf,
  firstAttemptRows,
} from '../../src/lib/services/first-attempt';
import { connect, type Scenario, seed } from '../fixtures';

/**
 * specs/004-bento-redesign FR-012 and SC-004: the dashboard's first-attempt
 * figure counts exactly what the first-attempt audit counts, because both
 * call this one function.
 *
 * Population: tickets created in the window, not drafts, with at least one
 * acceptance criterion. Decided: minus those still queued, running or
 * waiting. Success: a merge request, only one attempt, that attempt done, and
 * no artifact of it edited by a person.
 */

const { db, sql: raw } = connect();
let scenario: Scenario;
const DAY = 24 * 60 * 60 * 1000;
const since = () => new Date(Date.now() - 30 * DAY);

beforeEach(async () => {
  scenario = await seed(db);
  // seed() leaves one queued ticket with criteria: undecided, so outside the count.
});
afterAll(async () => {
  await raw.end();
});

let counter = 500;
async function ticket(input: {
  status: 'draft' | 'queued' | 'running' | 'waiting_approval' | 'done' | 'failed' | 'cancelled';
  criteria?: string[];
  createdDaysAgo?: number;
  mergeRequest?: boolean;
  attempts?: ('done' | 'failed')[];
  editedOnFirst?: boolean;
}) {
  counter += 1;
  const [row] = await db
    .insert(tickets)
    .values({
      repositoryId: scenario.repositoryId,
      createdBy: scenario.userId,
      reference: `#${counter}`,
      title: `Ticket ${counter}`,
      acceptanceCriteria: input.criteria ?? ['it works'],
      pipelineId: scenario.pipelineId,
      pipelineVersion: 1,
      status: input.status,
      mergeRequestUrl: input.mergeRequest
        ? `https://gitlab.com/x/-/merge_requests/${counter}`
        : null,
      createdAt: new Date(Date.now() - (input.createdDaysAgo ?? 2) * DAY),
    })
    .returning();
  for (const [i, status] of (input.attempts ?? []).entries()) {
    const [run] = await db
      .insert(runs)
      .values({
        ticketId: row!.id,
        attempt: i + 1,
        snapshot: {} as PipelineSnapshot,
        status,
        costCeilingUsd: '5.0000',
        timeCeilingMinutes: 45,
        finishedAt: new Date(),
      })
      .returning();
    if (i === 0 && input.editedOnFirst) {
      await db.insert(artifacts).values({
        runId: run!.id,
        stepIndex: 1,
        kind: 'document',
        path: 'docs/plan.md',
        version: 2,
        content: 'edited by a person',
        createdBy: scenario.userId,
      });
    }
  }
  return row!.id;
}

test('counts only decided tickets with criteria in the window, and the first-attempt successes among them', async () => {
  await ticket({ status: 'done', mergeRequest: true, attempts: ['done'] }); // success
  await ticket({ status: 'done', mergeRequest: true, attempts: ['failed', 'done'] }); // second attempt
  await ticket({ status: 'done', mergeRequest: true, attempts: ['done'], editedOnFirst: true }); // edited
  await ticket({ status: 'failed', attempts: ['failed'] }); // failed
  await ticket({ status: 'done', mergeRequest: true, attempts: ['done'], criteria: [] }); // no criteria
  await ticket({ status: 'done', mergeRequest: true, attempts: ['done'], createdDaysAgo: 40 }); // too old
  await ticket({ status: 'running', attempts: ['done'] }); // undecided
  await ticket({ status: 'waiting_approval', attempts: ['done'] }); // undecided
  await ticket({ status: 'draft' }); // draft

  expect(await firstAttempt(db, { since: since() })).toEqual({
    counted: 4,
    successes: 1,
    rate: 0.25,
  });
});

test('with nothing decided there is no rate, rather than a rate of zero', async () => {
  await ticket({ status: 'running', attempts: ['done'] });
  await ticket({ status: 'done', mergeRequest: true, attempts: ['done'], criteria: [] });
  expect(await firstAttempt(db, { since: since() })).toEqual({
    counted: 0,
    successes: 0,
    rate: null,
  });
});

test('what the audit reads is the same classification, with the reasons it prints', async () => {
  const success = await ticket({ status: 'done', mergeRequest: true, attempts: ['done'] });
  const second = await ticket({ status: 'done', mergeRequest: true, attempts: ['failed', 'done'] });
  const edited = await ticket({
    status: 'done',
    mergeRequest: true,
    attempts: ['done'],
    editedOnFirst: true,
  });
  await ticket({ status: 'done', mergeRequest: true, attempts: ['done'], criteria: [] });
  await ticket({ status: 'running', attempts: ['done'] });

  const rows = await firstAttemptRows(db, since());
  const result = firstAttemptOf(rows);
  expect(result.decided.map((r) => r.id).sort()).toEqual([success, second, edited].sort());
  expect(result.successes.map((r) => r.id)).toEqual([success]);
  expect(result.noCriteria).toHaveLength(1);
  // The seeded queued ticket and the running one.
  expect(result.undecided).toHaveLength(2);
  expect(result.rate).toBeCloseTo(1 / 3);
  const reasons = Object.fromEntries(result.missed.map((m) => [m.row.id, m.why.kind]));
  expect(reasons[second]).toBe('later_attempt');
  expect(reasons[edited]).toBe('edited');
});

test('a ticket the audit is told to leave out is left out of the population', async () => {
  const success = await ticket({ status: 'done', mergeRequest: true, attempts: ['done'] });
  await ticket({ status: 'failed', attempts: ['failed'] });
  const rows = await firstAttemptRows(db, since());
  const reference = rows.find((r) => r.id !== success && r.status === 'failed')
    ?.reference as string;
  const result = firstAttemptOf(rows, { exclude: new Set([reference]) });
  expect(result.excluded).toHaveLength(1);
  expect(result.counted).toBe(1);
  expect(result.rate).toBe(1);
});
