import { createClient } from '@factory/db';
import { loadWebConfig } from './config';

let cached: ReturnType<typeof createClient> | null = null;

function client() {
  if (!cached) cached = createClient(loadWebConfig().databaseUrl);
  return cached;
}

export function db() {
  return client().db;
}

/** The raw driver, for LISTEN/NOTIFY (D4). Nothing else should need it. */
export function rawSql() {
  return client().sql;
}

/**
 * Closes every connection, the LISTEN one included, so the process can exit.
 *
 * The built server stops taking requests on SIGTERM and then emits
 * `sveltekit:shutdown`, leaving whatever the application opened to the
 * application. Nothing closed this pool, so its connections held the process
 * open after the server had stopped: every `systemctl stop` and every restart
 * of a deploy waited out the service manager's stop timeout and ended in a
 * SIGKILL. Waits up to five seconds for a query in flight, then closes anyway.
 */
export async function closeDb(): Promise<void> {
  const open = cached;
  cached = null;
  await open?.sql.end({ timeout: 5 });
}
