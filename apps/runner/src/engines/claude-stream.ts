/**
 * The Claude CLI's event stream, rendered as a log a person can read.
 *
 * With `--output-format json` the CLI is silent for the whole step and then
 * prints one JSON object: usage, cost, the final message, and nothing about
 * the two minutes in between. Somebody watching the ticket saw an empty
 * panel and then a wall of JSON. With `--output-format stream-json` the CLI
 * emits one JSON line per event as it works — what the agent said, which tool
 * it reached for and with what, what came back — and this turns each into a
 * line: the agent's words as they are, a tool call as `▶ Read src/x.ts`, a
 * tool that failed as `✗ error: …`, and at the end one summary with turns,
 * time and cost, followed by the agent's own closing message. The markers
 * are the ones the ticket page already colours: ▶ for a command, ✓, ✗ and ⚠.
 *
 * The final `result` event is kept verbatim as `resultJson`, because that is
 * where the cost lives and `usageFromClaudeJson` reads it exactly as it read
 * the old single object — the number a ceiling is enforced against does not
 * change shape because the log became legible.
 *
 * A line that is not JSON is passed through untouched. The CLI prints a few
 * of those, and a test fake prints only those.
 */

type Block =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; name: string; input?: Record<string, unknown> }
  | { type: 'tool_result'; content?: unknown; is_error?: boolean }
  | { type: string };

interface Event {
  type?: string;
  subtype?: string;
  model?: string;
  session_id?: string;
  message?: { content?: Block[] | string };
  // result
  is_error?: boolean;
  result?: string;
  num_turns?: number;
  duration_ms?: number;
  total_cost_usd?: number;
  permission_denials?: { tool_name?: string; tool_input?: Record<string, unknown> }[];
}

export class ClaudeStreamRenderer {
  private rest = '';
  /** The final result event, verbatim, for the usage reader. */
  resultJson: string | null = null;
  /** The agent's closing message, for the step's summary. */
  resultText: string | null = null;
  /** How many tools the agent has called, and the last one, for the heartbeat. */
  toolCalls = 0;
  lastTool: string | null = null;

  constructor(private readonly write: (text: string) => void) {}

  /** What the heartbeat says a quiet step has done so far. */
  progress(): string {
    if (this.toolCalls === 0) return 'no tool calls yet';
    return `${this.toolCalls} tool call${this.toolCalls === 1 ? '' : 's'} so far, last: ${this.lastTool}`;
  }

  /** Output as it arrives, in whatever pieces the pipe delivers it. */
  feed(text: string): void {
    this.rest += text;
    const lines = this.rest.split('\n');
    this.rest = lines.pop() ?? '';
    for (const line of lines) this.line(line);
  }

  /** The last partial line, once the process has ended. */
  end(): void {
    if (this.rest.trim()) this.line(this.rest);
    this.rest = '';
  }

  private line(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;
    if (!trimmed.startsWith('{')) {
      this.write(`${line}\n`);
      return;
    }
    let event: Event;
    try {
      event = JSON.parse(trimmed) as Event;
    } catch {
      this.write(`${line}\n`);
      return;
    }
    if (!event || typeof event !== 'object') return;
    this.render(event, trimmed);
  }

  private render(event: Event, raw: string): void {
    // The old single-object output has no `type`; it is a result all the same.
    if (event.type === 'result' || (event.type === undefined && 'total_cost_usd' in event)) {
      this.result(event, raw);
      return;
    }
    switch (event.type) {
      case 'system':
        if (event.subtype === 'init') {
          this.write(`▶ Session started${event.model ? ` · ${event.model}` : ''}\n`);
        }
        return;
      case 'assistant':
        for (const block of blocks(event)) {
          if (block.type === 'text' && 'text' in block && block.text.trim()) {
            this.write(`${block.text.trim()}\n`);
          } else if (block.type === 'tool_use' && 'name' in block) {
            const call = `▶ ${block.name} ${describe(block.name, block.input)}`.trimEnd();
            this.toolCalls += 1;
            this.lastTool = call.slice(2);
            this.write(`${call}\n`);
          }
        }
        return;
      case 'user':
        // What came back is the agent's to read, not the reader's — except a
        // failure, which explains the agent's next move.
        for (const block of blocks(event)) {
          if (block.type === 'tool_result' && 'is_error' in block && block.is_error) {
            this.write(`  ✗ error: ${firstLine(textOf(block.content))}\n`);
          }
        }
        return;
      default:
        // Partial messages, rate-limit notices and whatever else the CLI adds
        // later: nothing a person watching the step needs to see.
        return;
    }
  }

  private result(event: Event, raw: string): void {
    this.resultJson = raw;
    const parts: string[] = [];
    if (event.num_turns !== undefined)
      parts.push(`${event.num_turns} turn${event.num_turns === 1 ? '' : 's'}`);
    if (event.duration_ms !== undefined) parts.push(duration(event.duration_ms));
    if (event.total_cost_usd !== undefined) parts.push(`$${event.total_cost_usd.toFixed(4)}`);
    const failed = event.is_error || (event.subtype !== undefined && event.subtype !== 'success');
    this.write(
      `${failed ? '✗ Ended' : '✓ Finished'}${parts.length ? ` · ${parts.join(' · ')}` : ''}\n`,
    );

    if (typeof event.result === 'string' && event.result.trim()) {
      this.resultText = event.result.trim();
      this.write(`\n${this.resultText}\n`);
    }
    for (const denial of event.permission_denials ?? []) {
      // The agent reached for a tool its allowed tools do not include. Said
      // here because nothing else says it: in `-p` mode a refusal is silent,
      // and the step simply proceeds without whatever that tool would have
      // told it.
      const call = `${denial.tool_name ?? 'unknown'} ${describe(denial.tool_name ?? '', denial.tool_input)}`;
      this.write(`⚠ Tool refused: ${call.trimEnd()} — not in this agent’s allowed tools\n`);
    }
  }
}

function blocks(event: Event): Block[] {
  const content = event.message?.content;
  if (Array.isArray(content)) return content;
  if (typeof content === 'string' && content.trim()) return [{ type: 'text', text: content }];
  return [];
}

/** The one argument that says what a tool call was about, kept short. */
function describe(name: string, input: Record<string, unknown> | undefined): string {
  if (!input) return '';
  const pick = (...keys: string[]) => {
    for (const key of keys) {
      const value = input[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return undefined;
  };
  let detail: string | undefined;
  switch (name) {
    case 'Bash':
    case 'PowerShell':
      detail = pick('command');
      break;
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'NotebookEdit':
      detail = pick('file_path', 'notebook_path', 'path');
      break;
    case 'Grep':
    case 'Glob':
      detail = pick('pattern');
      break;
    case 'WebFetch':
    case 'WebSearch':
      detail = pick('url', 'query');
      break;
    default:
      detail = pick('description', 'command', 'file_path', 'path', 'pattern', 'query', 'prompt');
  }
  if (detail === undefined) {
    const json = JSON.stringify(input);
    detail = json === '{}' ? '' : json;
  }
  return firstLine(detail, 140);
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (part && typeof part === 'object' && 'text' in part ? String(part.text) : ''))
      .join('\n');
  }
  return content === undefined || content === null ? '' : JSON.stringify(content);
}

function firstLine(text: string, max = 200): string {
  const line = text.split('\n').find((candidate) => candidate.trim()) ?? '';
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

function duration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`;
}

/**
 * A line during silence, so a long turn does not look like a hang.
 *
 * Between two tool calls the model can think for a minute, and for that
 * minute the stream is empty. Somebody watching cannot tell that from a
 * step that has stopped. So when nothing has arrived for `quietMs`, one line
 * says how long the step has been going and what it last did — and repeats
 * at that interval for as long as the silence lasts. Every real event resets
 * the clock, so a busy step never sees one.
 */
export class Heartbeat {
  private readonly started: number;
  private lastActivity: number;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly write: (text: string) => void,
    private readonly progress: () => string,
    private readonly options: { quietMs?: number; now?: () => number } = {},
  ) {
    this.started = this.now();
    this.lastActivity = this.started;
  }

  private now(): number {
    return (this.options.now ?? Date.now)();
  }

  private get quietMs(): number {
    return this.options.quietMs ?? 30_000;
  }

  /** Something arrived, so the silence is over. */
  activity(): void {
    this.lastActivity = this.now();
  }

  /** Writes the line if the silence has lasted long enough. Exposed for tests. */
  tick(): void {
    const now = this.now();
    if (now - this.lastActivity < this.quietMs) return;
    const detail = this.progress();
    this.write(`· still working — ${duration(now - this.started)}${detail ? `, ${detail}` : ''}\n`);
    this.lastActivity = now;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), Math.max(1000, Math.floor(this.quietMs / 3)));
    (this.timer as { unref?: () => void }).unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
