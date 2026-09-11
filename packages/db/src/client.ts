import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index';

export function createClient(url = process.env.DATABASE_URL) {
  if (!url) throw new Error('db: DATABASE_URL is not set');
  const sql = postgres(url, { max: 4, onnotice: () => {} });
  return { db: drizzle(sql, { schema }), sql };
}

export type Database = ReturnType<typeof createClient>['db'];
