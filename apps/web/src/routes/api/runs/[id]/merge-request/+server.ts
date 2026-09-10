import { FactoryError } from '@factory/shared';
import { loadWebConfig } from '$lib/config';
import { db } from '$lib/db';
import { authenticateCallback } from '$lib/services/callbacks';
import { mergeRequestBody } from '$lib/services/merge-request-body';
import { getRun } from '$lib/services/run';
import type { RequestHandler } from './$types';

/**
 * The merge request body, fetched by the orchestration service just before it
 * opens the merge request.
 *
 * It is a route rather than a remote function because the caller is not our
 * browser (contracts/ui-data.md), and the body is composed here rather than
 * in the workflow because it needs the run's whole record: the ticket's
 * description and criteria, the specification and plan the agents wrote, the
 * screens' addresses on this deployment, which steps did not run, and what
 * the run cost. Only the application has those, and a reviewer who never saw
 * the ticket has to be able to judge the change from the merge request alone
 * (SC-014).
 *
 * Authenticated with the run's own secret, exactly as a callback is. A
 * rejected call cannot tell whether the run exists.
 */
export const GET: RequestHandler = async ({ params, request }) => {
  const header = request.headers.get('authorization') ?? '';
  const presented = header.startsWith('Bearer ') ? header.slice(7) : '';

  try {
    await authenticateCallback(db(), params.id, presented);
  } catch {
    return Response.json({ error: 'unauthorised' }, { status: 401 });
  }

  try {
    const run = await getRun(db(), params.id);
    // A cancelled or failed run has nothing to open. Composing a body for one
    // would invite the workflow to open a merge request for work that was
    // stopped on purpose.
    if (['failed', 'cancelled'].includes(run.status)) {
      return Response.json({ error: `that run is ${run.status}` }, { status: 409 });
    }

    const content = await mergeRequestBody(db(), params.id, loadWebConfig().publicBaseUrl);
    // Named as the providers name them, so the workflow passes the body
    // through rather than translating it.
    return Response.json({
      title: content.title,
      description: content.description,
      labels: content.labels,
      source_branch: content.sourceBranch,
      target_branch: content.targetBranch,
    });
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
