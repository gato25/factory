import { afterAll, beforeEach, expect, test } from 'bun:test';
import type { Database } from '@factory/db';
import { skillVersions, users } from '@factory/db/schema';
import type { SessionUser } from '../../src/lib/services/auth';
import {
  createSkill,
  deleteSkill,
  getSkill,
  skillHistory,
  updateSkill,
} from '../../src/lib/services/skill';
import { connect, seed } from '../fixtures';

/**
 * T210 — a skill's editor offers History, and the history has to be the real
 * record rather than a list of "edited" events: what the skill SAID at each
 * version is the thing somebody needs when a run from last week did
 * something odd.
 */

const { db, sql: raw } = connect();
let author: SessionUser;
let other: SessionUser;

beforeEach(async () => {
  const scenario = await seed(db);
  author = { id: scenario.userId, name: 'Bat', email: 'bat@netgroup.mn', role: 'member' };
  const [row] = await db
    .insert(users)
    .values({ name: 'Sara', email: 'sara@netgroup.mn', role: 'member' })
    .returning();
  if (!row) throw new Error('no user');
  other = { id: row.id, name: row.name, email: row.email, role: row.role };
});
afterAll(async () => {
  await raw.end();
});

const written = { name: 'house-style', description: 'When writing prose', content: '# One' };

test('a new skill starts at version 1, holding what was written', async () => {
  const { id } = await createSkill(db, written, author);

  const versions = await skillHistory(db, id);
  expect(versions).toHaveLength(1);
  expect(versions[0]?.version).toBe(1);
  expect(versions[0]?.content).toBe('# One');
  expect(versions[0]?.authorName).toBe('Bat');
  expect(versions[0]?.current).toBe(true);

  // And the skill still reads back as written.
  expect((await getSkill(db, id, author)).content).toBe('# One');
});

test('each save adds a version, newest first, and the older text survives', async () => {
  const { id } = await createSkill(db, written, author);
  const second = await updateSkill(db, id, { ...written, content: '# Two' }, author);
  const third = await updateSkill(db, id, { ...written, content: '# Three' }, author);
  // The number the save reports back is the one it wrote, which is what the
  // screen tells the person who pressed Save.
  expect([second.version, third.version]).toEqual([2, 3]);

  const versions = await skillHistory(db, id);
  expect(versions.map((v) => v.version)).toEqual([3, 2, 1]);
  expect(versions.map((v) => v.content)).toEqual(['# Three', '# Two', '# One']);
  // Exactly one version is the current one, and it is the newest.
  expect(versions.filter((v) => v.current).map((v) => v.version)).toEqual([3]);
});

test('a version records who wrote it, not only who owns the skill', async () => {
  const { id } = await createSkill(db, written, author);
  // An administrator may change another member's skill (FR-006c); the
  // history has to say it was them.
  await updateSkill(
    db,
    id,
    { ...written, content: '# Edited' },
    { ...other, role: 'admin' as const },
  );

  const versions = await skillHistory(db, id);
  expect(versions.map((v) => v.authorName)).toEqual(['Sara', 'Bat']);
});

test('the name and description are versioned too, not only the content', async () => {
  const { id } = await createSkill(db, written, author);
  await updateSkill(
    db,
    id,
    { name: 'house-voice', description: 'When writing anything public', content: '# One' },
    author,
  );

  const [newest, first] = await skillHistory(db, id);
  expect(newest?.name).toBe('house-voice');
  expect(first?.name).toBe('house-style');
  expect(first?.description).toBe('When writing prose');
});

test('a refused save leaves no version behind', async () => {
  const { id } = await createSkill(db, written, author);
  const taken = await createSkill(db, { ...written, name: 'taken' }, author);
  expect(taken.id).toBeString();

  // Renaming onto a name already in use is refused by the unique index, and
  // the version write shares its transaction — so nothing is recorded.
  await expect(updateSkill(db, id, { ...written, name: 'taken' }, author)).rejects.toThrow();

  const versions = await skillHistory(db, id);
  expect(versions.map((v) => v.version)).toEqual([1]);
  expect(versions[0]?.name).toBe('house-style');
  // And the skill itself is untouched.
  expect((await getSkill(db, id, author)).name).toBe('house-style');
});

test('a save whose version cannot be recorded changes nothing', async () => {
  const { id } = await createSkill(db, written, author);

  // Two people saving one skill at the same moment both compute the same
  // next version, and one of the two inserts loses to the unique index. The
  // save that loses has to lose entirely: a skill that changed with no
  // version recorded is a change nobody can read back.
  await expect(
    updateSkill(whereVersionsCannotBeWritten(db), id, { ...written, content: '# Mine' }, author),
  ).rejects.toThrow('version taken');

  expect((await getSkill(db, id, author)).content).toBe('# One');
  expect((await skillHistory(db, id)).map((v) => v.version)).toEqual([1]);
});

/** The same database, except that writing a version fails. */
function whereVersionsCannotBeWritten(database: Database): Database {
  const brokenTx = (tx: unknown) =>
    new Proxy(tx as object, {
      get(target, property, receiver) {
        if (property !== 'insert') return Reflect.get(target, property, receiver);
        return (table: unknown) => {
          if (table === skillVersions) throw new Error('version taken');
          return (Reflect.get(target, property, receiver) as (t: unknown) => unknown).call(
            target,
            table,
          );
        };
      },
    });

  return new Proxy(database as object, {
    get(target, property, receiver) {
      if (property !== 'transaction') return Reflect.get(target, property, receiver);
      return (work: (tx: unknown) => unknown) =>
        (database as Database).transaction((tx) => work(brokenTx(tx)) as Promise<unknown>);
    },
  }) as Database;
}

test('deleting a skill takes its history with it', async () => {
  const { id } = await createSkill(db, written, author);
  await updateSkill(db, id, { ...written, content: '# Two' }, author);
  await deleteSkill(db, id, author);

  expect(await skillHistory(db, id)).toEqual([]);
});

test('history is readable by someone who may not change the skill', async () => {
  const { id } = await createSkill(db, written, author);
  // Sara owns nothing here and is not an administrator.
  await expect(updateSkill(db, id, { ...written, content: '# No' }, other)).rejects.toThrow();
  expect((await skillHistory(db, id)).map((v) => v.content)).toEqual(['# One']);
});
