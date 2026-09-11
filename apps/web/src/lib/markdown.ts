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

export type Block =
  | { kind: 'heading'; level: number; content: Inline[] }
  | { kind: 'list'; items: Inline[][] }
  | { kind: 'code'; lines: string[] }
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

  for (const line of markdown.replace(/\r\n/g, '\n').split('\n')) {
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
