import { stepResults } from '@factory/db/schema';
import { addTokens, type TokenUsage, totalTokens } from '@factory/shared';
import { sql } from 'drizzle-orm';

/**
 * A step's four token columns and what the screens do with them.
 *
 * Kept in one place because the run page, the dashboard, the estimate and the
 * merge request all read the same columns, and each summing them a slightly
 * different way is how two screens end up disagreeing about one run.
 */

type Columns = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
};

/** One row's columns as the shared shape. */
export function tokensOfRow(row: Columns): TokenUsage {
  return {
    input: row.inputTokens,
    output: row.outputTokens,
    cache_read: row.cacheReadTokens,
    cache_creation: row.cacheCreationTokens,
  };
}

/** What the screens show for a run, or a day: the headline and its four parts. */
export interface TokenFigures {
  /** Everything the engine processed — the number a screen leads with. */
  total: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
}

export function figuresOf(tokens: TokenUsage): TokenFigures {
  return {
    total: totalTokens(tokens),
    input: tokens.input,
    output: tokens.output,
    cacheRead: tokens.cache_read,
    cacheCreation: tokens.cache_creation,
  };
}

/** The figures for any number of step rows. */
export function sumRows(rows: Columns[]): TokenFigures {
  return figuresOf(addTokens(...rows.map(tokensOfRow)));
}

/**
 * SQL for the sum of all four columns over the rows a query groups, as a
 * bigint (a day of steps can pass what an integer holds) read back as text.
 */
export const totalTokensSql = sql<string>`coalesce(sum(
  ${stepResults.inputTokens}::bigint + ${stepResults.outputTokens}::bigint
  + ${stepResults.cacheReadTokens}::bigint + ${stepResults.cacheCreationTokens}::bigint
), 0)::text`;
