import type { Database } from '@factory/db';
import { credentials, workspaces } from '@factory/db/schema';
import { invalidInput } from '@factory/shared';
import { eq } from 'drizzle-orm';
import { type KeyRing, seal } from '$lib/secrets/store';
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
  orchestratorBaseUrl: string | null;
  orchestratorWorkflowId: string | null;
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
    orchestratorBaseUrl: row.orchestratorBaseUrl,
    orchestratorWorkflowId: row.orchestratorWorkflowId,
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
    if (created) return created;
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
  orchestratorBaseUrl?: string | null;
  orchestratorWorkflowId?: string | null;
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
      ...(input.orchestratorBaseUrl === undefined
        ? {}
        : { orchestratorBaseUrl: input.orchestratorBaseUrl }),
      ...(input.orchestratorWorkflowId === undefined
        ? {}
        : { orchestratorWorkflowId: input.orchestratorWorkflowId }),
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
    throw invalidInput('Give the workspace a name.');
  }
  if (input.defaultCostCeilingUsd !== undefined && Number(input.defaultCostCeilingUsd) <= 0) {
    throw invalidInput('A cost ceiling of zero would stop every run before it began.');
  }
  if (input.defaultTimeCeilingMinutes !== undefined && input.defaultTimeCeilingMinutes <= 0) {
    throw invalidInput('A time ceiling of zero would stop every run before it began.');
  }
  if (input.maxConcurrentRuns !== undefined && input.maxConcurrentRuns < 1) {
    throw invalidInput('At least one run has to be able to execute.');
  }
  if (input.sandboxCpu !== undefined && input.sandboxCpu < 1) {
    throw invalidInput('A sandbox needs at least one processor.');
  }
  if (input.sandboxMemoryMb !== undefined && input.sandboxMemoryMb < 512) {
    throw invalidInput('A sandbox with under 512 MB cannot hold a toolchain.');
  }
  if (input.sandboxWallClockMinutes !== undefined && input.sandboxWallClockMinutes < 1) {
    throw invalidInput('A sandbox lifetime of zero would kill every run at the start.');
  }
  if (input.retainFailedSandboxesHours !== undefined && input.retainFailedSandboxesHours < 0) {
    throw invalidInput('A retention period cannot be negative. Zero means release immediately.');
  }
}

/** What the Runner is told about a sandbox, resolved once per run (FR-085). */
export async function sandboxSettings(database: Database) {
  const workspace = await getWorkspace(database);
  return {
    image: workspace.sandboxImage,
    cpu: workspace.sandboxCpu,
    memoryMb: workspace.sandboxMemoryMb,
    wallClockMinutes: workspace.sandboxWallClockMinutes,
    networkDuringImplement: workspace.sandboxNetworkDuringImplement,
  };
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
  if (!token) throw invalidInput('Paste the credential.');

  const workspace = await ensureWorkspace(database);
  const sealed = seal(token, ring);
  const [row] = await database
    .insert(credentials)
    .values({
      kind: input.kind,
      ciphertext: sealed.ciphertext,
      keyVersion: sealed.keyVersion,
      status: 'unverified',
      createdBy: user?.id,
    })
    .returning();
  if (!row) throw new Error('could not store the credential');

  await database
    .update(workspaces)
    .set(
      input.kind === 'model'
        ? { modelCredentialId: row.id, updatedAt: new Date() }
        : { designCredentialId: row.id, updatedAt: new Date() },
    )
    .where(eq(workspaces.id, workspace.id));
  return { stored: true };
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
