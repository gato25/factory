/**
 * Enough Markdown to preview a skill.
 *
 * A skill is a Markdown document an agent reads, and `design.pen`'s editor
 * offers a Preview beside the source, so something has to turn the text into
 * blocks. This is a subset — headings, bullets, fenced code, paragraphs, and
 * inline `code` and **bold** — chosen because it is what a SKILL.md uses.
 *
 * It returns data, never HTML. The caller renders the blocks with ordinary
 * elements, so a skill cannot inject markup into the page that edits it.
 */

export interface Inline {
  kind: 'text' | 'code' | 'strong';
  text: string;
}

export type Align = 'left' | 'center' | 'right' | null;

export type Block =
  | { kind: 'heading'; level: number; content: Inline[] }
  | { kind: 'list'; items: Inline[][] }
  | { kind: 'code'; lines: string[] }
  | { kind: 'table'; head: Inline[][]; rows: Inline[][][]; align: Align[] }
  | { kind: 'paragraph'; content: Inline[] };

const INLINE = /`([^`]+)`|\*\*([^*]+)\*\*/g;

export function inline(text: string): Inline[] {
  const out: Inline[] = [];
  let at = 0;
  for (const match of text.matchAll(INLINE)) {
    const start = match.index;
    if (start > at) out.push({ kind: 'text', text: text.slice(at, start) });
    out.push(
      match[1] === undefined
        ? { kind: 'strong', text: match[2] as string }
        : { kind: 'code', text: match[1] },
    );
    at = start + match[0].length;
  }
  if (at < text.length) out.push({ kind: 'text', text: text.slice(at) });
  return out;
}

/**
 * A pipe table, the way everything that writes Markdown writes one.
 *
 * A row is recognised only when the line UNDER it is the dashed delimiter,
 * which is what keeps an ordinary sentence containing a pipe from being read
 * as a table. Leading and trailing pipes are optional, as they are
 * everywhere else.
 */
const DELIMITER = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

const looksLikeRow = (line: string | undefined): boolean =>
  Boolean(line?.includes('|')) && line?.trim() !== '';

function cells(line: string): string[] {
  let text = line.trim();
  if (text.startsWith('|')) text = text.slice(1);
  if (text.endsWith('|')) text = text.slice(0, -1);
  return text.split('|').map((cell) => cell.trim());
}

function alignments(line: string): Align[] {
  return cells(line).map((cell) => {
    const left = cell.startsWith(':');
    const right = cell.endsWith(':');
    if (left && right) return 'center';
    if (right) return 'right';
    if (left) return 'left';
    return null;
  });
}

export function blocks(markdown: string): Block[] {
  const out: Block[] = [];
  let paragraph: string[] = [];
  let items: Inline[][] | null = null;
  let fence: string[] | null = null;

  const endParagraph = () => {
    if (paragraph.length > 0) {
      out.push({ kind: 'paragraph', content: inline(paragraph.join(' ')) });
      paragraph = [];
    }
  };
  const endList = () => {
    if (items) {
      out.push({ kind: 'list', items });
      items = null;
    }
  };

  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] as string;
    if (fence) {
      if (line.trimStart().startsWith('```')) {
        out.push({ kind: 'code', lines: fence });
        fence = null;
      } else {
        fence.push(line);
      }
      continue;
    }
    if (line.trimStart().startsWith('```')) {
      endParagraph();
      endList();
      fence = [];
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      endParagraph();
      endList();
      out.push({
        kind: 'heading',
        level: (heading[1] as string).length,
        content: inline(heading[2] as string),
      });
      continue;
    }

    // Checked before the list, because `| --- |` would otherwise read as a
    // bullet, and before the paragraph, because every row would.
    if (looksLikeRow(line) && DELIMITER.test(lines[i + 1] ?? '')) {
      endParagraph();
      endList();
      const align = alignments(lines[i + 1] as string);
      const head = cells(line).map(inline);
      const rows: Inline[][][] = [];
      let at = i + 2;
      while (looksLikeRow(lines[at])) {
        const row = cells(lines[at] as string);
        // Squared off against the header, so a short row does not shear the
        // table and a long one does not widen it past its own headings.
        while (row.length < head.length) row.push('');
        rows.push(row.slice(0, head.length).map(inline));
        at += 1;
      }
      out.push({ kind: 'table', head, rows, align });
      i = at - 1;
      continue;
    }

    const item = /^\s*[-*]\s+(.*)$/.exec(line);
    if (item) {
      endParagraph();
      if (!items) items = [];
      items.push(inline(item[1] as string));
      continue;
    }

    if (!line.trim()) {
      endParagraph();
      endList();
      continue;
    }
    endList();
    paragraph.push(line.trim());
  }

  // An unterminated fence is still code: the writer is mid-sentence, and
  // dropping what they typed would be worse than showing it unclosed.
  if (fence) out.push({ kind: 'code', lines: fence });
  endParagraph();
  endList();
  return out;
}
