import type { Database } from '@factory/db';
import { launches, repositories, tickets, workspaces } from '@factory/db/schema';
import { FactoryError, invalidInput, notFound } from '@factory/shared';
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { KeyRing } from '$lib/secrets/store';
import type { SessionUser } from './auth';
import { revealCredential } from './run-credentials';
import type { RunnerClient } from './runner-client';

/**
 * A ticket's branch, running on a real port (003 FR-001).
 *
 * The execution service owns the container; this owns everything around it:
 * whether the ticket may be launched at all, the repository's say over how,
 * the record that survives a page reload, and the request console — which
 * sends from here rather than from the browser, so a project that set no
 * cross-origin headers can still be exercised (FR-014, D2).
 */

export interface LaunchDeps {
  database: Database;
  ring: KeyRing;
  runner: RunnerClient;
}

export type LaunchRow = typeof launches.$inferSelect;

/** The launch a ticket currently has, or nothing. Stopped ones are history. */
export async function liveLaunchFor(
  database: Database,
  ticketId: string,
): Promise<LaunchRow | null> {
  const [row] = await database
    .select()
    .from(launches)
    .where(and(eq(launches.ticketId, ticketId), isNull(launches.stoppedAt)))
    .orderBy(desc(launches.createdAt))
    .limit(1);
  return row ?? null;
}

/** The most recent launch of any state, so the ticket can show how the last one ended. */
export async function latestLaunchFor(
  database: Database,
  ticketId: string,
): Promise<LaunchRow | null> {
  const [row] = await database
    .select()
    .from(launches)
    .where(eq(launches.ticketId, ticketId))
    .orderBy(desc(launches.createdAt))
    .limit(1);
  return row ?? null;
}

/**
 * Why a ticket cannot be launched right now, or null when it can (FR-003).
 *
 * Said in words rather than by hiding the button: a control that is absent
 * makes somebody wonder whether the feature exists.
 */
export function launchBlocker(ticket: {
  status: string;
  branchName: string | null;
}): string | null {
  if (!ticket.branchName) return 'This ticket has no branch yet.';
  if (ticket.status === 'done') return null;
  if (ticket.status === 'running' || ticket.status === 'queued') {
    return 'Available once the run has finished and pushed its branch.';
  }
  if (ticket.status === 'waiting_approval') {
    return 'Available once the run has finished; it is waiting at a checkpoint.';
  }
  if (ticket.status === 'failed') {
    return 'The run did not finish, so the branch may not hold a working project.';
  }
  return 'Available once a run has finished.';
}

/** Presses Run it (FR-001, FR-003, FR-015). */
export async function startLaunch(
  deps: LaunchDeps,
  ticketId: string,
  user: SessionUser,
): Promise<LaunchRow> {
  const { database } = deps;
  const [ticket] = await database.select().from(tickets).where(eq(tickets.id, ticketId)).limit(1);
  if (!ticket) throw notFound('no such ticket');
  const blocker = launchBlocker(ticket);
  if (blocker) throw invalidInput(blocker);

  if (await liveLaunchFor(database, ticketId)) {
    throw new FactoryError('conflict', 'This ticket is already running. Stop it first.');
  }

  const [repository] = await database
    .select()
    .from(repositories)
    .where(eq(repositories.id, ticket.repositoryId))
    .limit(1);
  if (!repository) throw notFound('that repository is not connected');

  const gitToken = await revealCredential(
    database,
    repository.credentialId,
    deps.ring,
    'repository credential',
  );
  const [workspace] = await database
    .select()
    .from(workspaces)
    .orderBy(workspaces.createdAt)
    .limit(1);

  const response = await deps.runner.request('/launches', {
    method: 'POST',
    body: JSON.stringify({
      clone_url: repository.cloneUrl,
      branch: ticket.branchName,
      git_token: gitToken,
      ...(repository.runCommand ? { command: repository.runCommand } : {}),
      ...(repository.runPort ? { port: repository.runPort } : {}),
      sandbox: {
        image: workspace?.sandboxImage,
        cpu: workspace?.sandboxCpu,
        memory_mb: workspace?.sandboxMemoryMb,
        wall_clock_minutes: workspace?.sandboxWallClockMinutes,
      },
    }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new FactoryError(
      'command_failed',
      body.error ?? `The execution service refused to start it (${response.status}).`,
    );
  }
  const begun = (await response.json()) as { launch_id: string };

  const [row] = await database
    .insert(launches)
    .values({
      ticketId,
      repositoryId: repository.id,
      runnerLaunchId: begun.launch_id,
      branch: ticket.branchName as string,
      command: repository.runCommand ?? '(detecting)',
      status: 'starting',
      startedBy: user.id,
    })
    .returning();
  if (!row) throw new FactoryError('conflict', 'could not record the launch');
  return row;
}

export interface LaunchView {
  launch: LaunchRow;
  log: string[];
  from: string | null;
  notes: string[];
}

/**
 * The launch as the execution service sees it now, written back to the row.
 *
 * Every look is also what keeps the launch alive (FR-011): the execution
 * service counts a look as activity, so a ticket page left open keeps its
 * launch, and one closed lets it lapse.
 */
export async function refreshLaunch(deps: LaunchDeps, launchId: string): Promise<LaunchView> {
  const { database } = deps;
  const [row] = await database.select().from(launches).where(eq(launches.id, launchId)).limit(1);
  if (!row) throw notFound('no such launch');
  if (row.stoppedAt) return { launch: row, log: [], from: null, notes: [] };

  const response = await deps.runner.request(`/launches/${row.runnerLaunchId}`);
  if (response.status === 404) {
    // The execution service restarted and forgot it. The container went with
    // the process, so the honest state is stopped.
    const [updated] = await database
      .update(launches)
      .set({
        status: 'stopped',
        detail: 'The execution service restarted, and the launch went with it.',
        url: null,
        stoppedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(launches.id, launchId))
      .returning();
    return { launch: updated ?? row, log: [], from: null, notes: [] };
  }
  if (!response.ok) {
    throw new FactoryError('command_failed', `The execution service answered ${response.status}.`);
  }
  const seen = (await response.json()) as {
    status: 'starting' | 'running' | 'failed' | 'stopped';
    address: string | null;
    command: string | null;
    port: number | null;
    from: string | null;
    notes: string[];
    detail: string | null;
    log: string[];
  };

  // The address is loopback on the execution service's machine; the URL a
  // browser here can open uses that machine's name from Settings.
  const url = seen.address
    ? `http://${deps.runner.hostname()}:${seen.address.split(':').pop()}`
    : null;
  const ended = seen.status === 'failed' || seen.status === 'stopped';
  const [updated] = await database
    .update(launches)
    .set({
      status: seen.status,
      url,
      command: seen.command ?? row.command,
      detail: seen.detail,
      ...(ended && !row.stoppedAt ? { stoppedAt: new Date() } : {}),
      updatedAt: new Date(),
    })
    .where(eq(launches.id, launchId))
    .returning();
  return { launch: updated ?? row, log: seen.log ?? [], from: seen.from, notes: seen.notes ?? [] };
}

/** Presses Stop (FR-002). */
export async function stopLaunch(deps: LaunchDeps, launchId: string): Promise<LaunchRow> {
  const { database } = deps;
  const [row] = await database.select().from(launches).where(eq(launches.id, launchId)).limit(1);
  if (!row) throw notFound('no such launch');
  if (row.stoppedAt) return row;

  // Best effort against the execution service; the row is marked stopped
  // either way, because a person who pressed Stop must not be told it is
  // still running when the service could not be reached.
  await deps.runner
    .request(`/launches/${row.runnerLaunchId}`, { method: 'DELETE' })
    .catch(() => null);

  const [updated] = await database
    .update(launches)
    .set({
      status: 'stopped',
      url: null,
      detail: 'Stopped.',
      stoppedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(launches.id, launchId))
    .returning();
  return updated ?? row;
}

// --- the request console (FR-013, FR-014) -----------------------------------

export const CONSOLE_METHODS = [
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
] as const;
export type ConsoleMethod = (typeof CONSOLE_METHODS)[number];

export interface ConsoleRequest {
  method: ConsoleMethod;
  /** Path and query, beginning with `/`. */
  path: string;
  /** `Name: value`, one per line, as typed. */
  headers: string;
  body: string;
}

export interface ConsoleResponse {
  status: number;
  statusText: string;
  ms: number;
  headers: [string, string][];
  /** Text, or a description of a body that is not text. */
  body: string;
  contentType: string | null;
  truncated: boolean;
  /** Pretty-printed when the body is JSON, else null. */
  json: string | null;
}

/** The most of a response body that is shown — and read: the rest is left unread. */
export const CONSOLE_BODY_CAP = 256 * 1024;
/** How long the console waits for the project to answer. */
export const CONSOLE_TIMEOUT_MS = 15_000;

/**
 * Up to `cap` bytes of the body, then the stream is cancelled, so a project
 * that streams for ever, or answers with a film, costs this process the cap
 * and not the whole thing.
 */
export async function readUpTo(
  response: Response,
  cap: number,
): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  if (!response.body) return { bytes: new Uint8Array(), truncated: false };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  try {
    while (total <= cap) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
    }
    truncated = total > cap;
  } finally {
    if (truncated) await reader.cancel().catch(() => {});
  }
  const joined = new Uint8Array(Math.min(total, cap));
  let at = 0;
  for (const chunk of chunks) {
    const room = joined.length - at;
    if (room <= 0) break;
    joined.set(room >= chunk.length ? chunk : chunk.subarray(0, room), at);
    at += Math.min(room, chunk.length);
  }
  return { bytes: joined, truncated };
}

/**
 * `Name: value` lines into headers, forgiving about blank lines and spacing.
 *
 * Only `Host` is dropped: the request is sent by this application to the
 * project's own address, and a Host of somebody else's choosing is the one
 * header that could make it look like a request to a different site.
 * Cookies and Authorization go through, because testing a project's own
 * sign-in is exactly what the console is for.
 */
export function parseHeaderLines(text: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const at = line.indexOf(':');
    if (at < 1) continue;
    const name = line.slice(0, at).trim();
    const value = line.slice(at + 1).trim();
    if (name.toLowerCase() === 'host') continue;
    headers[name] = value;
  }
  return headers;
}

/** A path the console may send: absolute, and to the launch — never elsewhere. */
export function normalisePath(path: string): string {
  const trimmed = path.trim() || '/';
  if (/^[a-z]+:\/\//i.test(trimmed) || trimmed.startsWith('//')) {
    throw invalidInput('Type a path such as /api/items, not a full address.');
  }
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

/**
 * Sends the composed request to the running project and shapes the answer
 * for a screen (FR-014, D2).
 */
export async function sendThrough(
  deps: LaunchDeps,
  launchId: string,
  request: ConsoleRequest,
  doFetch: typeof fetch = fetch,
): Promise<ConsoleResponse> {
  const { launch } = await refreshLaunch(deps, launchId);
  if (launch.status !== 'running' || !launch.url) {
    throw invalidInput('The project is not running, so there is nothing to send to.');
  }
  const path = normalisePath(request.path);
  const hasBody = !['GET', 'HEAD'].includes(request.method) && request.body.length > 0;
  let headers: Headers;
  try {
    headers = new Headers(parseHeaderLines(request.headers));
  } catch {
    throw invalidInput('One of the headers has a name or value that is not allowed in a header.');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CONSOLE_TIMEOUT_MS);
  const started = Date.now();
  let response: Response;
  try {
    response = await doFetch(`${launch.url}${path}`, {
      method: request.method,
      headers,
      ...(hasBody ? { body: request.body } : {}),
      redirect: 'manual',
      signal: controller.signal,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new FactoryError(
      'command_failed',
      controller.signal.aborted
        ? `The project did not answer within ${CONSOLE_TIMEOUT_MS / 1000} seconds.`
        : 'The project could not be reached. It may have just stopped; the card above will say.',
      { detail },
    );
  } finally {
    clearTimeout(timer);
  }
  const ms = Date.now() - started;

  const contentType = response.headers.get('content-type');
  const { bytes, truncated } = await readUpTo(response, CONSOLE_BODY_CAP);
  const textual =
    !contentType ||
    /^(text\/|application\/(json|xml|javascript|x-www-form-urlencoded)|.*\+json)/i.test(
      contentType,
    );
  const shown = bytes;

  let body: string;
  let json: string | null = null;
  if (textual) {
    body = new TextDecoder().decode(shown);
    if (!truncated && /json/i.test(contentType ?? '')) {
      try {
        json = JSON.stringify(JSON.parse(body), null, 2);
      } catch {
        json = null;
      }
    }
  } else {
    body = `${truncated ? 'more than ' : ''}${bytes.length.toLocaleString()} bytes of ${contentType}`;
  }

  return {
    status: response.status,
    statusText: response.statusText,
    ms,
    headers: [...response.headers.entries()],
    body,
    contentType,
    truncated,
    json,
  };
}
