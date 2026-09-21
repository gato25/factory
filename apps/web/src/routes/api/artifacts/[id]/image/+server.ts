import { notAuthorised } from '@factory/shared';
import { db } from '$lib/db';
import { screenBytes } from '$lib/services/run-view';
import type { RequestHandler } from './$types';
import { m } from '$lib/i18n';

/**
 * One screen's image. A `query` hands JSON to code that asked for it; an
 * `<img src>` is the browser fetching a URL, so a screen openable at full
 * size (FR-077) needs an address (contracts/ui-data.md).
 *
 * Authorisation is checked here exactly as it would be inside a remote
 * function — the route being conventional does not make it public.
 */
export const GET: RequestHandler = async ({ params, locals }) => {
  if (!locals.user) throw notAuthorised(m.form.signInRequired);

  const screen = await screenBytes(db(), params.id);
  if (!screen) return new Response('not found', { status: 404 });

  // Exactly this artifact's bytes. A Uint8Array read from the driver is a
  // view into a larger pooled buffer, so handing over `.buffer` would send
  // the whole pool — 8KB of the wrong thing with the image somewhere inside.
  const body = screen.bytes.buffer.slice(
    screen.bytes.byteOffset,
    screen.bytes.byteOffset + screen.bytes.byteLength,
  ) as ArrayBuffer;
  return new Response(body, {
    headers: {
      'content-type': screen.contentType,
      // An artifact version never changes — a revision is a new version — so
      // it can be cached hard. Private: it is a customer's unreleased design.
      'cache-control': 'private, max-age=31536000, immutable',
      'content-length': String(screen.bytes.byteLength),
      'content-disposition': `inline; filename="${screen.filename}"`,
    },
  });
};
