import { describe, expect, test } from 'bun:test';
import { ClaudeStreamRenderer, Heartbeat } from '../../src/engines/claude-stream';
import { usageFromClaudeJson } from '../../src/engines/usage';

/**
 * The CLI's event stream, as a person sees it on the ticket.
 *
 * The events below are the shapes `claude -p --output-format stream-json
 * --verbose` emits: an init, the agent's text and tool calls, tool results,
 * and a closing result that carries the cost. What is held here is that each
 * becomes one legible line, that the cost is still read from the result
 * exactly as it was from the single-object output, and that the stream can
 * arrive cut anywhere.
 */

function render(pieces: string[]): { lines: string[]; renderer: ClaudeStreamRenderer } {
  let out = '';
  const renderer = new ClaudeStreamRenderer((text) => {
    out += text;
  });
  for (const piece of pieces) renderer.feed(piece);
  renderer.end();
  return { lines: out.split('\n').filter((line) => line.length > 0), renderer };
}

const init = JSON.stringify({
  type: 'system',
  subtype: 'init',
  session_id: '35654891-de5a',
  model: 'claude-opus-5',
  tools: ['Read', 'Write'],
});
const said = JSON.stringify({
  type: 'assistant',
  message: { content: [{ type: 'text', text: 'Reading the admin routes first.' }] },
});
const read = JSON.stringify({
  type: 'assistant',
  message: {
    content: [
      {
        type: 'tool_use',
        id: 't1',
        name: 'Read',
        input: { file_path: 'src/routes/admin/+page.svelte' },
      },
    ],
  },
});
const readBack = JSON.stringify({
  type: 'user',
  message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: '<script>…</script>' }] },
});
const bash = JSON.stringify({
  type: 'assistant',
  message: {
    content: [
      { type: 'tool_use', id: 't2', name: 'Bash', input: { command: 'ls src\nls static' } },
    ],
  },
});
const bashFailed = JSON.stringify({
  type: 'user',
  message: {
    content: [
      {
        type: 'tool_result',
        tool_use_id: 't2',
        is_error: true,
        content: 'ls: cannot access src\nno such file',
      },
    ],
  },
});
const result = JSON.stringify({
  type: 'result',
  subtype: 'success',
  is_error: false,
  duration_ms: 105_895,
  num_turns: 17,
  total_cost_usd: 0.979335,
  session_id: '35654891-de5a',
  result:
    'Wrote `docs/spec.md`.\n\nThe ticket had no acceptance criteria, so the spec had to define the work.',
  permission_denials: [
    {
      tool_name: 'PowerShell',
      tool_input: { command: 'Get-Content src\\routes\\admin\\+page.svelte -TotalCount 60' },
    },
  ],
});

describe('each event becomes a line a person can read', () => {
  const { lines, renderer } = render([
    `${[init, said, read, readBack, bash, bashFailed, result].join('\n')}\n`,
  ]);

  test('the session, the words, the tool calls', () => {
    expect(lines[0]).toBe('▶ Session started · claude-opus-5');
    expect(lines[1]).toBe('Reading the admin routes first.');
    expect(lines[2]).toBe('▶ Read src/routes/admin/+page.svelte');
    // A command is shown by its first line; a result that succeeded is not shown.
    expect(lines[3]).toBe('▶ Bash ls src');
    expect(lines[4]).toBe('  ✗ error: ls: cannot access src');
  });

  test('the summary carries turns, time and cost, then the closing message', () => {
    expect(lines[5]).toBe('✓ Finished · 17 turns · 1m 46s · $0.9793');
    expect(lines[6]).toBe('Wrote `docs/spec.md`.');
    expect(lines[7]).toBe(
      'The ticket had no acceptance criteria, so the spec had to define the work.',
    );
  });

  test('a refused tool is named, because in -p mode nothing else says it', () => {
    expect(lines[8]).toBe(
      '⚠ Tool refused: PowerShell Get-Content src\\routes\\admin\\+page.svelte -TotalCount 60 — not in this agent’s allowed tools',
    );
  });

  test('the raw JSON never reaches the log', () => {
    expect(lines.join('\n')).not.toContain('"type"');
    expect(lines.join('\n')).not.toContain('total_cost_usd');
  });

  test('the cost is read from the result event exactly as before', () => {
    expect(renderer.resultJson).toBe(result);
    const usage = usageFromClaudeJson(renderer.resultJson ?? '');
    expect(usage.costUsd).toBe('0.9793');
    expect(usage.durationMs).toBe(105_895);
    expect(usage.sessionId).toBe('35654891-de5a');
    expect(renderer.resultText?.startsWith('Wrote `docs/spec.md`.')).toBe(true);
  });
});

test('a stream cut anywhere renders the same', () => {
  const whole = `${[init, said, read, result].join('\n')}\n`;
  const expected = render([whole]).lines;
  for (const size of [1, 7, 50, 333]) {
    const pieces: string[] = [];
    for (let at = 0; at < whole.length; at += size) pieces.push(whole.slice(at, at + size));
    expect(render(pieces).lines).toEqual(expected);
  }
});

test('lines that are not JSON pass through untouched', () => {
  const { lines, renderer } = render(['thinking…\nwrote docs/spec.md\n']);
  expect(lines).toEqual(['thinking…', 'wrote docs/spec.md']);
  expect(renderer.resultJson).toBeNull();
});

test('the old single-object output is still a result', () => {
  const { lines, renderer } = render([JSON.stringify({ total_cost_usd: 0.42, num_turns: 3 })]);
  expect(lines).toEqual(['✓ Finished · 3 turns · $0.4200']);
  expect(usageFromClaudeJson(renderer.resultJson ?? '').costUsd).toBe('0.4200');
});

test('a result that ended in error says so', () => {
  const { lines } = render([
    JSON.stringify({ type: 'result', subtype: 'error_max_turns', is_error: true, num_turns: 20 }),
  ]);
  expect(lines[0]).toBe('✗ Ended · 20 turns');
});

test('an empty object is nothing, not a result', () => {
  const { lines, renderer } = render(['{}\n']);
  expect(lines).toEqual([]);
  expect(renderer.resultJson).toBeNull();
});

describe('the heartbeat during silence', () => {
  test('says how long and what was last done, and only after the quiet period', () => {
    let clock = 1_000_000;
    let out = '';
    const renderer = new ClaudeStreamRenderer(() => {});
    const beat = new Heartbeat(
      (text) => {
        out += text;
      },
      () => renderer.progress(),
      { quietMs: 30_000, now: () => clock },
    );
    renderer.feed(`${read}\n`);
    beat.activity();

    clock += 20_000;
    beat.tick();
    expect(out).toBe('');

    clock += 15_000;
    beat.tick();
    expect(out).toBe(
      '· still working — 35s, 1 tool call so far, last: Read src/routes/admin/+page.svelte\n',
    );

    // It repeats for as long as the silence lasts, and no sooner.
    clock += 10_000;
    beat.tick();
    expect(out.split('\n').filter(Boolean)).toHaveLength(1);
    clock += 25_000;
    beat.tick();
    expect(out.split('\n').filter(Boolean)).toHaveLength(2);
    expect(out).toContain('1m 10s');
  });

  test('a step that has called nothing yet says so', () => {
    const renderer = new ClaudeStreamRenderer(() => {});
    expect(renderer.progress()).toBe('no tool calls yet');
  });
});
