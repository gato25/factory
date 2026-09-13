import { FactoryError } from '@factory/shared';
import { db } from '$lib/db';
import { authenticateCallback } from '$lib/services/callbacks';
import { getRun } from '$lib/services/run';
import { readFiles } from '$lib/services/ticket-files';
import type { RequestHandler } from './$types';

/**
 * The Runner collects a ticket's requirement documents here.
 *
 * It is a route rather than a remote function for the same reason the
 * credentials one is: the caller is not our browser (contracts/ui-data.md).
 * It exists as a fetch rather than as part of the snapshot because content is
 * large and a snapshot is not: a snapshot is held for the life of a run and
 * rewritten on every step, and on the managed host it lives in Durable Object
 * storage, which caps a value at 128 KiB. The manifest travels in the
 * snapshot; the content is collected once, here, at start.
 *
 * Authenticated with the run's own secret, exactly as a callback is. A
 * rejected call cannot tell whether the run exists.
 */
export const POST: RequestHandler = async ({ params, request }) => {
  const header = request.headers.get('authorization') ?? '';
  const presented = header.startsWith('Bearer ') ? header.slice(7) : '';

  try {
    await authenticateCallback(db(), params.id, presented);
  } catch {
    return Response.json({ error: 'unauthorised' }, { status: 401 });
  }

  try {
    const run = await getRun(db(), params.id);
    // A finished run has no sandbox to prepare, so it has no business asking.
    if (['done', 'failed', 'cancelled'].includes(run.status)) {
      return Response.json({ error: 'that run has ended' }, { status: 409 });
    }
    // The ticket's files as they are NOW rather than as the snapshot listed
    // them. The two agree except in one case — a document attached between
    // the snapshot being resolved and the sandbox being created — and in that
    // case the newer set is the one the author meant. The manifest is what
    // the run was told about; this is what it reads.
    const files = await readFiles(db(), run.ticketId);
    return Response.json({ files });
  } catch (error) {
    if (error instanceof FactoryError) {
      return Response.json(
        { error: error.message, reason: error.reason },
        { status: error.status },
      );
    }
    return Response.json({ error: 'internal error' }, { status: 500 });
  }
};
