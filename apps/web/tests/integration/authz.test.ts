import { expect, test } from 'bun:test';
import type { SessionUser } from '../../src/lib/services/auth';
import {
  canChangeOwned,
  canDecide,
  isAdmin,
  requireAdmin,
  requireApprover,
  requireOwnerOrAdmin,
} from '../../src/lib/services/authz';

const admin: SessionUser = { id: 'u-admin', name: 'A', email: 'a@x.dev', role: 'admin' };
const member: SessionUser = { id: 'u-member', name: 'M', email: 'm@x.dev', role: 'member' };
const other: SessionUser = { id: 'u-other', name: 'O', email: 'o@x.dev', role: 'member' };

// --- rule 1: workspace settings are administrator-only (FR-004) ---

test('an administrator may change workspace settings', () => {
  expect(isAdmin(admin)).toBe(true);
  expect(requireAdmin(admin)).toBe(admin);
});

test('a member may not, and is told why', () => {
  expect(isAdmin(member)).toBe(false);
  expect(() => requireAdmin(member)).toThrow(/only an administrator/);
});

test('nobody signed out may change workspace settings', () => {
  expect(() => requireAdmin(null)).toThrow(/signed in/);
});

// --- rule 2: owner-or-administrator for pipelines, agents, skills (FR-006c) ---

test('a member may change what they own', () => {
  expect(canChangeOwned(member, member.id)).toBe(true);
  expect(requireOwnerOrAdmin(member, member.id)).toBe(member);
});

test("a member may not change someone else's, and the message says they can still use it", () => {
  expect(canChangeOwned(other, member.id)).toBe(false);
  expect(() => requireOwnerOrAdmin(other, member.id, 'that agent')).toThrow(
    /use it but not change it/,
  );
});

test('an administrator may change anything, including a shipped default', () => {
  expect(canChangeOwned(admin, member.id)).toBe(true);
  expect(canChangeOwned(admin, null)).toBe(true);
});

test('a shipped default is not changeable by a member (FR-006b)', () => {
  expect(canChangeOwned(member, null)).toBe(false);
});

// --- rule 3: only a gate's approvers may decide (FR-064) ---

test('anyone may decide an open gate', () => {
  expect(canDecide(other, 'anyone', member.id)).toBe(true);
});

test('a ticket_creator gate admits only the author', () => {
  expect(canDecide(member, 'ticket_creator', member.id)).toBe(true);
  expect(canDecide(other, 'ticket_creator', member.id)).toBe(false);
});

test('a named list admits only those named', () => {
  expect(canDecide(other, [other.id], member.id)).toBe(true);
  expect(canDecide(member, [other.id], member.id)).toBe(false);
  expect(() => requireApprover(member, [other.id], member.id)).toThrow(/not yours to decide/);
});

test('an administrator is NOT implicitly an approver — a gate names who decides', () => {
  // Deliberate: FR-064 scopes deciding to the gate's configured approvers.
  // Administrative power over settings is not power over someone's review.
  expect(canDecide(admin, [other.id], member.id)).toBe(false);
});

test('a reader who cannot act sees the object and no action, not an error', () => {
  // contracts/ui-data.md — the predicate exists so the interface can decide
  // what to render before any mutation is attempted.
  expect(canChangeOwned(other, member.id)).toBe(false);
  expect(canDecide(other, 'ticket_creator', member.id)).toBe(false);
});
