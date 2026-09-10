import { FactoryError, notAuthorised } from '@factory/shared';
import * as v from 'valibot';
import { command, getRequestEvent, query } from '$app/server';
import { loadWebConfig } from '$lib/config';
import { db } from '$lib/db';
import { attemptsOf, failureOf } from '$lib/services/failure';
import { handOver } from '$lib/services/orchestrator';
import {
  cancelRunNow,
  editAndRetry,
  getRun,
  pauseRun,
  resumeRun,
  retryRun,
} from '$lib/services/run';
import { runForTicket } from './runs.remote';

/**
 * Retry, edit-and-retry, pause and cancel are `command`s rather than `form`s:
 * they come from a control, carry no fields of their own worth validating as
 * a document, and are called from a page that is already live
 * (contracts/ui-data.md).
 */

function requireUser() {
  const user = getRequestEvent().locals.user;
  if (!user) throw notAuthorised('you must be signed in');
  return user;
}

const RunId = v.pipe(v.string(), v.uuid());
const TicketId = v.pipe(v.string(), v.uuid());

/** Why a run failed, in language that does not require raw output (FR-087). */
export const failure = query(RunId, async (runId) => {
  requireUser();
  return failureOf(db(), runId);
});

/** Every attempt on the ticket, so a previous one stays readable (FR-090). */
export const attempts = query(TicketId, async (ticketId) => {
  requireUser();
  return attemptsOf(db(), ticketId);
});

interface Done {
  ok: boolean;
  /** What to tell the person, whether it worked or not. */
  message: string;
  runId?: string;
  attempt?: number;
}

async function attempt(work: () => Promise<Done>): Promise<Done> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof FactoryError) return { ok: false, message: error.message };
    throw error;
  }
}

/**
 * A further attempt on the same ticket with the same pipeline version and a
 * fresh sandbox (FR-088). Delivery failure leaves the attempt queued rather
 * than failed, because delivery is retriable (FR-094).
 */
export const retry = command(TicketId, async (ticketId) => {
  requireUser();
  return attempt(async () => {
    const config = loadWebConfig();
    const { run, snapshot } = await retryRun(db(), {
      ticketId,
      callbackBaseUrl: config.publicBaseUrl,
    });
    const delivered = await handOver(
      db(),
      { runId: run.id, snapshot },
      { baseUrl: config.orchestratorBaseUrl, apiKey: config.orchestratorApiKey || undefined },
    );
    await runForTicket(ticketId).refresh();
    return {
      ok: true,
      runId: run.id,
      attempt: run.attempt,
      message: delivered.delivered
        ? `Attempt ${run.attempt} started.`
        : `Attempt ${run.attempt} is queued but has not begun: ${delivered.detail}. It will be retried.`,
    };
  });
});

const EditAndRetry = v.object({
  ticketId: TicketId,
  title: v.optional(v.pipe(v.string(), v.trim(), v.minLength(1, 'Give the ticket a title.'))),
  description: v.optional(v.string()),
  /** One criterion per line, as the screen presents it. */
  acceptanceCriteria: v.optional(v.string()),
});

/** Editing and retrying, in one action (FR-089). */
export const editRetry = command(EditAndRetry, async (input) => {
  requireUser();
  return attempt(async () => {
    const config = loadWebConfig();
    const { run, snapshot } = await editAndRetry(db(), {
      ticketId: input.ticketId,
      callbackBaseUrl: config.publicBaseUrl,
      title: input.title,
      description: input.description,
      acceptanceCriteria:
        input.acceptanceCriteria === undefined ? undefined : input.acceptanceCriteria.split('\n'),
    });
    const delivered = await handOver(
      db(),
      { runId: run.id, snapshot },
      { baseUrl: config.orchestratorBaseUrl, apiKey: config.orchestratorApiKey || undefined },
    );
    await runForTicket(input.ticketId).refresh();
    return {
      ok: true,
      runId: run.id,
      attempt: run.attempt,
      message: delivered.delivered
        ? `Ticket updated, and attempt ${run.attempt} started.`
        : `Ticket updated. Attempt ${run.attempt} is queued but has not begun: ${delivered.detail}.`,
    };
  });
});

/** The current step concludes; no further step begins (FR-096). */
export const pause = command(RunId, async (runId) => {
  const user = requireUser();
  return attempt(async () => {
    const { alreadyRequested } = await pauseRun(db(), runId, user.id);
    const run = await getRun(db(), runId);
    await runForTicket(run.ticketId).refresh();
    return {
      ok: true,
      runId,
      message: alreadyRequested
        ? 'This run is already pausing.'
        : 'Pausing. The step running now will finish, and nothing further will start.',
    };
  });
});

export const unpause = command(RunId, async (runId) => {
  requireUser();
  return attempt(async () => {
    const { resumed } = await resumeRun(db(), runId);
    const run = await getRun(db(), runId);
    await runForTicket(run.ticketId).refresh();
    return {
      ok: true,
      runId,
      message: resumed ? 'Continuing from where it stopped.' : 'This run was not paused.',
    };
  });
});

/** Sandbox released, branch left intact (FR-097). */
export const cancel = command(RunId, async (runId) => {
  requireUser();
  return attempt(async () => {
    const run = await getRun(db(), runId);
    const { cancelled } = await cancelRunNow(db(), runId);
    await runForTicket(run.ticketId).refresh();
    return {
      ok: cancelled,
      runId,
      message: cancelled
        ? 'Cancelled. The sandbox is released and the branch pushed so far is untouched.'
        : 'This run had already finished.',
    };
  });
});
