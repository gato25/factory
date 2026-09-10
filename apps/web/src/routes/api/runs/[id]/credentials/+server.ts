import { FactoryError, type PipelineSnapshot } from '@factory/shared';
import { db } from '$lib/db';
import { keyRingFromEnv } from '$lib/secrets/store';
import { authenticateCallback } from '$lib/services/callbacks';
import { getRun } from '$lib/services/run';
import { resolveRunCredentials } from '$lib/services/run-credentials';
import type { RequestHandler } from './$types';

/**
 * The Runner exchanges a run's credential references for values here.
 *
 * It is a route rather than a remote function because the caller is not our
 * browser (contracts/ui-data.md), and it exists at all because FR-083 forbids
 * the orchestration service holding a credential: the snapshot it carries has
 * references only, and this is where they are exchanged — between the app and
 * the Runner, which is the only component with rights on the container host.
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

    const credentials = await resolveRunCredentials(
      db(),
      run.snapshot as PipelineSnapshot,
      keyRingFromEnv(),
    );
    return Response.json({ credentials });
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
