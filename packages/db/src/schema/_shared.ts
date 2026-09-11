import { sql } from 'drizzle-orm';
import { numeric, timestamp, uuid } from 'drizzle-orm/pg-core';

/** Every table carries these unless data-model.md says otherwise. */
export const idColumn = () => uuid('id').primaryKey().default(sql`gen_random_uuid()`);
export const timestamps = () => ({
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Money is numeric(10,4) in USD — never a float, because ceilings are
 * enforced against it (data-model.md, FR-079, SC-006).
 */
export const money = (name: string) => numeric(name, { precision: 10, scale: 4 });
