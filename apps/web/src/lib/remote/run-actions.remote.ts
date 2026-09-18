import { FactoryError, notAuthorised } from '@factory/shared';
import * as v from 'valibot';
import { command, getRequestEvent, query } from '$app/server';
import { loadWebConfig } from '$lib/config';
import { db } from '$lib/db';
import { continueRun } from '$lib/services/continue';
import { attemptsOf, failureOf } from '$lib/services/failure';
import { handOver, orchestratorAccess } from '$lib/services/orchestrator';
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
      callbackBaseUrl: config.callbackBaseUrl,
    });
    const delivered = await handOver(
      db(),
      { runId: run.id, snapshot },
      await orchestratorAccess(db()),
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
      callbackBaseUrl: config.callbackBaseUrl,
      title: input.title,
      description: input.description,
      acceptanceCriteria:
        input.acceptanceCriteria === undefined ? undefined : input.acceptanceCriteria.split('\n'),
    });
    const delivered = await handOver(
      db(),
      { runId: run.id, snapshot },
      await orchestratorAccess(db()),
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

/**
 * A stuck run, driven again from its first unfinished step (FR-094 in
 * spirit: a run is never left looking as though it is running when nothing
 * drives it). Finished steps and their cost are kept; the orchestrator
 * starts its loop where this run stopped.
 */
export const continueFrom = command(RunId, async (runId) => {
  requireUser();
  return attempt(async () => {
    const config = loadWebConfig();
    const { snapshot, index, stepName } = await continueRun(db(), runId);
    const delivered = await handOver(db(), { runId, snapshot }, await orchestratorAccess(db()));
    const run = await getRun(db(), runId);
    await runForTicket(run.ticketId).refresh();
    return {
      ok: delivered.delivered,
      runId,
      message: delivered.delivered
        ? `Continuing from ${stepName} (step ${index + 1}). Steps already finished are kept.`
        : `Could not hand the run back to the orchestrator: ${delivered.detail}`,
    };
  });
});

/**
 * Open a run's design source in the desktop application.
 *
 * A `.pen` file is not something a browser can draw, and pen.dev publishes no
 * link to follow, so the only way from the ticket page into the design editor
 * is to ask the machine to open the file with whatever owns that extension.
 * The execution service does the opening, because it is the only component
 * with any rights on a machine (Principle V, research.md D5) and the only one
 * that knows where a run's workspace is.
 *
 * Therefore this works only while the execution service is on the same
 * machine as the browser — the local setup, never a deployment. The refusal
 * says which of those is the case rather than failing blankly.
 */
export const openDesign = command(
  v.object({ runId: RunId, path: v.pipe(v.string(), v.maxLength(512)) }),
  async ({ runId, path }) => {
    requireUser();
    const access = await orchestratorAccess(db());
    const url = `${access.baseUrl.replace(/\/+$/, '')}/runs/${encodeURIComponent(runId)}/open-design`;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${access.token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ path }),
        signal: AbortSignal.timeout(10_000),
      });
      if (response.ok) return { ok: true, message: 'Opening it in pen.dev.' };
      // The execution service says why — not on this machine, workspace gone,
      // not a design — and that sentence is worth more than a status code.
      const said = (await response.json().catch(() => null)) as { message?: string } | null;
      return {
        ok: false,
        message: said?.message ?? `The execution service refused (${response.status}).`,
      };
    } catch {
      return {
        ok: false,
        message: 'The execution service did not answer, so nothing was opened.',
      };
    }
  },
);
