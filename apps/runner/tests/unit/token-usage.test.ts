import { describe, expect, test } from 'bun:test';
import { ClaudeStreamRenderer } from '../../src/engines/claude-stream';
import {
  tokensFromResult,
  usageFromClaudeJson,
  usageFromDesignJson,
} from '../../src/engines/usage';

/**
 * Tokens: read from what the engine reported, never made up.
 *
 * The result event of the Claude CLI carries two blocks with the same
 * counts — `usage`, in the API's snake_case, and `modelUsage`, camelCase and
 * by model — both running totals for the session. The key names below are
 * the ones the CLI writes (read from its own code, not from memory).
 */

const usage = {
  input_tokens: 10,
  output_tokens: 200,
  cache_read_input_tokens: 3_000,
  cache_creation_input_tokens: 400,
};

const perModel = (m: { i: number; o: number; r: number; c: number }) => ({
  inputTokens: m.i,
  outputTokens: m.o,
  cacheReadInputTokens: m.r,
  cacheCreationInputTokens: m.c,
  costUSD: 0.1,
});

describe('the counts in a result', () => {
  test('from the usage block', () => {
    expect(tokensFromResult({ usage })).toEqual({
      input: 10,
      output: 200,
      cache_read: 3_000,
      cache_creation: 400,
    });
  });

  test('from the model block alone', () => {
    expect(
      tokensFromResult({
        modelUsage: { 'claude-sonnet-5': perModel({ i: 10, o: 200, r: 3000, c: 400 }) },
      }),
    ).toEqual({ input: 10, output: 200, cache_read: 3_000, cache_creation: 400 });
  });

  test('a second model adds to the first', () => {
    const out = tokensFromResult({
      modelUsage: {
        'claude-opus-5': perModel({ i: 10, o: 200, r: 3000, c: 400 }),
        'claude-haiku-4-5': perModel({ i: 5, o: 50, r: 100, c: 0 }),
      },
    });
    expect(out).toEqual({ input: 15, output: 250, cache_read: 3_100, cache_creation: 400 });
  });

  test('when the two blocks disagree the larger total wins, so a short one cannot undercount', () => {
    const shortUsage = { input_tokens: 1, output_tokens: 1 };
    const full = { 'claude-opus-5': perModel({ i: 10, o: 200, r: 3000, c: 400 }) };
    expect(totalOf(tokensFromResult({ usage: shortUsage, modelUsage: full }))).toBe(3_610);
    expect(totalOf(tokensFromResult({ usage, modelUsage: {} }))).toBe(3_610);
  });

  test('null cache counts — the CLI can send them — are zero', () => {
    expect(
      tokensFromResult({
        usage: {
          input_tokens: 7,
          output_tokens: 8,
          cache_read_input_tokens: null,
          cache_creation_input_tokens: null,
        },
      }),
    ).toEqual({ input: 7, output: 8, cache_read: 0, cache_creation: 0 });
  });

  test('neither block is "the engine said nothing" — not a step that processed nothing', () => {
    expect(tokensFromResult({})).toBeUndefined();
    expect(tokensFromResult({ usage: 'lots', modelUsage: 3 })).toBeUndefined();
  });

  test('a block full of junk is zeros, not a refusal', () => {
    expect(tokensFromResult({ usage: { input_tokens: 'x', output_tokens: -4 } })).toEqual({
      input: 0,
      output: 0,
      cache_read: 0,
      cache_creation: 0,
    });
  });
});

const totalOf = (t?: {
  input: number;
  output: number;
  cache_read: number;
  cache_creation: number;
}) => (t ? t.input + t.output + t.cache_read + t.cache_creation : 0);

describe('the whole result, as the engine reads it', () => {
  test('cost and tokens both come from the one event', () => {
    const raw = JSON.stringify({
      type: 'result',
      subtype: 'success',
      total_cost_usd: 0.5,
      duration_ms: 4_000,
      usage,
    });
    const read = usageFromClaudeJson(raw);
    expect(read.costUsd).toBe('0.5000');
    expect(totalOf(read.tokens)).toBe(3_610);
  });

  test('printed after other output, it is still the last object that counts', () => {
    const raw = `warming up…\n${JSON.stringify({ total_cost_usd: 0.25, usage })}`;
    expect(usageFromClaudeJson(raw).tokens?.cache_read).toBe(3_000);
  });

  test('a result with no usage has a cost and no tokens', () => {
    const read = usageFromClaudeJson(JSON.stringify({ total_cost_usd: 0.25 }));
    expect(read.costUsd).toBe('0.2500');
    expect(read.tokens).toBeUndefined();
  });

  test('output that is not JSON at all is zero cost and no tokens', () => {
    expect(usageFromClaudeJson('the CLI crashed')).toEqual({ costUsd: '0.0000' });
  });
});

describe('the design tool’s usage file', () => {
  test('counts are read if the tool writes them, in the API’s shape', () => {
    const read = usageFromDesignJson(JSON.stringify({ cost_usd: 0.4, usage }));
    expect(read.costUsd).toBe('0.4000');
    expect(totalOf(read.tokens)).toBe(3_610);
  });

  test('or as two counts at the top', () => {
    const read = usageFromDesignJson(
      JSON.stringify({ cost_usd: 0.4, input_tokens: 500, output_tokens: 250 }),
    );
    expect(read.tokens).toEqual({ input: 500, output: 250, cache_read: 0, cache_creation: 0 });
  });

  test('a tool that reports only cost has no tokens — said by absence', () => {
    const read = usageFromDesignJson(JSON.stringify({ cost_usd: 0.4, duration_ms: 9_000 }));
    expect(read.costUsd).toBe('0.4000');
    expect(read.tokens).toBeUndefined();
  });
});

/** An assistant event, as the CLI emits one per content block of a response. */
const turn = (id: string | undefined, u: Record<string, number>, block = 'text') =>
  JSON.stringify({
    type: 'assistant',
    message: {
      id,
      content: [
        block === 'text'
          ? { type: 'text', text: 'ok' }
          : { type: 'tool_use', name: 'Read', input: {} },
      ],
      usage: u,
    },
  });

function feed(...events: string[]): ClaudeStreamRenderer {
  const renderer = new ClaudeStreamRenderer(() => {});
  renderer.feed(`${events.join('\n')}\n`);
  renderer.end();
  return renderer;
}

describe('a step stopped before it reported — what the stream itself counted', () => {
  test('one response emitted as two events is counted once', () => {
    const u = { input_tokens: 5, output_tokens: 100, cache_read_input_tokens: 1000 };
    const r = feed(turn('msg_1', u, 'text'), turn('msg_1', u, 'tool'));
    expect(r.observedTokens()).toEqual({
      input: 5,
      output: 100,
      cache_read: 1000,
      cache_creation: 0,
    });
    // …though it is two events, and turns count events.
    expect(r.turns).toBe(2);
  });

  test('separate responses add up', () => {
    const r = feed(
      turn('msg_1', { input_tokens: 5, output_tokens: 100 }),
      turn('msg_2', { input_tokens: 7, output_tokens: 300, cache_creation_input_tokens: 50 }),
    );
    expect(r.observedTokens()).toEqual({
      input: 12,
      output: 400,
      cache_read: 0,
      cache_creation: 50,
    });
  });

  test('a response whose count grew as it streamed is counted at the largest', () => {
    const r = feed(
      turn('msg_1', { input_tokens: 5, output_tokens: 10 }),
      turn('msg_1', { input_tokens: 5, output_tokens: 90 }),
      turn('msg_1', { input_tokens: 5, output_tokens: 40 }),
    );
    expect(r.observedTokens().output).toBe(90);
  });

  test('events with no id cannot be told apart, so each stands for itself', () => {
    const r = feed(turn(undefined, { output_tokens: 10 }), turn(undefined, { output_tokens: 10 }));
    expect(r.observedTokens().output).toBe(20);
  });

  test('the words for a stopped step use the whole count, compactly', () => {
    const r = feed(
      turn('msg_1', { input_tokens: 5, output_tokens: 100, cache_read_input_tokens: 1_200_000 }),
    );
    expect(r.observed()).toBe('1 turn and 1.2M tokens');
  });

  test('a stream that said nothing observed nothing', () => {
    expect(feed().observed()).toBeNull();
    expect(feed().observedTokens()).toEqual({
      input: 0,
      output: 0,
      cache_read: 0,
      cache_creation: 0,
    });
  });
});
