import { notAuthorised } from '@factory/shared';
import * as v from 'valibot';
import { getRequestEvent, query } from '$app/server';
import { db } from '$lib/db';
import { m } from '$lib/i18n';
import * as dashboard from '$lib/services/dashboard';
import { artifactContent, queuePosition, runView, stepLog } from '$lib/services/run-view';

/** Anyone in the workspace may watch; deciding is what is restricted (FR-064). */
function requireUser() {
  const user = getRequestEvent().locals.user;
  if (!user) throw notAuthorised(m.form.signInRequired);
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

/**
 * The dashboard's ticket list: in progress, needs attention, queued and done
 * this week, each with a step bar sized to the ticket's own pipeline
 * (specs/004-bento-redesign FR-009, FR-010).
 */
export const dashboardTickets = query(async () => {
  requireUser();
  return dashboard.dashboardTickets(db());
});

/** First-attempt rate, merge requests per day and today's cost (FR-012, FR-013). */
export const dashboardFigures = query(async () => {
  requireUser();
  return dashboard.dashboardFigures(db());
});

export const position = query(v.pipe(v.string(), v.uuid()), async (runId) => {
  requireUser();
  return queuePosition(db(), runId);
});
