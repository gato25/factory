import { afterAll, beforeEach, expect, test } from 'bun:test';
import { pipelines, pipelineVersions } from '@factory/db/schema';
import type { Step } from '@factory/shared';
import { eq } from 'drizzle-orm';
import { listPipelines } from '../../src/lib/services/pipeline';
import { connect, type Scenario, seed } from '../fixtures';

/**
 * specs/004-bento-redesign FR-019: each pipeline choice on the creation form
 * shows its number of steps — the steps of its CURRENT version, which is the
 * version a ticket created now pins — read for the whole list at once.
 */

const { db, sql: raw } = connect();
let scenario: Scenario;

beforeEach(async () => {
  scenario = await seed(db);
});
afterAll(async () => {
  await raw.end();
});

const steps = (n: number): Step[] =>
  Array.from({ length: n }, () => ({
    type: 'agent',
    condition: 'always',
    agent_id: scenario.specAgentId,
    output_files: [],
  }));

test('stepCount is the length of each pipeline’s current version', async () => {
  const [other] = await db
    .insert(pipelines)
    .values({ name: 'Reviewed', currentVersion: 1 })
    .returning();
  await db.insert(pipelineVersions).values({ pipelineId: other!.id, version: 1, steps: steps(7) });

  const list = await listPipelines(db);
  const count = (id: string) => list.find((p) => p.id === id)?.stepCount;
  // seed()'s pipeline has two steps at version 1.
  expect(count(scenario.pipelineId)).toBe(2);
  expect(count(other!.id)).toBe(7);
});

test('a pipeline saved twice reports its latest version’s count, not its first', async () => {
  await db
    .insert(pipelineVersions)
    .values({ pipelineId: scenario.pipelineId, version: 2, steps: steps(5) });
  await db
    .update(pipelines)
    .set({ currentVersion: 2 })
    .where(eq(pipelines.id, scenario.pipelineId));

  const list = await listPipelines(db);
  expect(list.find((p) => p.id === scenario.pipelineId)?.stepCount).toBe(5);
});

test('the whole list is one query for the pipelines and their steps', async () => {
  for (let i = 0; i < 4; i += 1) {
    const [row] = await db
      .insert(pipelines)
      .values({ name: `Pipeline ${i}`, currentVersion: 1 })
      .returning();
    await db
      .insert(pipelineVersions)
      .values({ pipelineId: row!.id, version: 1, steps: steps(i + 1) });
  }
  // Counted by the driver: the list plus the repositories' usage, whatever the number of pipelines.
  let queries = 0;
  const counting = new Proxy(db, {
    get(target, key, receiver) {
      const value = Reflect.get(target, key, receiver);
      if (key === 'select' && typeof value === 'function') {
        return (...args: unknown[]) => {
          queries += 1;
          return value.apply(target, args);
        };
      }
      return value;
    },
  });
  const list = await listPipelines(counting);
  expect(list.map((p) => p.stepCount).sort()).toEqual([1, 2, 2, 3, 4]);
  expect(queries).toBe(2);
});
