import { createLogger, notAuthorised } from '@factory/shared';
import * as v from 'valibot';
import { command, form, getRequestEvent, query } from '$app/server';
import { loadWebConfig } from '$lib/config';
import { db } from '$lib/db';
import { previewRun, verificationWarning } from '$lib/services/estimate';
import {
  deliverTrigger,
  recordDeliveryFailure,
  recordExecutionId,
} from '$lib/services/orchestrator';
import { startRun } from '$lib/services/run';
import { createTicket, getTicket, listTickets } from '$lib/services/ticket';

const log = createLogger('web');

function requireUser() {
  const user = getRequestEvent().locals.user;
  if (!user) throw notAuthorised('you must be signed in');
  return user;
}

export const tickets = query(async () => listTickets(db()));

/** The board, with each card's status strip (FR-023, FR-023a). */
export const ticketBoard = query(async () => {
  requireUser();
  const { board } = await import('$lib/services/run-view');
  return board(db());
});

export const ticket = query(v.pipe(v.string(), v.uuid()), async (id) => getTicket(db(), id));

/** What the ticket form shows before anything starts (FR-019, FR-019a). */
export const preview = query(
  v.object({ pipelineId: v.pipe(v.string(), v.uuid()), version: v.number() }),
  async ({ pipelineId, version }) => {
    const p = await previewRun(db(), pipelineId, version);
    return { ...p, warning: verificationWarning(p) };
  },
);

const CreateSchema = v.object({
  repositoryId: v.pipe(v.string(), v.uuid('Choose a repository.')),
  title: v.pipe(v.string(), v.trim(), v.minLength(1, 'Give the ticket a title.')),
  description: v.optional(v.string(), ''),
  // One criterion per line, as the form presents it.
  acceptanceCriteria: v.optional(v.string(), ''),
  pipelineId: v.optional(v.string(), ''),
  start: v.optional(v.boolean(), false),
});

/**
 * Create, and optionally start. Delivery failure leaves the ticket queued
 * rather than failed, and says so, because delivery is still retriable
 * (FR-094).
 */
export const create = form(CreateSchema, async (data) => {
  const user = requireUser();
  const config = loadWebConfig();

  const created = await createTicket(
    db(),
    {
      repositoryId: data.repositoryId,
      title: data.title,
      description: data.description,
      acceptanceCriteria: data.acceptanceCriteria.split('\n'),
      pipelineId: data.pipelineId || undefined,
      start: data.start,
    },
    user.id,
  );

  await tickets().refresh();
  if (!data.start) return { id: created.id, reference: created.reference, started: false };

  const { run, snapshot } = await startRun(db(), {
    ticketId: created.id,
    callbackBaseUrl: config.publicBaseUrl,
  });

  const delivery = await deliverTrigger(snapshot, {
    baseUrl: config.orchestratorBaseUrl,
    apiKey: config.orchestratorApiKey || undefined,
  });

  if (!delivery.delivered) {
    await recordDeliveryFailure(db(), run.id, delivery.lastError);
    log.warn('ticket queued but not started', {
      ticket: created.reference,
      lastError: delivery.lastError,
    });
    return {
      id: created.id,
      reference: created.reference,
      started: false,
      queuedNotStarted: true,
      detail: delivery.lastError,
    };
  }

  await recordExecutionId(db(), run.id, delivery.executionId);
  return { id: created.id, reference: created.reference, started: true, runId: run.id };
});

/** Starting a ticket that was saved as a draft (FR-017). */
export const start = command(v.pipe(v.string(), v.uuid()), async (ticketId) => {
  requireUser();
  const config = loadWebConfig();
  const { run, snapshot } = await startRun(db(), {
    ticketId,
    callbackBaseUrl: config.publicBaseUrl,
  });
  const delivery = await deliverTrigger(snapshot, {
    baseUrl: config.orchestratorBaseUrl,
    apiKey: config.orchestratorApiKey || undefined,
  });
  if (!delivery.delivered) {
    await recordDeliveryFailure(db(), run.id, delivery.lastError);
  } else {
    await recordExecutionId(db(), run.id, delivery.executionId);
  }
  await tickets().refresh();
  return { runId: run.id, started: delivery.delivered };
});
