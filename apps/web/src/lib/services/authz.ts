import { type ApproverRule, notAuthorised } from '@factory/shared';
import type { SessionUser } from './auth';

/**
 * Exactly three rules cover the whole surface (contracts/ui-data.md). Every
 * one is checked INSIDE a remote function, never in a component.
 *
 * Each rule comes in two forms on purpose. The `can*` predicate lets an
 * interface show an object without its action, so a caller who may read but
 * not change sees no button rather than an error after the fact. The
 * `require*` form throws, and is what actually guards the mutation.
 */

/** Workspace credentials, dependency connections, ceilings, membership (FR-004). */
export function isAdmin(user: SessionUser | null): boolean {
  return user?.role === 'admin';
}

export function requireAdmin(user: SessionUser | null): SessionUser {
  if (!user) throw notAuthorised('та нэвтэрсэн байх ёстой');
  if (user.role !== 'admin') {
    throw notAuthorised('ажлын талбарын тохиргоог зөвхөн администратор өөрчилнө');
  }
  return user;
}

/**
 * A pipeline, agent or skill: readable and usable by anyone, changeable only
 * by its owner or an administrator (FR-006c). A shipped default has no owner
 * and is therefore administrator-only to change (FR-006b).
 */
export function canChangeOwned(user: SessionUser | null, ownerId: string | null): boolean {
  if (!user) return false;
  if (user.role === 'admin') return true;
  return ownerId !== null && ownerId === user.id;
}

export function requireOwnerOrAdmin(
  user: SessionUser | null,
  ownerId: string | null,
  what = 'Энэ зүйл',
): SessionUser {
  if (!user) throw notAuthorised('та нэвтэрсэн байх ёстой');
  if (!canChangeOwned(user, ownerId)) {
    throw notAuthorised(`${what} өөр хүнийх — та ашиглаж болно, өөрчилж болохгүй`);
  }
  return user;
}

/**
 * A gate decision: only the gate's configured approvers, while anyone in the
 * workspace may read the ticket and its artifacts (FR-064).
 */
export function canDecide(
  user: SessionUser | null,
  approvers: ApproverRule,
  ticketCreatedBy: string,
): boolean {
  if (!user) return false;
  if (approvers === 'anyone') return true;
  if (approvers === 'ticket_creator') return user.id === ticketCreatedBy;
  return approvers.includes(user.id);
}

export function requireApprover(
  user: SessionUser | null,
  approvers: ApproverRule,
  ticketCreatedBy: string,
): SessionUser {
  if (!user) throw notAuthorised('та нэвтэрсэн байх ёстой');
  if (!canDecide(user, approvers, ticketCreatedBy)) {
    throw notAuthorised('энэ хяналтын цэгийг та шийдэхгүй');
  }
  return user;
}
