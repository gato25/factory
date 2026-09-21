import { expect, test } from 'bun:test';
import { ago } from '../../src/lib/format';
import { blocks, inline } from '../../src/lib/markdown';

/**
 * The skill editor previews Markdown, and a preview is only worth having if
 * it agrees with what a run will read. These cover the subset a SKILL.md
 * actually uses — and the one property that matters for safety: the parser
 * returns data, so nothing a skill contains can become markup.
 */

test('headings, bullets and paragraphs come back as blocks', () => {
  const parsed = blocks(
    '# Repo conventions\n\n## Naming\n- Files: kebab-case.\n- Tests next door.',
  );
  expect(parsed.map((b) => b.kind)).toEqual(['heading', 'heading', 'list']);
  expect(parsed[0]).toMatchObject({ level: 1 });
  expect(parsed[1]).toMatchObject({ level: 2 });
  expect(parsed[2]).toMatchObject({ items: [expect.anything(), expect.anything()] });
});

test('a fenced block keeps its lines verbatim, markup and all', () => {
  const [block] = blocks('```\n# not a heading\n- not a bullet\n```');
  expect(block).toEqual({ kind: 'code', lines: ['# not a heading', '- not a bullet'] });
});

test('a fence left open still shows what was typed', () => {
  // Somebody is mid-sentence. Dropping their text would be worse than
  // showing it unclosed.
  const [block] = blocks('```\nhalf a thought');
  expect(block).toEqual({ kind: 'code', lines: ['half a thought'] });
});

test('consecutive lines are one paragraph; a blank line ends it', () => {
  const parsed = blocks('one\ntwo\n\nthree');
  expect(parsed).toHaveLength(2);
  expect(parsed[0]).toMatchObject({ kind: 'paragraph' });
  expect(inline('one two')).toEqual([{ kind: 'text', text: 'one two' }]);
});

test('inline code and bold are parts, never markup', () => {
  expect(inline('Run `npm run lint` and **fix** it')).toEqual([
    { kind: 'text', text: 'Run ' },
    { kind: 'code', text: 'npm run lint' },
    { kind: 'text', text: ' and ' },
    { kind: 'strong', text: 'fix' },
    { kind: 'text', text: ' it' },
  ]);
});

test('HTML in a skill stays text', () => {
  // The renderer never uses {@html}, so this is the parser's half of the
  // promise: a tag is characters, not a node.
  const [block] = blocks('<script>alert(1)</script>');
  expect(block).toEqual({
    kind: 'paragraph',
    content: [{ kind: 'text', text: '<script>alert(1)</script>' }],
  });
});

test('the design writes a distance, not a date', () => {
  const now = new Date('2026-09-11T12:00:00Z');
  expect(ago(new Date('2026-09-09T12:00:00Z'), now)).toBe('2 days ago');
  // 36 hours is nearer two days than one, and reads that way.
  expect(ago(new Date('2026-09-10T00:00:00Z'), now)).toBe('2 days ago');
  expect(ago(new Date('2026-09-11T11:40:00Z'), now)).toBe('20 minutes ago');
  expect(ago(new Date('2026-09-11T11:59:50Z'), now)).toBe('just now');
  expect(ago('not a date', now)).toBe('at an unknown time');
});

/**
 * Tables. An agent writing a plan or a summary reaches for one constantly,
 * and without this the reader saw the pipes.
 */
test('a pipe table becomes a table, with its alignments', () => {
  const [block] = blocks(
    ['| Step | Time | Cost |', '| --- | :---: | ---: |', '| Spec | 2m 10s | $0.14 |'].join('\n'),
  );
  expect(block).toEqual({
    kind: 'table',
    align: [null, 'center', 'right'],
    head: [
      [{ kind: 'text', text: 'Step' }],
      [{ kind: 'text', text: 'Time' }],
      [{ kind: 'text', text: 'Cost' }],
    ],
    rows: [
      [
        [{ kind: 'text', text: 'Spec' }],
        [{ kind: 'text', text: '2m 10s' }],
        [{ kind: 'text', text: '$0.14' }],
      ],
    ],
  });
});

test('the outer pipes are optional, and cells carry inline marks', () => {
  const [block] = blocks(['a | b', '--- | ---', '`x` | **y**'].join('\n'));
  expect(block?.kind).toBe('table');
  if (block?.kind !== 'table') throw new Error('not a table');
  expect(block.rows[0]).toEqual([[{ kind: 'code', text: 'x' }], [{ kind: 'strong', text: 'y' }]]);
});

test('a short row is squared off against the header', () => {
  const [block] = blocks(['| a | b | c |', '| - | - | - |', '| only |'].join('\n'));
  if (block?.kind !== 'table') throw new Error('not a table');
  expect(block.rows[0]).toHaveLength(3);
  expect(block.rows[0]?.[2]).toEqual([]);
});

test('a sentence containing a pipe is still a sentence', () => {
  // The delimiter line underneath is what makes a table, not the pipe.
  const [block] = blocks('Run `a | b` to pipe it');
  expect(block?.kind).toBe('paragraph');
});

test('the table ends where its rows end', () => {
  const out = blocks(['| a |', '| - |', '| 1 |', '', 'After the table.'].join('\n'));
  expect(out.map((b) => b.kind)).toEqual(['table', 'paragraph']);
});
