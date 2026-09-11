import { afterAll, beforeEach, expect, test } from 'bun:test';
import { agents, pipelines, skills, tickets, users } from '@factory/db/schema';
import { eq } from 'drizzle-orm';
import type { SessionUser } from '../../src/lib/services/auth';
import { invite, listMembers, remove, setRole } from '../../src/lib/services/members';
import { connect, type Scenario, seed } from '../fixtures';

/**
 * FR-003, FR-004 and FR-005 — two roles, administrators manage membership,
 * and the workspace can never end up with nobody who could change that.
 *
 * The last-administrator rule is a claim about the whole workspace, so it
 * needs a database with nothing else in it: seed() empties one first. The
 * browser suite shares a single database across parallel specs, which is why
 * this invariant lives here and not there.
 */

const { db, sql: raw } = connect();
let scenario: Scenario;
let admin: SessionUser;
let member: SessionUser;

beforeEach(async () => {
  scenario = await seed(db);
  const [adminRow] = await db
    .insert(users)
    .values({ name: 'Admin', email: 'admin@netgroup.mn', role: 'admin' })
    .returning();
  if (!adminRow) throw new Error('no admin');
  admin = { id: adminRow.id, name: adminRow.name, email: adminRow.email, role: 'admin' };
  // seed()'s own user, who created the ticket, is the member.
  const [memberRow] = await db.select().from(users).where(eq(users.id, scenario.userId));
  if (!memberRow) throw new Error('no member');
  member = { id: memberRow.id, name: memberRow.name, email: memberRow.email, role: 'member' };
});
afterAll(async () => {
  await raw.end();
});

test('the last administrator cannot be demoted, so the workspace stays reachable', async () => {
  const only = await db.select().from(users).where(eq(users.role, 'admin'));
  expect(only).toHaveLength(1);

  await expect(setRole(db, admin.id, 'member', admin)).rejects.toThrow(/only administrator/i);
  const [after] = await db.select().from(users).where(eq(users.id, admin.id));
  expect(after?.role).toBe('admin');
});

test('once somebody else is an administrator, the first one may step down', async () => {
  await setRole(db, member.id, 'admin', admin);
  // Now there are two, so neither is the last.
  const stepped = await setRole(db, admin.id, 'member', admin);
  expect(stepped).toEqual({ role: 'member' });

  const remaining = await db.select().from(users).where(eq(users.role, 'admin'));
  expect(remaining.map((row) => row.id)).toEqual([member.id]);
});

test('the last administrator cannot remove themselves, which is the same lock', async () => {
  // Removal is what would otherwise strand the workspace, and refusing
  // self-removal is what prevents it: an administrator can only remove
  // somebody else, so an administrator target always leaves the remover.
  await expect(remove(db, admin.id, admin)).rejects.toThrow(/cannot remove yourself/i);

  // Still true with a second administrator, so it is not a count check in
  // disguise — you never remove yourself, you are removed by another.
  await setRole(db, member.id, 'admin', admin);
  await expect(remove(db, admin.id, admin)).rejects.toThrow(/cannot remove yourself/i);
  const removed = await remove(db, admin.id, {
    id: member.id,
    name: member.name,
    email: member.email,
    role: 'admin',
  });
  expect(removed.removed).toBe(true);
  const left = await db.select().from(users).where(eq(users.role, 'admin'));
  expect(left.map((row) => row.id)).toEqual([member.id]);
});

test('a member cannot change a role, so the lock is not merely a hidden button', async () => {
  await expect(setRole(db, member.id, 'admin', member)).rejects.toThrow();
  await expect(invite(db, { name: 'X', email: 'x@y.dev' }, member)).rejects.toThrow();
  await expect(listMembers(db, member)).rejects.toThrow();
  // And not signed in at all.
  await expect(setRole(db, member.id, 'admin', null)).rejects.toThrow();
});

test('somebody invited arrives as a member with no password', async () => {
  const { id } = await invite(db, { name: 'Sara', email: ' Sara@Netgroup.MN ' }, admin);
  const [row] = await db.select().from(users).where(eq(users.id, id));
  expect(row?.role).toBe('member');
  expect(row?.passwordHash).toBeNull();
  // Trimmed and lowercased, so the same person cannot be invited twice by
  // typing their address differently.
  expect(row?.email).toBe('sara@netgroup.mn');
  await expect(
    invite(db, { name: 'Sara again', email: 'sara@netgroup.mn' }, admin),
  ).rejects.toThrow(/already in this workspace/i);
});

test('an address that is not an address is refused, with the value quoted back', async () => {
  await expect(invite(db, { name: 'Sara', email: 'sara-at-netgroup' }, admin)).rejects.toThrow(
    /sara-at-netgroup does not look like an email address/,
  );
  await expect(invite(db, { name: '   ', email: 'ok@y.dev' }, admin)).rejects.toThrow(
    /Give them a name/,
  );
});

test('removing somebody keeps their tickets and hands on what they owned', async () => {
  await db.insert(pipelines).values({ name: 'Theirs', currentVersion: 1, ownerId: member.id });
  await db.insert(agents).values({
    name: 'Theirs',
    kind: 'custom',
    engine: 'claude_cli',
    model: 'claude-sonnet-5',
    systemPrompt: 'x',
    allowedTools: ['Read'],
    ownerId: member.id,
  });
  await db
    .insert(skills)
    .values({ name: 'Theirs', description: 'x', content: 'x', ownerId: member.id });

  const result = await remove(db, member.id, admin);
  expect(result.ticketsKept).toBe(1);
  expect(result.ownedTransferred).toBe(3);

  // The record of what happened survives the person losing access.
  const kept = await db.select().from(tickets).where(eq(tickets.createdBy, member.id));
  expect(kept).toHaveLength(1);
  const [revoked] = await db.select().from(users).where(eq(users.id, member.id));
  expect(revoked?.passwordHash).toBeNull();
  expect(revoked?.provider).toBeNull();

  // And nothing they owned is now unchangeable.
  const theirPipelines = await db.select().from(pipelines).where(eq(pipelines.ownerId, admin.id));
  expect(theirPipelines).toHaveLength(1);
});

test('somebody who created nothing is deleted outright rather than lingering', async () => {
  const { id } = await invite(db, { name: 'Never used', email: 'never@y.dev' }, admin);
  const result = await remove(db, id, admin);
  expect(result.ticketsKept).toBe(0);

  const gone = await db.select().from(users).where(eq(users.id, id));
  expect(gone).toHaveLength(0);
});

test('a member list counts what each person has created, before anyone is removed', async () => {
  const listed = await listMembers(db, admin);
  const them = listed.find((row) => row.id === member.id);
  expect(them?.ticketsCreated).toBe(1);
  expect(listed.find((row) => row.id === admin.id)?.ticketsCreated).toBe(0);
});

test('changing a role for somebody who is not there says so', async () => {
  await expect(setRole(db, '00000000-0000-4000-8000-000000000000', 'admin', admin)).rejects.toThrow(
    /no such person/i,
  );
});
