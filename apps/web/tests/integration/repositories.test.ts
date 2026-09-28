import { afterAll, beforeEach, expect, test } from 'bun:test';
import { repositories, tickets } from '@factory/db/schema';
import { eq } from 'drizzle-orm';
import { listRepositories } from '../../src/lib/services/repository';
import { connect, type Scenario, seed } from '../fixtures';

/**
 * specs/004-bento-redesign FR-015: each repository's tile names the latest
 * ticket worked on there and when — the one most recently updated — or
 * nothing when it has none, read for every repository at once.
 */

const { db, sql: raw } = connect();
let scenario: Scenario;

beforeEach(async () => {
  scenario = await seed(db);
});
afterAll(async () => {
  await raw.end();
});

const MINUTE = 60_000;

test('latest is the most recently updated ticket on each repository', async () => {
  const now = Date.now();
  // seed()'s own ticket was touched long before these two.
  await db
    .update(tickets)
    .set({ updatedAt: new Date(now - 120 * MINUTE) })
    .where(eq(tickets.id, scenario.ticketId));
  await db.insert(tickets).values([
    {
      repositoryId: scenario.repositoryId,
      createdBy: scenario.userId,
      reference: '#200',
      title: 'Older, but touched last',
      status: 'done',
      createdAt: new Date(now - 60 * MINUTE),
      updatedAt: new Date(now - MINUTE),
    },
    {
      repositoryId: scenario.repositoryId,
      createdBy: scenario.userId,
      reference: '#201',
      title: 'Newer, untouched since',
      status: 'draft',
      createdAt: new Date(now - 10 * MINUTE),
      updatedAt: new Date(now - 10 * MINUTE),
    },
  ]);

  const list = await listRepositories(db);
  const repo = list.find((r) => r.id === scenario.repositoryId)!;
  expect(repo.latest).toEqual({
    reference: '#200',
    title: 'Older, but touched last',
    at: new Date(now - MINUTE).toISOString(),
  });
});

test('a repository with no ticket has no latest', async () => {
  const [bare] = await db
    .insert(repositories)
    .values({
      name: 'empty',
      fullPath: 'netgroup/empty',
      provider: 'github',
      cloneUrl: 'https://github.com/netgroup/empty.git',
    })
    .returning();
  const list = await listRepositories(db);
  expect(list.find((r) => r.id === bare!.id)?.latest).toBeNull();
});

test('the latest tickets are one query for the whole list, not one per repository', async () => {
  for (let i = 0; i < 4; i += 1) {
    const [repo] = await db
      .insert(repositories)
      .values({
        name: `repo-${i}`,
        fullPath: `netgroup/repo-${i}`,
        provider: 'gitlab',
        cloneUrl: `https://gitlab.com/netgroup/repo-${i}.git`,
      })
      .returning();
    await db.insert(tickets).values({
      repositoryId: repo!.id,
      createdBy: scenario.userId,
      reference: `#30${i}`,
      title: `Ticket ${i}`,
      status: 'draft',
    });
  }
  // Counted by the driver: whatever the number of repositories, the same
  // handful of reads — the list, the two counts, the names, the latest.
  const counted = async (count: number) => {
    let queries = 0;
    const counting = new Proxy(db, {
      get(target, key, receiver) {
        const value = Reflect.get(target, key, receiver);
        if (typeof value === 'function' && String(key).startsWith('select')) {
          return (...args: unknown[]) => {
            queries += 1;
            return value.apply(target, args);
          };
        }
        return value;
      },
    });
    const list = await listRepositories(counting);
    expect(list.length).toBe(count);
    return queries;
  };
  const withFive = await counted(5);
  for (let i = 4; i < 8; i += 1) {
    await db.insert(repositories).values({
      name: `repo-${i}`,
      fullPath: `netgroup/repo-${i}`,
      provider: 'gitlab',
      cloneUrl: `https://gitlab.com/netgroup/repo-${i}.git`,
    });
  }
  expect(await counted(9)).toBe(withFive);
  expect(withFive).toBe(5);
});
