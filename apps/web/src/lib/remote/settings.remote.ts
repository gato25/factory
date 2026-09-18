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
  if (!user) throw notAuthorised('та нэвтэрсэн байх ёстой');
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

/**
 * Whether the deployment can start a run at all, and what is missing.
 *
 * Not administrator-only, deliberately. A member cannot fix any of it
 * (FR-004), but without this the dashboard of an unconfigured deployment
 * says "create a ticket to start a pipeline" — advice that cannot work, and
 * that sends a new user into a form which refuses them for a reason nothing
 * has explained. What a member can do about it differs from what an
 * administrator can, so `canFix` says which.
 */
export const setup = query(async () => {
  const user = requireUser();
  // What a member can do about it differs from what an administrator can, so
  // `canFix` says which — everything else is the same question.
  return { ...(await readiness(db())), canFix: user.role === 'admin' };
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
  name: v.pipe(v.string(), v.trim(), v.minLength(1, 'Ажлын талбарт нэр өгнө үү.')),
  runnerBaseUrl: v.optional(v.string(), ''),
  defaultCostCeilingUsd: v.pipe(
    v.string(),
    v.trim(),
    v.minLength(1, 'Зардлын хязгаараа тогтооно уу.'),
  ),
  defaultTimeCeilingMinutes: formInteger('Хугацааны хязгаарыг бүхэл минутаар тогтооно уу.'),
  maxConcurrentRuns: formInteger('Зэрэг хэдэн ажиллагаа явахыг тогтооно уу.'),
  sandboxImage: v.pipe(v.string(), v.trim(), v.minLength(1, 'Sandbox образын нэрийг бичнэ үү.')),
  sandboxCpu: formInteger('Цөмийн тоог бүхэл тоогоор тогтооно уу.'),
  sandboxMemoryMb: formInteger('Санах ойг бүхэл мегабайтаар тогтооно уу.'),
  sandboxWallClockMinutes: formInteger('Орчны ажиллах хугацааг бүхэл минутаар тогтооно уу.'),
  sandboxNetworkDuringImplement: formBoolean(),
  retainFailedSandboxesHours: formInteger('Хадгалах хугацааг бүхэл цагаар тогтооно уу.'),
});

export const saveWorkspace = form(WorkspaceSchema, async (input) => {
  const user = requireUser();
  return attempt(async () => {
    await updateWorkspace(
      db(),
      {
        ...input,
        runnerBaseUrl: input.runnerBaseUrl.trim() || null,
      },
      user,
    );
    await settings().refresh();
    return { message: 'Хадгалагдлаа. Явж байгаа ажиллагаанууд эхэлсэн хязгаараа хадгална.' };
  });
});

/**
 * A credential is written and never read back (FR-011). What comes back is
 * whether one is stored, so the screen can say "replace" rather than showing
 * a masked value nobody can verify.
 */
const CredentialSchema = v.object({
  kind: v.picklist(['model', 'design'] as const),
  token: v.pipe(v.string(), v.trim(), v.minLength(1, 'Нууц түлхүүрээ буулгана уу.')),
});

export const saveCredential = form(CredentialSchema, async (input) => {
  const user = requireUser();
  return attempt(async () => {
    await storeCredential(db(), input, user, keyRingFromEnv());
    await settings().refresh();
    return { message: 'Хадгалагдлаа. Шифрлэгдэн хадгалагдах бөгөөд дахин харагдахгүй.' };
  });
});

const InviteSchema = v.object({
  name: v.pipe(v.string(), v.trim(), v.minLength(1, 'Тэдэнд нэр өгнө үү.')),
  email: v.pipe(v.string(), v.trim(), v.email('Энэ и-мэйл хаяг шиг харагдахгүй байна.')),
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
      return { role, message: `Одоо ${role === 'admin' ? 'администратор' : 'гишүүн'} боллоо.` };
    });
  },
);

export const removeMember = command(v.pipe(v.string(), v.uuid()), async (userId) => {
  const user = requireUser();
  return attempt(async () => {
    const { ticketsKept, ownedTransferred } = await remove(db(), userId, user);
    await members().refresh();
    const parts = ['Хандах эрхийг хураалаа.'];
    if (ticketsKept > 0) {
      parts.push(
        `Тэдний үүсгэсэн ${ticketsKept} даалгавар хэвээр үлдэнэ: энэ бол юу болсны бүртгэл юм.`,
      );
    }
    if (ownedTransferred > 0) {
      parts.push(
        `Тэдний эзэмшиж байсан ${ownedTransferred} дамжлага, агент эсвэл ур чадвар танайх боллоо.`,
      );
    }
    return { message: parts.join(' ') };
  });
});
