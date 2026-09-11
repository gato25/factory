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
