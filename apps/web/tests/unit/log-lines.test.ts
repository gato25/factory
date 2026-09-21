import { describe, expect, test } from 'bun:test';
import { type Chunk, type Row, toRows } from '../../src/lib/log-lines';

/**
 * The fixture is real: the opening of a design step, copied out of the panel
 * where it read badly. Forty-odd lines in which the agent says one sentence
 * and reads nine files, wrapped in escape codes, an update banner and a
 * permission object printed across twenty lines.
 */
const DESIGN_STEP = [
  '$ pen --repo /work --out docs/design/ui.pen --export-scale 2',
  '[33m  ╭───────────────────────────────────────╮[39m',
  '',
  '[33m  │[39m  Update available: [2m0.3.6[22m → [32m[1m0.3.8[22m[39m      [33m│[39m',
  '',
  '[33m  ╰───────────────────────────────────────╯[39m',
  '',
  '[INFO] pen.dev CLI starting...',
  '',
  '[INFO] Input: (empty canvas)',
  '',
  '[INFO] Agent: claude',
  '',
  '[INFO] Model: claude-opus-5',
  '',
  '🤖 Agent: I’ll start by understanding the current home page before designing.',
  '',
  '🔧 Using tool: Glob',
  '',
  '🔧 Using tool: Read',
  '',
  '🔧 Using tool: Read',
  '',
  '🔧 Using tool: Read',
  '',
  '[INFO] Claude permission request PowerShell {',
  "  command: 'Get-ChildItem -Recurse src/lib/i18n',",
  "  description: 'Dump Mongolian home translations'",
  '} {',
  '  signal: AbortSignal { aborted: false },',
  "  displayName: 'PowerShell',",
  '}',
  '✓ Finished · 14 turns · 2m 41s · $0.4200',
  '',
].join('\n');

function rows(text: string, stream: 'stdout' | 'stderr' = 'stdout'): Row[] {
  const chunk: Chunk = { seq: 1, stream, text, at: new Date('2026-09-21T12:03:20Z') };
  return toRows([chunk]);
}

describe('a design step, as it actually arrives', () => {
  const out = rows(DESIGN_STEP);

  test('no escape sequence survives into a row', () => {
    for (const row of out) {
      expect(row.text).not.toInclude('');
      for (const line of row.detail ?? []) expect(line).not.toInclude('');
    }
  });

  test('the blank lines a terminal pads with are gone', () => {
    // A tool row carries its name rather than its text, so an empty `text`
    // is only blank when there is no tool either.
    expect(out.every((row) => row.text.trim().length > 0 || Boolean(row.tool))).toBe(true);
  });

  test('the drawn banner folds to the sentence inside it', () => {
    const banner = out.find((row) => row.kind === 'noise');
    expect(banner).toBeDefined();
    expect(banner?.text).toInclude('Update available');
    // Folded, not dropped: every line it stood for is still reachable.
    expect(banner?.detail?.length).toBe(3);
  });

  test('a run of setup chatter folds behind its first line', () => {
    const info = out.find((row) => row.kind === 'info');
    expect(info?.text).toBe('pen.dev CLI starting...');
    expect(info?.count).toBe(4);
    expect(info?.detail).toEqual([
      'Input: (empty canvas)',
      'Agent: claude',
      'Model: claude-opus-5',
    ]);
  });

  test("the agent's own words are prose, without the robot", () => {
    const prose = out.filter((row) => row.kind === 'prose');
    expect(prose).toHaveLength(1);
    expect(prose[0]?.text).toBe(
      'I’ll start by understanding the current home page before designing.',
    );
  });

  test('three identical reads become one row that says so', () => {
    const tools = out.filter((row) => row.kind === 'tool');
    expect(tools.map((t) => [t.tool, t.count])).toEqual([
      ['Glob', undefined],
      ['Read', 3],
    ]);
  });

  test('the permission payload hangs off the line that opened it', () => {
    const request = out.find((row) => row.text.includes('permission request'));
    expect(request?.text).toBe('Claude permission request PowerShell');
    expect(request?.detail).toHaveLength(6);
    expect(request?.detail?.at(-1)).toBe('}');
  });

  test('the whole opening is eight rows rather than thirty-four lines', () => {
    expect(out).toHaveLength(8);
    expect(out.map((row) => row.kind)).toEqual([
      'start',
      'noise',
      'info',
      'prose',
      'tool',
      'tool',
      'info',
      'ok',
    ]);
  });
});

describe('the kinds the artboard draws', () => {
  test('the command the runner echoes opens the log', () => {
    expect(rows('$ pen --repo /work')[0]).toMatchObject({
      kind: 'start',
      text: 'pen --repo /work',
    });
  });

  test('a tool call keeps its argument', () => {
    expect(rows('▶ Read src/auth/index.ts')[0]).toMatchObject({
      kind: 'tool',
      tool: 'Read',
      text: 'src/auth/index.ts',
    });
  });

  test('success, warning and error each keep their tone', () => {
    expect(rows('✓ Finished · 9 turns')[0]?.kind).toBe('ok');
    expect(rows('⚠ Tool refused: Edit')[0]?.kind).toBe('warn');
    expect(rows('✗ error: ENOENT docs/spec.md')[0]?.kind).toBe('bad');
    expect(rows('[ERROR] the canvas could not be written')[0]?.kind).toBe('bad');
  });

  test('anything unrecognised on stderr is still an error', () => {
    expect(rows('Traceback (most recent call last)', 'stderr')[0]?.kind).toBe('bad');
  });

  test('but a tool that writes its progress to stderr is not a failing run', () => {
    // The design CLI does exactly this. Painting it red would say the step
    // failed, forty lines before it succeeded.
    expect(rows('[INFO] pen.dev CLI starting...', 'stderr')[0]?.kind).toBe('info');
    expect(rows('✓ Finished', 'stderr')[0]?.kind).toBe('ok');
  });

  test('a brace inside a quoted string does not open a fold that never shuts', () => {
    // Two lines, below the threshold at which a run of setup chatter folds
    // on its own, so the only thing that could gather them is the payload.
    const out = rows(["[INFO] running { pattern: 'a {thing}' }", '[INFO] next'].join('\n'));
    expect(out).toHaveLength(2);
    expect(out.every((row) => row.detail === undefined)).toBe(true);
  });

  test('an unbalanced brace gathers what follows it, and says where it ends', () => {
    const out = rows(['[INFO] calling Tool {', "  key: 'value',", '}', '[INFO] after'].join('\n'));
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ text: 'calling Tool', detail: ["key: 'value',", '}'] });
    expect(out[1]?.text).toBe('after');
  });

  test("a brace in the agent's own writing never swallows the rest of it", () => {
    // Prose is Markdown, and Markdown contains braces. Folding on one would
    // hide the remainder of a message behind a disclosure nobody asked for.
    const out = rows(['The config takes { "mode": "strict" }', 'and nothing else.'].join('\n'));
    expect(out.every((row) => row.detail === undefined)).toBe(true);
    expect(out.map((row) => row.text)).toEqual([
      'The config takes { "mode": "strict" }',
      'and nothing else.',
    ]);
  });
});

describe('the timestamp', () => {
  test('prints once per change, not once per line', () => {
    const out = toRows([
      {
        seq: 1,
        stream: 'stdout',
        text: '▶ Read a\n▶ Read b\n',
        at: new Date('2026-09-21T12:00:01Z'),
      },
      { seq: 2, stream: 'stdout', text: '▶ Glob c\n', at: new Date('2026-09-21T12:00:09Z') },
    ]);
    expect(out.map((row) => row.at !== '')).toEqual([true, false, true]);
  });
});

describe("the agent's prose, which is a log and not a document", () => {
  test('a line stays a line', () => {
    // The first attempt joined every run of prose and gave it to the
    // Markdown parser, which reflowed it: two statements the agent made at
    // different moments became one paragraph. Only the constructs that
    // genuinely span lines are gathered now.
    const out = rows(['Reading the plan.', 'The home page has six sections:'].join('\n'));
    expect(out.map((r) => r.text)).toEqual([
      'Reading the plan.',
      'The home page has six sections:',
    ]);
  });

  test('a heading does not absorb the line after it', () => {
    const out = rows(['## Plan', 'First we read the spec.'].join('\n'));
    expect(out.map((r) => r.text)).toEqual(['## Plan', 'First we read the spec.']);
  });

  test('a run of bullets is one row, because a list spans lines', () => {
    const out = rows(['- **One** first', '- Then it', 'Not a bullet.'].join('\n'));
    expect(out).toHaveLength(2);
    expect(out[0]?.text).toBe('- **One** first\n- Then it');
    expect(out[1]?.text).toBe('Not a bullet.');
  });

  test('a tool call between two remarks keeps them apart', () => {
    const out = rows(['thinking', '▶ Read src/x.ts', 'done thinking'].join('\n'));
    expect(out.map((r) => r.kind)).toEqual(['prose', 'tool', 'prose']);
  });

  test('a fenced block is one row, whatever the lines inside it look like', () => {
    const fence = '```';
    const out = rows(['Here is what broke:', fence, 'error: ENOENT', fence].join('\n'));
    expect(out).toHaveLength(2);
    expect(out[1]?.kind).toBe('prose');
    expect(out[1]?.text).toContain('error: ENOENT');
  });

  test('a table is one row: header, delimiter and body together', () => {
    const out = rows(['| Step | Time |', '| --- | --- |', '| Spec | 2m |', 'Done.'].join('\n'));
    expect(out).toHaveLength(2);
    expect(out[0]?.text.split('\n')).toHaveLength(3);
    expect(out[1]?.text).toBe('Done.');
  });

  test('a rule under a line that happens to contain a pipe is not a table', () => {
    // The delimiter pattern alone matches a bare rule, so a log line
    // carrying a pipe became a table with no body. Counting cells stops it.
    const out = rows(['Task 5 | Write tests', '----------------------', 'Done.'].join('\n'));
    expect(out).toHaveLength(3);
  });
});
