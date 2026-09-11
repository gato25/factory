import { createLogger } from '@factory/shared';
import { rawSql } from '$lib/db';
import { DASHBOARD_CHANNEL, runChannel } from '$lib/services/notify';
import type { RequestHandler } from './$types';

const log = createLogger('web');

/**
 * Server-sent events, one stream per viewer, fed by Postgres LISTEN (D4).
 *
 * One-directional on purpose: every action from the browser already has a
 * remote function, so there is nothing to send upstream, and SSE survives
 * proxies far better than a socket would.
 *
 * `run_id` may be the literal `dashboard`, which watches the workspace-wide
 * channel instead of one run (FR-072).
 */

/** Long enough to be cheap, short enough that no proxy times the stream out. */
const HEARTBEAT_MS = 20_000;

export const GET: RequestHandler = async ({ params, locals, request }) => {
  // Anyone in the workspace may watch; deciding is what is restricted (FR-064).
  if (!locals.user) {
    return new Response('unauthorised', { status: 401 });
  }

  const runId = params.run_id as string;
  const channel = runId === 'dashboard' ? DASHBOARD_CHANNEL : runChannel(runId);
  const sql = rawSql();

  let listener: { unlisten: () => Promise<void> } | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (data: string) => {
        try {
          controller.enqueue(encoder.encode(data));
        } catch {
          // The viewer went away between a notification and this write.
        }
      };

      send(`retry: 2000\n\n`);
      send(`event: ready\ndata: ${JSON.stringify({ channel })}\n\n`);

      listener = await sql.listen(channel, (payload) => {
        send(`data: ${payload}\n\n`);
      });

      heartbeat = setInterval(() => send(': keep-alive\n\n'), HEARTBEAT_MS);

      // Release the LISTEN as soon as the viewer navigates away.
      request.signal.addEventListener('abort', () => {
        void cleanup();
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      });
    },
    async cancel() {
      await cleanup();
    },
  });

  async function cleanup() {
    if (heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
    if (listener) {
      await listener.unlisten().catch((error: unknown) => {
        log.warn('could not release a listener', {
          channel,
          detail: error instanceof Error ? error.message : String(error),
        });
      });
      listener = null;
    }
  }

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-store',
      connection: 'keep-alive',
      // Nginx and friends buffer by default, which would defeat the point.
      'x-accel-buffering': 'no',
    },
  });
};
