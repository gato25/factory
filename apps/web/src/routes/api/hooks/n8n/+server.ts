import { type Callback, FactoryError } from '@factory/shared';
import { db } from '$lib/db';
import { applyCallback, authenticateCallback } from '$lib/services/callbacks';
import type { RequestHandler } from './$types';

/**
 * The callback sink. An external caller, so this is an explicit route with a
 * versioned payload rather than a generated remote-function endpoint
 * (research.md D2).
 */
export const POST: RequestHandler = async ({ request }) => {
  let callback: Callback;
  try {
    callback = (await request.json()) as Callback;
  } catch {
    return Response.json({ error: 'expected a JSON body' }, { status: 400 });
  }
  if (!callback?.run_id || !callback.event || typeof callback.step_index !== 'number') {
    return Response.json({ error: 'expected run_id, event and step_index' }, { status: 400 });
  }

  const header = request.headers.get('authorization') ?? '';
  const presented = header.startsWith('Bearer ') ? header.slice(7) : '';

  try {
    await authenticateCallback(db(), callback.run_id, presented);
  } catch {
    // Identical for an unknown run and a wrong secret.
    return Response.json({ error: 'unauthorised' }, { status: 401 });
  }

  try {
    const { applied } = await applyCallback(db(), callback);
    // 200 either way: a duplicate is a successful no-op, not an error, so the
    // orchestrator does not retry it forever (FR-095).
    return Response.json({ applied });
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
