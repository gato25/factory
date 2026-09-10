/**
 * Cost comes from what the engine itself reports, never from an estimate of
 * our own (FR-108, research.md D6). Anything we cannot read is zero rather
 * than a guess, because a guessed number would be enforced against a ceiling.
 */

export interface Usage {
  costUsd: string;
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

/** The JSON the Claude CLI prints with --output-format json. */
export function usageFromClaudeJson(raw: string): Usage {
  try {
    const parsed = JSON.parse(raw) as {
      total_cost_usd?: number;
      duration_ms?: number;
      session_id?: string;
      num_turns?: number;
    };
    return {
      costUsd: normaliseCost(parsed.total_cost_usd),
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
    const parsed = JSON.parse(raw) as { cost_usd?: number; duration_ms?: number };
    return { costUsd: normaliseCost(parsed.cost_usd), durationMs: parsed.duration_ms };
  } catch {
    return { costUsd: ZERO };
  }
}

export function addCosts(...values: string[]): string {
  const total = values.reduce((sum, value) => sum + Math.round(Number(value) * 10_000), 0);
  return (total / 10_000).toFixed(4);
}
