import { FactoryError, notAuthorised } from '@factory/shared';
import * as v from 'valibot';
import { command, form, getRequestEvent, query } from '$app/server';
import { db } from '$lib/db';
import { formBoolean, formInteger } from '$lib/forms';
import { keyRingFromEnv } from '$lib/secrets/store';
import { requireAdmin } from '$lib/services/authz';
import { readiness, testEverything } from '$lib/services/connections';
import { invite, listMembers, remove, setRole } from '$lib/services/members';
import { queueState } from '$lib/services/queue';
import { getWorkspace, storeCredential, updateWorkspace } from '$lib/services/workspace';

/**
 * Workspace settings. Every one of these checks the administrator rule
 * INSIDE the function (FR-004, contracts/ui-data.md) — the screen hiding a
 * section is a convenience, never the boundary.
 */

function requireUser() {
  const user = getRequestEvent().locals.user;
  if (!user) throw notAuthorised('you must be signed in');
  return user;
}

async function attempt<T extends object>(work: () => Promise<T>): Promise<T | { problem: string }> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof FactoryError) return { problem: error.message };
    throw error;
  }
}

export const settings = query(async () => {
  const user = requireUser();
  requireAdmin(user);
  return { workspace: await getWorkspace(db()), readiness: await readiness(db()) };
});

export const members = query(async () => {
  const user = requireUser();
  return listMembers(db(), user);
});

/** Anyone may see the queue: it is their own ticket's position (FR-082). */
export const queue = query(async () => {
  requireUser();
  return queueState(db());
});

export const connections = command(async () => {
  const user = requireUser();
  return attempt(async () => ({ results: await testEverything(db(), user) }));
});

const WorkspaceSchema = v.object({
  name: v.pipe(v.string(), v.trim(), v.minLength(1, 'Give the workspace a name.')),
  orchestratorBaseUrl: v.optional(v.string(), ''),
  orchestratorWorkflowId: v.optional(v.string(), ''),
  runnerBaseUrl: v.optional(v.string(), ''),
  defaultCostCeilingUsd: v.pipe(v.string(), v.trim(), v.minLength(1, 'Set a cost ceiling.')),
  defaultTimeCeilingMinutes: formInteger('Set a time ceiling in whole minutes.'),
  maxConcurrentRuns: formInteger('Set how many runs may execute at once.'),
  sandboxImage: v.pipe(v.string(), v.trim(), v.minLength(1, 'Name the sandbox image.')),
  sandboxCpu: formInteger('Set the processors as a whole number.'),
  sandboxMemoryMb: formInteger('Set the memory in whole megabytes.'),
  sandboxWallClockMinutes: formInteger('Set the sandbox lifetime in whole minutes.'),
  sandboxNetworkDuringImplement: formBoolean(),
  retainFailedSandboxesHours: formInteger('Set the retention in whole hours.'),
});

export const saveWorkspace = form(WorkspaceSchema, async (input) => {
  const user = requireUser();
  return attempt(async () => {
    await updateWorkspace(
      db(),
      {
        ...input,
        orchestratorBaseUrl: input.orchestratorBaseUrl.trim() || null,
        orchestratorWorkflowId: input.orchestratorWorkflowId.trim() || null,
        runnerBaseUrl: input.runnerBaseUrl.trim() || null,
      },
      user,
    );
    await settings().refresh();
    return { message: 'Saved. Runs already in flight keep the ceilings they started with.' };
  });
});

/**
 * A credential is written and never read back (FR-011). What comes back is
 * whether one is stored, so the screen can say "replace" rather than showing
 * a masked value nobody can verify.
 */
const CredentialSchema = v.object({
  kind: v.picklist(['model', 'design'] as const),
  token: v.pipe(v.string(), v.trim(), v.minLength(1, 'Paste the credential.')),
});

export const saveCredential = form(CredentialSchema, async (input) => {
  const user = requireUser();
  return attempt(async () => {
    await storeCredential(db(), input, user, keyRingFromEnv());
    await settings().refresh();
    return { message: 'Stored. It is encrypted at rest and never shown again.' };
  });
});

const InviteSchema = v.object({
  name: v.pipe(v.string(), v.trim(), v.minLength(1, 'Give them a name.')),
  email: v.pipe(v.string(), v.trim(), v.email('That does not look like an email address.')),
  role: v.optional(v.picklist(['admin', 'member'] as const), 'member'),
});

export const inviteMember = form(InviteSchema, async (input) => {
  const user = requireUser();
  return attempt(async () => {
    const created = await invite(db(), input, user);
    await members().refresh();
    return { id: created.id, message: `${input.email} can sign in now.` };
  });
});

export const changeRole = command(
  v.object({
    userId: v.pipe(v.string(), v.uuid()),
    role: v.picklist(['admin', 'member'] as const),
  }),
  async ({ userId, role }) => {
    const user = requireUser();
    return attempt(async () => {
      await setRole(db(), userId, role, user);
      await members().refresh();
      return { role, message: `Now ${role === 'admin' ? 'an administrator' : 'a member'}.` };
    });
  },
);

export const removeMember = command(v.pipe(v.string(), v.uuid()), async (userId) => {
  const user = requireUser();
  return attempt(async () => {
    const { ticketsKept, ownedTransferred } = await remove(db(), userId, user);
    await members().refresh();
    const parts = ['Access revoked.'];
    if (ticketsKept > 0) {
      parts.push(
        `${ticketsKept} ticket${ticketsKept === 1 ? '' : 's'} they created stay${
          ticketsKept === 1 ? 's' : ''
        }: that is the record of what happened.`,
      );
    }
    if (ownedTransferred > 0) {
      parts.push(
        `${ownedTransferred} pipeline${ownedTransferred === 1 ? '' : 's'}, agent${
          ownedTransferred === 1 ? '' : 's'
        } or skill${ownedTransferred === 1 ? '' : 's'} they owned are now yours.`,
      );
    }
    return { message: parts.join(' ') };
  });
});
