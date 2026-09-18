import type { Database } from '@factory/db';
import { credentials, workspaces } from '@factory/db/schema';
import { createLogger, invalidInput } from '@factory/shared';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { type KeyRing, seal } from '$lib/secrets/store';

const log = createLogger('web');

import type { SessionUser } from './auth';
import { requireAdmin } from './authz';

/**
 * The workspace's own settings: the ceilings that make unattended agent
 * execution financially safe, and the sandbox constraints that make it safe
 * in every other sense (FR-004, FR-085, FR-086).
 *
 * Every one of these is administrator-only, and every one of them is checked
 * here rather than in a component.
 */

export interface WorkspaceSettings {
  id: string;
  name: string;
  runnerBaseUrl: string | null;
  /** Present or absent; never readable back in full (FR-011). */
  hasModelCredential: boolean;
  hasDesignCredential: boolean;
  defaultCostCeilingUsd: string;
  defaultTimeCeilingMinutes: number;
  maxConcurrentRuns: number;
  sandboxImage: string;
  sandboxCpu: number;
  sandboxMemoryMb: number;
  sandboxWallClockMinutes: number;
  sandboxNetworkDuringImplement: boolean;
  retainFailedSandboxesHours: number;
}

/**
 * One row per deployment (spec Assumptions). "Limit 1" is not enough on its
 * own: if a second row ever existed, a read and a write could land on
 * different ones and a saved setting would appear not to save. So the row is
 * chosen deterministically — the oldest — everywhere, and `ensureWorkspace`
 * refuses to make a second.
 */
export async function theWorkspace(database: Database) {
  const [row] = await database.select().from(workspaces).orderBy(workspaces.createdAt).limit(1);
  return row;
}

/**
 * The workspace's settings.
 *
 * The row is created if it is not there, rather than reported missing. A
 * deployment has exactly one workspace by definition; the row is where its
 * settings live, not a thing somebody creates. Reporting its absence made a
 * fresh deployment answer 500 on `/settings` — the first screen an
 * administrator must visit, and the only place they could have configured
 * anything. There was no way out of that by hand: every write path already
 * created the row, and none of them was reachable.
 */
export async function getWorkspace(database: Database): Promise<WorkspaceSettings> {
  const row = await ensureWorkspace(database);

  return {
    id: row.id,
    name: row.name,
    runnerBaseUrl: row.runnerBaseUrl,
    // Whether one is stored, not what it is (FR-011).
    hasModelCredential: Boolean(row.modelCredentialId),
    hasDesignCredential: Boolean(row.designCredentialId),
    defaultCostCeilingUsd: row.defaultCostCeilingUsd,
    defaultTimeCeilingMinutes: row.defaultTimeCeilingMinutes,
    maxConcurrentRuns: row.maxConcurrentRuns,
    sandboxImage: row.sandboxImage,
    sandboxCpu: row.sandboxCpu,
    sandboxMemoryMb: row.sandboxMemoryMb,
    sandboxWallClockMinutes: row.sandboxWallClockMinutes,
    sandboxNetworkDuringImplement: row.sandboxNetworkDuringImplement,
    retainFailedSandboxesHours: row.retainFailedSandboxesHours,
  };
}

export async function ensureWorkspace(database: Database, name = 'Workspace') {
  const existing = await theWorkspace(database);
  if (existing) return existing;

  try {
    const [created] = await database.insert(workspaces).values({ name }).returning();
    if (created) {
      // Creating this row IS "this deployment is new", and it happens once.
      // The shipped agents and pipelines have to exist before anybody can
      // start anything: a ticket needs a pipeline (FR-033, FR-034). Failing
      // to install them must not fail the read that created the workspace,
      // though — an operator can run `bun run install-defaults` — so the
      // problem is logged rather than thrown.
      const { installDefaults } = await import('./install-defaults');
      try {
        await installDefaults(database);
      } catch (error) {
        log.error('could not install the shipped agents and pipelines', {
          detail: error instanceof Error ? error.message : String(error),
        });
      }
      return created;
    }
  } catch (error) {
    // Two first requests arriving together both see nothing and both insert;
    // the `workspaces_singleton` index refuses the second. That is the index
    // doing its job, not a failure — the row it wanted now exists.
    if (!flatten(error).includes('workspaces_singleton')) throw error;
  }

  const row = await theWorkspace(database);
  if (!row) throw new Error('could not create the workspace');
  return row;
}

export interface WorkspaceInput {
  name?: string;
  runnerBaseUrl?: string | null;
  defaultCostCeilingUsd?: string;
  defaultTimeCeilingMinutes?: number;
  maxConcurrentRuns?: number;
  sandboxImage?: string;
  sandboxCpu?: number;
  sandboxMemoryMb?: number;
  sandboxWallClockMinutes?: number;
  sandboxNetworkDuringImplement?: boolean;
  retainFailedSandboxesHours?: number;
}

/**
 * Every ceiling has a floor, because a ceiling of zero would stop every run
 * before it began — which looks like the product being broken rather than
 * being configured (FR-079).
 */
export async function updateWorkspace(
  database: Database,
  input: WorkspaceInput,
  user: SessionUser | null,
): Promise<{ changed: true }> {
  requireAdmin(user);
  const workspace = await ensureWorkspace(database);
  validate(input);

  await database
    .update(workspaces)
    .set({
      ...(input.name === undefined ? {} : { name: input.name.trim() }),
      ...(input.runnerBaseUrl === undefined ? {} : { runnerBaseUrl: input.runnerBaseUrl }),
      ...(input.defaultCostCeilingUsd === undefined
        ? {}
        : { defaultCostCeilingUsd: input.defaultCostCeilingUsd }),
      ...(input.defaultTimeCeilingMinutes === undefined
        ? {}
        : { defaultTimeCeilingMinutes: input.defaultTimeCeilingMinutes }),
      ...(input.maxConcurrentRuns === undefined
        ? {}
        : { maxConcurrentRuns: input.maxConcurrentRuns }),
      ...(input.sandboxImage === undefined ? {} : { sandboxImage: input.sandboxImage.trim() }),
      ...(input.sandboxCpu === undefined ? {} : { sandboxCpu: input.sandboxCpu }),
      ...(input.sandboxMemoryMb === undefined ? {} : { sandboxMemoryMb: input.sandboxMemoryMb }),
      ...(input.sandboxWallClockMinutes === undefined
        ? {}
        : { sandboxWallClockMinutes: input.sandboxWallClockMinutes }),
      ...(input.sandboxNetworkDuringImplement === undefined
        ? {}
        : { sandboxNetworkDuringImplement: input.sandboxNetworkDuringImplement }),
      ...(input.retainFailedSandboxesHours === undefined
        ? {}
        : { retainFailedSandboxesHours: input.retainFailedSandboxesHours }),
      updatedAt: new Date(),
    })
    .where(eq(workspaces.id, workspace.id));
  return { changed: true };
}

function validate(input: WorkspaceInput) {
  if (input.name !== undefined && !input.name.trim()) {
    throw invalidInput('Ажлын талбарт нэр өгнө үү.');
  }
  if (input.defaultCostCeilingUsd !== undefined && Number(input.defaultCostCeilingUsd) <= 0) {
    throw invalidInput('Тэг зардлын хязгаар нь ажиллагаа бүрийг эхлэхээс нь өмнө зогсооно.');
  }
  if (input.defaultTimeCeilingMinutes !== undefined && input.defaultTimeCeilingMinutes <= 0) {
    throw invalidInput('Тэг хугацааны хязгаар нь ажиллагаа бүрийг эхлэхээс нь өмнө зогсооно.');
  }
  if (input.maxConcurrentRuns !== undefined && input.maxConcurrentRuns < 1) {
    throw invalidInput('Хамгийн багадаа нэг ажиллагаа явах боломжтой байх ёстой.');
  }
  if (input.sandboxCpu !== undefined && input.sandboxCpu < 1) {
    throw invalidInput('Орчинд хамгийн багадаа нэг цөм хэрэгтэй.');
  }
  if (input.sandboxMemoryMb !== undefined && input.sandboxMemoryMb < 512) {
    throw invalidInput('512 MB-аас бага орчин хэрэгслүүдийг багтаахгүй.');
  }
  if (input.sandboxWallClockMinutes !== undefined && input.sandboxWallClockMinutes < 1) {
    throw invalidInput('Орчны ажиллах хугацаа тэг байвал ажиллагаа бүр эхлэхдээ л устна.');
  }
  if (input.retainFailedSandboxesHours !== undefined && input.retainFailedSandboxesHours < 0) {
    throw invalidInput(
      'Хадгалах хугацаа сөрөг байж болохгүй. Тэг гэдэг нь шууд чөлөөлнө гэсэн үг.',
    );
  }
}

/**
 * FR-086 — a failed run's sandbox may be kept for a bounded period so
 * somebody can look inside, and is destroyed after. Zero means release it
 * immediately, which is the default: a retained sandbox is a running
 * container nobody is watching.
 */
export async function sandboxesToRelease(
  database: Database,
): Promise<{ runId: string; containerId: string; why: 'ended' | 'retention_expired' }[]> {
  const { runs } = await import('@factory/db/schema');
  const { and, isNotNull, sql } = await import('drizzle-orm');
  const workspace = await getWorkspace(database);

  const rows = await database
    .select({
      id: runs.id,
      containerId: runs.containerId,
      status: runs.status,
      finishedAt: runs.finishedAt,
    })
    .from(runs)
    .where(
      and(
        isNotNull(runs.containerId),
        isNotNull(runs.finishedAt),
        sql`${runs.status} in ('done', 'failed', 'cancelled')`,
      ),
    );

  const now = Date.now();
  const retainMs = workspace.retainFailedSandboxesHours * 3_600_000;
  return rows.flatMap((row) => {
    if (!row.containerId || !row.finishedAt) return [];
    const keep = row.status === 'failed' ? retainMs : 0;
    const due = now - row.finishedAt.getTime() >= keep;
    if (!due) return [];
    return [
      {
        runId: row.id,
        containerId: row.containerId,
        why: keep > 0 ? ('retention_expired' as const) : ('ended' as const),
      },
    ];
  });
}

/**
 * Storing a workspace credential (FR-011). Written and never read back: what
 * comes out of `getWorkspace` is whether one exists, so the only way to
 * change it is to replace it.
 *
 * The sealing happens here rather than in a remote function because the
 * remote-function API is experimental and must stay a mechanical edit
 * (research.md risk 1) — and because a credential path is the last thing
 * that should live somewhere a signature change might disturb.
 */
export async function storeCredential(
  database: Database,
  input: { kind: 'model' | 'design'; token: string },
  user: SessionUser | null,
  ring: KeyRing,
): Promise<{ stored: true }> {
  requireAdmin(user);
  const token = input.token.trim();
  if (!token) throw invalidInput('Нууц түлхүүрээ буулгана уу.');

  const workspace = await ensureWorkspace(database);
  await attachCredential(database, workspace.id, input.kind, token, ring, user?.id ?? null);
  return { stored: true };
}

/**
 * Seals a credential, stores it, and points the workspace at it.
 *
 * `onlyIfUnset` is for seeding: two server processes starting together must
 * not both store the key from the environment. Each seals and inserts its own
 * row, but the link is a conditional UPDATE, so exactly one wins; the loser
 * finds it linked nothing and removes the row it just made, rather than
 * leaving a sealed copy of the key orphaned in the table.
 */
async function attachCredential(
  database: Database,
  workspaceId: string,
  kind: 'model' | 'design',
  token: string,
  ring: KeyRing,
  createdBy: string | null,
  options: { onlyIfUnset?: boolean } = {},
): Promise<boolean> {
  const sealed = seal(token, ring);
  const [row] = await database
    .insert(credentials)
    .values({
      kind,
      ciphertext: sealed.ciphertext,
      keyVersion: sealed.keyVersion,
      status: 'unverified',
      createdBy: createdBy ?? undefined,
    })
    .returning();
  if (!row) throw new Error('нууц түлхүүрийг хадгалж чадсангүй');

  const column = kind === 'model' ? workspaces.modelCredentialId : workspaces.designCredentialId;
  const linked = await database
    .update(workspaces)
    .set(
      kind === 'model'
        ? { modelCredentialId: row.id, updatedAt: new Date() }
        : { designCredentialId: row.id, updatedAt: new Date() },
    )
    .where(
      options.onlyIfUnset
        ? and(eq(workspaces.id, workspaceId), isNull(column))
        : eq(workspaces.id, workspaceId),
    )
    .returning({ id: workspaces.id });

  if (linked.length === 0) {
    await database.delete(credentials).where(eq(credentials.id, row.id));
    return false;
  }
  return true;
}

export interface WorkspaceBootstrapInput {
  runnerBaseUrl?: string;
  /** The model credential itself. Sealed with `ring` before it is stored. */
  modelKey?: string;
  ring?: KeyRing;
}

/**
 * Gives the workspace what the environment already knows — once, and only
 * into fields nobody has set.
 *
 * A fresh deployment's dashboard listed the runner address and a model
 * credential as missing, and sent the administrator to Settings to type them.
 * The address was in `.env` already; the application had read it for itself
 * and then asked again. This is the fix: the same fact, filled from the place
 * it was first stated.
 *
 * Only NULL columns take a value. Settings is the source of truth from the
 * moment somebody saves it, and a change to `.env` afterwards does not reach
 * a field that was set by hand — clearing the field in Settings is how you
 * ask for the environment's value again. The address writes use `coalesce`
 * so that rule holds even when two servers start at once.
 *
 * Runs on every startup, so it is idempotent and cheap: a row with nothing
 * left to fill costs one SELECT.
 */
export async function bootstrapWorkspace(
  database: Database,
  input: WorkspaceBootstrapInput,
): Promise<{ seeded: string[] }> {
  const workspace = await ensureWorkspace(database);
  const seeded: string[] = [];

  const wantsRunner = input.runnerBaseUrl && !workspace.runnerBaseUrl;
  if (wantsRunner) {
    const [after] = await database
      .update(workspaces)
      .set({
        runnerBaseUrl: sql`coalesce(${workspaces.runnerBaseUrl}, ${input.runnerBaseUrl ?? null})`,
        updatedAt: new Date(),
      })
      .where(eq(workspaces.id, workspace.id))
      .returning();
    if (after?.runnerBaseUrl) seeded.push('runner address');
  }

  if (input.modelKey && input.ring && !workspace.modelCredentialId) {
    const attached = await attachCredential(
      database,
      workspace.id,
      'model',
      input.modelKey,
      input.ring,
      null,
      { onlyIfUnset: true },
    );
    if (attached) seeded.push('model credential');
  }

  return { seeded };
}

/**
 * Drizzle wraps the driver's error, so a constraint name is on the cause
 * rather than the message. Walking the chain is the only way to recognise
 * which constraint refused a write.
 */
function flatten(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  while (current instanceof Error) {
    parts.push(current.message);
    const constraint = (current as { constraint_name?: string }).constraint_name;
    if (constraint) parts.push(constraint);
    current = current.cause;
  }
  return parts.join(' | ');
}
