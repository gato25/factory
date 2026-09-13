import { FactoryError, notAuthorised } from '@factory/shared';
import * as v from 'valibot';
import { command, getRequestEvent, query } from '$app/server';
import { db } from '$lib/db';
import { keyRingFromEnv } from '$lib/secrets/store';
import {
  CONSOLE_METHODS,
  latestLaunchFor,
  refreshLaunch,
  sendThrough,
  startLaunch,
  stopLaunch,
} from '$lib/services/launch';
import { runnerClient } from '$lib/services/runner-client';

/**
 * Run it, look at it, send to it, stop it (003). Thin, like every remote
 * function here: validate, check the person, call the service.
 */

function requireUser() {
  const user = getRequestEvent().locals.user;
  if (!user) throw notAuthorised('you must be signed in');
  return user;
}

const Id = v.pipe(v.string(), v.uuid());

async function deps() {
  const database = db();
  return { database, ring: keyRingFromEnv(), runner: await runnerClient(database) };
}

/** What a person is told when something refuses, rather than a stack trace. */
async function attempt<T>(
  work: () => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; message: string }> {
  try {
    return { ok: true, value: await work() };
  } catch (error) {
    if (error instanceof FactoryError) return { ok: false, message: error.message };
    throw error;
  }
}

/** The ticket's most recent launch, whatever state it is in, and its live view. */
export const launchFor = query(Id, async (ticketId) => {
  requireUser();
  const database = db();
  const latest = await latestLaunchFor(database, ticketId);
  if (!latest) return null;
  if (latest.stoppedAt) return { launch: latest, log: [], from: null, notes: [] };
  // A live one is refreshed on every look, which is also what keeps it alive.
  const d = await deps().catch(() => null);
  if (!d) return { launch: latest, log: [], from: null, notes: [] };
  return refreshLaunch(d, latest.id).catch(() => ({
    launch: latest,
    log: [],
    from: null,
    notes: [],
  }));
});

export const start = command(Id, async (ticketId) => {
  const user = requireUser();
  const result = await attempt(async () => startLaunch(await deps(), ticketId, user));
  await launchFor(ticketId).refresh();
  return result.ok ? { ok: true as const } : { ok: false as const, message: result.message };
});

export const stop = command(
  v.object({ ticketId: Id, launchId: Id }),
  async ({ ticketId, launchId }) => {
    requireUser();
    const result = await attempt(async () => stopLaunch(await deps(), launchId));
    await launchFor(ticketId).refresh();
    return result.ok ? { ok: true as const } : { ok: false as const, message: result.message };
  },
);

const ConsoleRequest = v.object({
  launchId: Id,
  method: v.picklist(CONSOLE_METHODS),
  path: v.pipe(v.string(), v.maxLength(2048)),
  headers: v.pipe(v.string(), v.maxLength(8192)),
  body: v.pipe(v.string(), v.maxLength(1024 * 1024)),
});

/** The request console: sent from here, so cross-origin headers are never the project's problem (FR-014). */
export const send = command(ConsoleRequest, async ({ launchId, ...request }) => {
  requireUser();
  const result = await attempt(async () => sendThrough(await deps(), launchId, request));
  return result.ok
    ? { ok: true as const, response: result.value }
    : { ok: false as const, message: result.message };
});
