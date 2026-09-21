import {
  ACCEPTED_EXTENSIONS,
  createLogger,
  extensionOf,
  invalidInput,
  notAuthorised,
} from '@factory/shared';
import * as v from 'valibot';
import { command, form, getRequestEvent, query } from '$app/server';
import { loadWebConfig } from '$lib/config';
import { db } from '$lib/db';
import { formBoolean } from '$lib/forms';
import { previewRun, verificationWarning } from '$lib/services/estimate';
import { handOver, orchestratorAccess } from '$lib/services/orchestrator';
import { startRun } from '$lib/services/run';
import { createTicket, getTicket, listTickets } from '$lib/services/ticket';
import { attachFiles, listFiles, removeFile } from '$lib/services/ticket-files';
import { m } from '$lib/i18n';

const log = createLogger('web');

function requireUser() {
  const user = getRequestEvent().locals.user;
  if (!user) throw notAuthorised(m.form.signInRequired);
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

/**
 * Reads the documents out of what a form submitted.
 *
 * A file input sends one `File`, or several, or — when nobody picked
 * anything — one empty `File` with no name. That last case is not an error
 * and must not be reported as one, so it is dropped here.
 *
 * The extension is checked before the content is read, so a 400 MB video
 * picked by mistake is refused without being pulled into memory first.
 */
async function readPicked(picked: File | File[] | undefined) {
  const files: { name: string; content: string }[] = [];
  for (const file of picked === undefined ? [] : [picked].flat()) {
    if (file.size === 0 && !file.name) continue;
    if (!ACCEPTED_EXTENSIONS.includes(extensionOf(file.name))) {
      throw invalidInput(
        `${file.name} is not a kind that can be read as text. ` +
          `Attach one of: ${ACCEPTED_EXTENSIONS.join(', ')}.`,
      );
    }
    files.push({ name: file.name, content: await file.text() });
  }
  return files;
}

const CreateSchema = v.object({
  repositoryId: v.pipe(v.string(), v.uuid(m.form.chooseRepository)),
  title: v.pipe(v.string(), v.trim(), v.minLength(1, m.form.ticketTitle)),
  description: v.optional(v.string(), ''),
  // One criterion per line, as the form presents it.
  acceptanceCriteria: v.optional(v.string(), ''),
  pipelineId: v.optional(v.string(), ''),
  // A checkbox sends its value when ticked and nothing when not.
  start: formBoolean(),
  // Requirement documents, attached as the ticket is written. Optional, and
  // one `File` rather than an array when a single one was picked.
  files: v.optional(v.union([v.file(), v.array(v.file())])),
});

/**
 * Create, and optionally start. Delivery failure leaves the ticket queued
 * rather than failed, and says so, because delivery is still retriable
 * (FR-094).
 */
export const create = form(CreateSchema, async (data) => {
  const user = requireUser();
  const config = loadWebConfig();

  // Read BEFORE the ticket is created, so a document that cannot be accepted
  // refuses the whole submission rather than leaving a ticket that is missing
  // the requirements its author thought they had attached.
  const files = await readPicked(data.files);

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

  // Before the run starts, not after: the snapshot is resolved at start and
  // never re-read, so a document attached a moment later would not reach the
  // attempt its author was watching.
  if (files.length > 0) await attachFiles(db(), created.id, files, user.id);

  await tickets().refresh();
  if (!data.start) return { id: created.id, reference: created.reference, started: false };

  const { run, snapshot } = await startRun(db(), {
    ticketId: created.id,
    callbackBaseUrl: config.callbackBaseUrl,
  });

  const delivery = await handOver(
    db(),
    { runId: run.id, snapshot },
    await orchestratorAccess(db()),
  );

  if (!delivery.delivered) {
    log.warn('ticket queued but not started', {
      ticket: created.reference,
      lastError: delivery.detail,
    });
    return {
      id: created.id,
      reference: created.reference,
      started: false,
      queuedNotStarted: true,
      detail: delivery.detail,
    };
  }

  return { id: created.id, reference: created.reference, started: true, runId: run.id };
});

/** Starting a ticket that was saved as a draft (FR-017). */
export const start = command(v.pipe(v.string(), v.uuid()), async (ticketId) => {
  requireUser();
  const config = loadWebConfig();
  const { run, snapshot } = await startRun(db(), {
    ticketId,
    callbackBaseUrl: config.callbackBaseUrl,
  });
  const delivery = await handOver(
    db(),
    { runId: run.id, snapshot },
    await orchestratorAccess(db()),
  );
  await tickets().refresh();
  return { runId: run.id, started: delivery.delivered };
});

/**
 * Requirement documents attached to a ticket.
 *
 * A separate query from `ticket` so that attaching one refreshes a list rather
 * than the whole ticket view, and so the ticket page can show them while a run
 * is in flight without re-reading the run.
 */
export const ticketFiles = query(v.pipe(v.string(), v.uuid()), async (ticketId) => {
  requireUser();
  return listFiles(db(), ticketId);
});

const AttachSchema = v.object({
  ticketId: v.pipe(v.string(), v.uuid()),
  files: v.optional(v.union([v.file(), v.array(v.file())])),
});

/** Attaching documents to a ticket that already exists. */
export const attach = form(AttachSchema, async (data) => {
  const user = requireUser();
  const files = await readPicked(data.files);
  if (files.length === 0) return { attached: 0 };
  const stored = await attachFiles(db(), data.ticketId, files, user.id);
  await ticketFiles(data.ticketId).refresh();
  return { attached: files.length, total: stored.length };
});

/** Removing one. Nothing in flight is affected: a run reads its own copy. */
export const detach = command(
  v.object({ ticketId: v.pipe(v.string(), v.uuid()), fileId: v.pipe(v.string(), v.uuid()) }),
  async ({ ticketId, fileId }) => {
    requireUser();
    const { removed } = await removeFile(db(), ticketId, fileId);
    await ticketFiles(ticketId).refresh();
    return { removed };
  },
);
