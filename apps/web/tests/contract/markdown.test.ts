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
