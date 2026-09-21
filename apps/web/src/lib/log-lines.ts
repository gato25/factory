import { stripAnsi } from '@factory/shared';

/**
 * Raw command-line output, turned into rows a person can read.
 *
 * The panel used to print what arrived, one line per line. What arrives is
 * written for a terminal by a tool that thinks it has one, and a real design
 * step opens like this:
 *
 *     ╭───────────────────────────────╮
 *     │  Update available: 0.3.6 → 0.3.8  │
 *     ╰───────────────────────────────╯
 *     [INFO] pen.dev CLI starting...
 *     [INFO] Input: (empty canvas)
 *     … seven more …
 *     🔧 Using tool: Read
 *     🔧 Using tool: Read
 *     … seven more …
 *     [INFO] Claude permission request PowerShell {
 *       command: '…',
 *     } { signal: AbortSignal { aborted: false }, … }
 *
 * Forty lines in which the agent says one sentence. So this does four things
 * the artboard never had to: it drops the blank lines a terminal pads with,
 * it folds a run of setup chatter or a drawn banner behind a disclosure, it
 * collapses seven identical tool calls into one row that says ×7, and it
 * gathers a brace-balanced payload onto the line that opened it rather than
 * spilling it down the panel.
 *
 * Nothing is discarded. Every folded line is still there, one click away —
 * the log is evidence, and a reader who wants the forty lines must be able
 * to get them.
 *
 * `design.pen` draws five kinds of line and this keeps all five. `info` and
 * `noise` are additions, for output the artboard's three tidy example panels
 * never had to show.
 */

export type RowKind = 'start' | 'tool' | 'prose' | 'info' | 'ok' | 'warn' | 'bad' | 'noise';

export interface Row {
  key: string;
  /** Shown only when it differs from the row above. */
  at: string;
  kind: RowKind;
  /** The line, with whatever marker classified it removed. */
  text: string;
  /** For a tool call: what was called, apart from what it was called with. */
  tool?: string;
  /** How many identical calls this one row stands for. */
  count?: number;
  /** Folded lines: a payload, a banner, or a run of setup chatter. */
  detail?: string[];
}

export interface Chunk {
  seq: number;
  stream: 'stdout' | 'stderr';
  text: string;
  at: Date | string;
}

/** A line the tool drew as a box rather than wrote as a sentence. */
const BOX = /^[\s─-╿=*-]*[─-╿]/;

/** How many lines of one quiet kind are worth hiding rather than showing. */
const FOLD_INFO = 3;
const FOLD_NOISE = 2;

interface Raw {
  key: string;
  at: string;
  stream: 'stdout' | 'stderr';
  text: string;
}

/**
 * Braces outside quotes, so `description: 'a {thing}'` does not open a fold
 * that never closes.
 */
function depthOf(line: string): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (quote) {
      if (c === '\\') i += 1;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') quote = c;
    else if (c === '{' || c === '[') depth += 1;
    else if (c === '}' || c === ']') depth -= 1;
  }
  return depth;
}

/**
 * What a line IS.
 *
 * The marker wins over the stream. `design.pen`'s legend says stderr is
 * always red, and it stays red for anything unrecognised — but a CLI that
 * writes its progress to stderr, which the design tool does, would paint a
 * whole successful run in the error colour. A line that says `[INFO]` is
 * information whichever pipe carried it.
 */
function classify(
  line: string,
  stream: 'stdout' | 'stderr',
): { kind: RowKind; text: string; tool?: string } {
  const body = line.trim();

  // The runner's own echo of the command it is about to run (FR-107).
  if (body.startsWith('$ ')) return { kind: 'start', text: body.slice(2).trim() };

  // The design tool announces each call; the Claude stream renderer writes
  // the same thing as `▶ Name argument`.
  const using = body.match(/^(?:🔧\s*)?Using tool:\s*(\S+)\s*(.*)$/);
  if (using) return { kind: 'tool', tool: using[1] as string, text: (using[2] as string).trim() };
  if (body.startsWith('▶')) {
    const rest = body.slice(1).trim();
    const space = rest.indexOf(' ');
    if (space > 0 && /^[A-Z]/.test(rest)) {
      return { kind: 'tool', tool: rest.slice(0, space), text: rest.slice(space + 1).trim() };
    }
    return { kind: 'tool', tool: rest, text: '' };
  }
  if (body.startsWith('$')) return { kind: 'tool', tool: 'shell', text: body.slice(1).trim() };

  const agent = body.match(/^🤖\s*Agent:\s*(.*)$/);
  if (agent) return { kind: 'prose', text: (agent[1] as string).trim() };

  const tagged = body.match(/^\[(INFO|WARN|WARNING|ERROR|FATAL|DEBUG)\]\s*(.*)$/i);
  if (tagged) {
    const tag = (tagged[1] as string).toUpperCase();
    const text = (tagged[2] as string).trim();
    if (tag === 'ERROR' || tag === 'FATAL') return { kind: 'bad', text };
    if (tag === 'WARN' || tag === 'WARNING') return { kind: 'warn', text };
    return { kind: 'info', text };
  }

  if (body.startsWith('✓') || body.startsWith('✔'))
    return { kind: 'ok', text: body.slice(1).trim() };
  if (body.startsWith('⚠')) return { kind: 'warn', text: body.replace(/^⚠️?/, '').trim() };
  if (body.startsWith('✗') || body.startsWith('✕'))
    return { kind: 'bad', text: body.slice(1).trim() };
  if (/^warning\b/i.test(body)) return { kind: 'warn', text: body };
  if (/^error\b/i.test(body)) return { kind: 'bad', text: body };

  // The heartbeat, which is the runner talking about the step, not the step.
  if (body.startsWith('·')) return { kind: 'info', text: body.slice(1).trim() };

  if (BOX.test(body)) return { kind: 'noise', text: body };

  return { kind: stream === 'stderr' ? 'bad' : 'prose', text: body };
}

/** The readable words inside a drawn box, for its summary. */
function unbox(lines: string[]): string {
  return lines
    .map((line) =>
      line
        .replace(/[─-╿|+]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter(Boolean)
    .join(' · ');
}

function clock(at: Date | string): string {
  const when = typeof at === 'string' ? new Date(at) : at;
  return Number.isNaN(when.getTime()) ? '' : when.toTimeString().slice(0, 8);
}

/** Chunks in, rows out. */
export function toRows(chunks: readonly Chunk[]): Row[] {
  // 1. Lines, with the time of the chunk that carried them. Blank lines are
  //    KEPT here. Inside a run of the agent’s prose a blank separates one
  //    paragraph from the next and ends a list, which Markdown needs; they
  //    are dropped in step 4, once it is known which ones those are. The one
  //    exception is a chunk’s final empty line, which is the trailing
  //    newline rather than content.
  const raw: Raw[] = [];
  for (const chunk of chunks) {
    const at = clock(chunk.at);
    const parts = stripAnsi(chunk.text).split('\n');
    parts.forEach((text, n) => {
      if (n === parts.length - 1 && text === '') return;
      raw.push({ key: `${chunk.seq}:${n}`, at, stream: chunk.stream, text });
    });
  }

  // 2. Classify. A fenced code block is the agent’s prose whatever its
  //    contents look like, so the fence is tracked across lines rather than
  //    each line being judged alone — `error: ENOENT` inside a fence is an
  //    example the agent is showing you, not a failure of this step.
  interface Marked extends Raw {
    kind: RowKind | 'blank';
    body: string;
    tool?: string;
  }
  const marked: Marked[] = [];
  let fenced = false;
  for (const line of raw) {
    const fence = line.text.trimStart().startsWith('\u0060\u0060\u0060');
    if (fence || fenced) {
      if (fence) fenced = !fenced;
      marked.push({ ...line, kind: 'prose', body: line.text });
      continue;
    }
    if (!line.text.trim()) {
      marked.push({ ...line, kind: 'blank', body: '' });
      continue;
    }
    const { kind, text, tool } = classify(line.text, line.stream);
    marked.push({ ...line, kind, body: text, ...(tool ? { tool } : {}) });
  }

  // 3. Gather a brace-balanced payload onto the line that opened it.
  const rows: Row[] = [];
  let open: Row | null = null;
  let depth = 0;
  for (const line of marked) {
    if (open) {
      open.detail ??= [];
      open.detail.push(line.text.trim());
      depth += depthOf(line.text);
      if (depth <= 0) open = null;
      continue;
    }
    const row: Row = {
      key: line.key,
      at: line.at,
      kind: line.kind as RowKind,
      text: line.body,
      ...(line.tool ? { tool: line.tool } : {}),
    };
    if (line.kind !== 'blank' && line.kind !== 'prose') {
      const d = depthOf(line.text);
      if (d > 0) {
        // `… request PowerShell {` — the head reads on its own, the payload
        // hides behind it.
        row.text = line.body.replace(/\s*[{[]\s*$/, '');
        open = row;
        depth = d;
      }
    }
    // A blank is carried through step 4 and dropped there.
    rows.push(line.kind === 'blank' ? { ...row, kind: 'prose', text: '' } : row);
  }

  // 4. One Markdown block per run of the agent’s prose.
  //
  //    The agent writes Markdown — a heading, a bullet list, `a path` in
  //    backticks — and it arrives one line at a time. Rendered a line at a
  //    time it stayed literal: readers saw `**Task 1**` with its asterisks.
  //    Joined back into a block it can be parsed as what it is. Blank lines
  //    inside the run are kept because they are the paragraph breaks;
  //    leading and trailing ones are not, and a gap of three or more is
  //    still just one break.
  const joined: Row[] = [];
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i] as Row;
    if (row.kind !== 'prose' || row.detail) {
      joined.push(row);
      continue;
    }
    let end = i;
    while (end + 1 < rows.length && (rows[end + 1] as Row).kind === 'prose') end += 1;
    const lines = rows
      .slice(i, end + 1)
      .map((r) => (r as Row).text)
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    i = end;
    // A run that was nothing but blank lines says nothing.
    if (lines) joined.push({ ...row, text: lines });
  }

  // 5. Fold a run of one quiet kind into the first of them.
  const folded: Row[] = [];
  for (let i = 0; i < joined.length; i += 1) {
    const row = joined[i] as Row;
    const quiet = row.kind === 'info' ? FOLD_INFO : row.kind === 'noise' ? FOLD_NOISE : 0;
    if (quiet === 0 || row.detail) {
      folded.push(row);
      continue;
    }
    let end = i;
    while (end + 1 < joined.length && (joined[end + 1] as Row).kind === row.kind) end += 1;
    const run = joined.slice(i, end + 1) as Row[];
    if (run.length < quiet) {
      folded.push(row);
      continue;
    }
    const rest = run.slice(1).map((r) => r.text);
    folded.push({
      ...row,
      // A banner’s point is the sentence inside it, not the frame.
      text:
        row.kind === 'noise' ? unbox(run.map((r) => r.text)) || `${run.length} lines` : row.text,
      detail: row.kind === 'noise' ? run.map((r) => r.text) : rest,
      count: run.length,
    });
    i = end;
  }

  // 6. Seven identical calls are one call seven times, and read better said
  //    that way. Adjacent only, so the order still means something.
  const out: Row[] = [];
  for (const row of folded) {
    const last = out[out.length - 1];
    if (
      last &&
      last.kind === 'tool' &&
      row.kind === 'tool' &&
      last.tool === row.tool &&
      !last.text &&
      !row.text &&
      !last.detail &&
      !row.detail
    ) {
      last.count = (last.count ?? 1) + 1;
      continue;
    }
    out.push({ ...row });
  }

  // 7. A time is printed only when it changes. It already repeated for every
  //    line of one chunk, and a column of identical clock readings is the
  //    noisiest thing on the panel.
  let last = '';
  for (const row of out) {
    const at = row.at;
    row.at = at === last ? '' : at;
    last = at;
  }
  return out;
}
