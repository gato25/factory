import { addTokens, normaliseTokens, type TokenUsage, totalTokens } from '@factory/shared';

/**
 * Cost comes from what the engine itself reports, never from an estimate of
 * our own (FR-108, research.md D6). Anything we cannot read is zero rather
 * than a guess, because a guessed number would be enforced against a ceiling.
 *
 * Tokens come the same way, and are only ever shown: what the engine said it
 * processed, or nothing (`tokens` absent) — never a figure of ours.
 */

export interface Usage {
  costUsd: string;
  /** What the engine said it processed. Absent when it said nothing readable. */
  tokens?: TokenUsage;
  durationMs?: number;
  sessionId?: string;
  turns?: number;
}

const ZERO = '0.0000';

export function normaliseCost(value: unknown): string {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return ZERO;
  // Four decimal places, matching the numeric(10,4) column exactly.
  return n.toFixed(4);
}

/**
 * The LAST JSON object on the stream. The CLI prints its result as JSON, but
 * anything it said first is still on stdout — and parsing the whole stream
 * would then yield zero, which is enforced against a ceiling as if the step
 * were free.
 */
function lastJsonObject(raw: string): string | null {
  const end = raw.lastIndexOf('}');
  if (end === -1) return null;
  // Walk back to the matching brace rather than guessing at the first one.
  let depth = 0;
  for (let i = end; i >= 0; i--) {
    if (raw[i] === '}') depth++;
    else if (raw[i] === '{') {
      depth--;
      if (depth === 0) return raw.slice(i, end + 1);
    }
  }
  return null;
}

/**
 * The `usage` block of the final result, whose keys are the API's own:
 * `input_tokens`, `output_tokens`, `cache_read_input_tokens` and
 * `cache_creation_input_tokens` (the last two can be null).
 */
function tokensFromUsageBlock(block: unknown): TokenUsage | null {
  if (!block || typeof block !== 'object') return null;
  const b = block as Record<string, unknown>;
  return normaliseTokens({
    input: b.input_tokens,
    output: b.output_tokens,
    cache_read: b.cache_read_input_tokens,
    cache_creation: b.cache_creation_input_tokens,
  });
}

/**
 * The same counts by model — `modelUsage`, camelCase — added up. A session
 * that ran a second model (a sub-agent on a smaller one, say) has the
 * counts of both here.
 */
function tokensFromModelUsage(block: unknown): TokenUsage | null {
  if (!block || typeof block !== 'object') return null;
  const perModel: TokenUsage[] = [];
  for (const model of Object.values(block as Record<string, unknown>)) {
    if (!model || typeof model !== 'object') continue;
    const m = model as Record<string, unknown>;
    perModel.push(
      normaliseTokens({
        input: m.inputTokens,
        output: m.outputTokens,
        cache_read: m.cacheReadInputTokens,
        cache_creation: m.cacheCreationInputTokens,
      }),
    );
  }
  return perModel.length === 0 ? null : addTokens(...perModel);
}

/**
 * Tokens from a Claude CLI result event, verbatim.
 *
 * Both blocks are running totals for the session, so this reads the one
 * result and never adds one result to another. It looks at both because
 * either can be missing or short in a version of the CLI it was not written
 * against: the larger total wins, so a block that came out empty cannot
 * undercount one that did not. Neither present is `undefined` — "the engine
 * said nothing" — and not a step that processed nothing.
 */
export function tokensFromResult(event: {
  usage?: unknown;
  modelUsage?: unknown;
}): TokenUsage | undefined {
  const candidates = [
    tokensFromUsageBlock(event.usage),
    tokensFromModelUsage(event.modelUsage),
  ].filter((c): c is TokenUsage => c !== null);
  if (candidates.length === 0) return undefined;
  return candidates.reduce((best, c) => (totalTokens(c) > totalTokens(best) ? c : best));
}

/** The JSON the Claude CLI prints with --output-format json. */
export function usageFromClaudeJson(raw: string): Usage {
  try {
    const json = lastJsonObject(raw);
    if (!json) return { costUsd: ZERO };
    const parsed = JSON.parse(json) as {
      total_cost_usd?: number;
      duration_ms?: number;
      session_id?: string;
      num_turns?: number;
      usage?: unknown;
      modelUsage?: unknown;
    };
    return {
      costUsd: normaliseCost(parsed.total_cost_usd),
      tokens: tokensFromResult(parsed),
      durationMs: parsed.duration_ms,
      sessionId: parsed.session_id,
      turns: parsed.num_turns,
    };
  } catch {
    return { costUsd: ZERO };
  }
}

/** The usage file the design CLI writes with --usage. */
export function usageFromDesignJson(raw: string): Usage {
  try {
    const json = lastJsonObject(raw);
    if (!json) return { costUsd: ZERO };
    const parsed = JSON.parse(json) as {
      cost_usd?: number;
      duration_ms?: number;
      usage?: unknown;
      modelUsage?: unknown;
      input_tokens?: number;
      output_tokens?: number;
    };
    // The design tool's usage file is not documented to carry tokens. If it
    // does — a `usage` block like the API's, or the two counts at the top —
    // they are read; if not, there are none, and that is said by absence.
    const top =
      parsed.input_tokens !== undefined || parsed.output_tokens !== undefined
        ? tokensFromUsageBlock(parsed)
        : undefined;
    return {
      costUsd: normaliseCost(parsed.cost_usd),
      tokens: tokensFromResult(parsed) ?? top ?? undefined,
      durationMs: parsed.duration_ms,
    };
  } catch {
    return { costUsd: ZERO };
  }
}

export function addCosts(...values: string[]): string {
  const total = values.reduce((sum, value) => sum + Math.round(Number(value) * 10_000), 0);
  return (total / 10_000).toFixed(4);
}
