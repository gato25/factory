import { createRedactor, type Redactor, stripAnsi } from '@factory/shared';

/**
 * Output is streamed as it arrives (FR-076) and redacted where it is
 * INGESTED, never where it is displayed (Principle V).
 *
 * **Why a burst of output is coalesced (002 T066, D9).** Each chunk this emits
 * is one HTTP request from the execution service to the application, plus one
 * row written. Flushing on every newline — which is what this did — turned a
 * step printing 2,000 lines into 2,000 requests. On the locally administered
 * host that was a loopback call and effectively free; elsewhere, it is a billed
 * request each, and at high volume it starts to approach the platform's
 * 10,000-subrequest ceiling, at which point a verbose step stops working
 * rather than merely costing more.
 *
 * The constraint is that the log must still feel live. So the rule is: a chunk
 * goes out immediately when enough time has passed since the last one, and a
 * burst arriving faster than that is accumulated until it reaches `flushBytes`.
 * A lone line after a quiet pause — "Analysing the ticket…", which is exactly
 * what somebody watching is waiting for — is not delayed at all, while a
 * thousand lines in a tenth of a second become a handful of chunks.
 *
 * **The wart, stated rather than hidden**: output accumulated inside one
 * interval and then followed by silence waits for the next write or for
 * `end()`. It is bounded by `flushBytes`, so at most a couple of kilobytes are
 * ever held, and a step always ends with `end()`. A timer would remove even
 * that, at the cost of teardown that has to be right on every failure path;
 * this is the cheaper trade and the bound is small.
 */

export interface LogChunk {
  seq: number;
  stream: 'stdout' | 'stderr';
  text: string;
}

export interface LogSinkOptions {
  secrets?: string[];
  /** Flush once this much has accumulated, whatever the interval says. */
  flushBytes?: number;
  /**
   * The shortest gap between chunks. Output arriving faster than this is
   * accumulated rather than sent as it comes.
   *
   * 150 ms because it is below what anybody perceives as a delay — the log
   * still reads as live — while being long enough to collapse the bursts that
   * a compiler, a test runner or a verbose agent produce.
   */
  minIntervalMs?: number;
  /** Injected by a test, which has no patience for real intervals. */
  now?: () => number;
  send: (chunk: LogChunk) => void | Promise<void>;
}

export class LogSink {
  private seq = 0;
  private readonly redact: Redactor;
  private readonly buffers: Record<'stdout' | 'stderr', string> = { stdout: '', stderr: '' };
  private readonly flushBytes: number;
  private readonly minIntervalMs: number;
  private readonly now: () => number;
  /** Zero, so the first chunk of a step is never held back. */
  private lastFlushAt = 0;

  constructor(private readonly options: LogSinkOptions) {
    this.redact = createRedactor(options.secrets ?? []);
    this.flushBytes = options.flushBytes ?? 2048;
    this.minIntervalMs = options.minIntervalMs ?? 150;
    this.now = options.now ?? Date.now;
  }

  /** Buffers to whole lines so a credential cannot be split across chunks. */
  write(stream: 'stdout' | 'stderr', text: string): void {
    this.buffers[stream] += text;
    const buffered = this.buffers[stream];
    const lastBreak = buffered.lastIndexOf('\n');

    // Nothing whole to send yet. A partial line is held so a credential cannot
    // be split across two chunks and escape redaction — which is the reason
    // this buffers at all, and it outranks both of the rules below.
    if (lastBreak === -1 && buffered.length < this.flushBytes) return;

    // Enough has piled up that holding more risks the memory rather than the
    // request count, so it goes regardless of the interval.
    const full = buffered.length >= this.flushBytes;
    if (!full && this.now() - this.lastFlushAt < this.minIntervalMs) return;

    const cut = lastBreak === -1 ? buffered.length : lastBreak + 1;
    const ready = buffered.slice(0, cut);
    this.buffers[stream] = buffered.slice(cut);
    this.emit(stream, ready);
  }

  /**
   * Flush whatever is left when a step ends.
   *
   * Unconditional: neither the interval nor the byte threshold applies here,
   * because there is no later write to carry the remainder out. This is what
   * bounds the wart described above.
   */
  end(): void {
    for (const stream of ['stdout', 'stderr'] as const) {
      if (this.buffers[stream].length > 0) {
        this.emit(stream, this.buffers[stream]);
        this.buffers[stream] = '';
      }
    }
  }

  private emit(stream: 'stdout' | 'stderr', text: string) {
    this.lastFlushAt = this.now();
    this.seq += 1;
    void this.options.send({ seq: this.seq, stream, text: this.clean(text) });
  }

  get chunksSent(): number {
    return this.seq;
  }

  /**
   * What every piece of captured output passes through on its way in: the
   * secrets redacted (FR-084, Principle V) and the terminal escape
   * sequences removed. Both belong at ingest rather than at display — a
   * consumer that forgot either would show a credential or a screenful of
   * `[33m` to a person.
   *
   * Public because text that is retained WITHOUT going through a chunk
   * needs the same treatment — a step's failure detail, above all, which
   * is step output in every sense FR-084 means. One redactor per step,
   * built from one set of secrets.
   */
  clean(text: string): string {
    return this.redact(stripAnsi(text));
  }
}
