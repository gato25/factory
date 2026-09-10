import { createClient } from '@factory/db';
import { loadWebConfig } from './config';

let cached: ReturnType<typeof createClient> | null = null;

export function db() {
  if (!cached) cached = createClient(loadWebConfig().databaseUrl);
  return cached.db;
}
