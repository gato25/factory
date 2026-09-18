import { notAuthorised } from '@factory/shared';
import * as v from 'valibot';
import { getRequestEvent, query } from '$app/server';
import { db } from '$lib/db';
import {
  activeRuns,
  artifactContent,
  dashboardTiles,
  queuePosition,
  recentActivity,
  runView,
  stepLog,
} from '$lib/services/run-view';

/** Anyone in the workspace may watch; deciding is what is restricted (FR-064). */
function requireUser() {
  const user = getRequestEvent().locals.user;
  if (!user) throw notAuthorised('та нэвтэрсэн байх ёстой');
  return user;
}

export const run = query(v.pipe(v.string(), v.uuid()), async (runId) => {
  requireUser();
  return runView(db(), runId);
});

/** The run a ticket is currently on, so a screen can be keyed by ticket. */
export const runForTicket = query(v.pipe(v.string(), v.uuid()), async (ticketId) => {
  requireUser();
  const { latestRunForTicket } = await import('$lib/services/run-view');
  return latestRunForTicket(db(), ticketId);
});

export const log = query(
  v.object({
    runId: v.pipe(v.string(), v.uuid()),
    stepIndex: v.number(),
    after: v.optional(v.number(), 0),
  }),
  async ({ runId, stepIndex, after }) => {
    requireUser();
    return stepLog(db(), runId, stepIndex, after);
  },
);

export const artifact = query(v.pipe(v.string(), v.uuid()), async (id) => {
  requireUser();
  const row = await artifactContent(db(), id);
  return {
    id: row.id,
    kind: row.kind,
    path: row.path,
    version: row.version,
    screenName: row.screenName,
    content: row.content,
  };
});

export const tiles = query(async () => {
  requireUser();
  return dashboardTiles(db());
});

export const active = query(async () => {
  requireUser();
  return activeRuns(db());
});

export const activity = query(async () => {
  requireUser();
  return recentActivity(db());
});

export const position = query(v.pipe(v.string(), v.uuid()), async (runId) => {
  requireUser();
  return queuePosition(db(), runId);
});
