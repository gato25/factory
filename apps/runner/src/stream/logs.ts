import { createRedactor, type Redactor } from '@factory/shared';

/**
 * Output is streamed as it arrives (FR-076) and redacted where it is
 * INGESTED, never where it is displayed (Principle V).
 */

export interface LogChunk {
  seq: number;
  stream: 'stdout' | 'stderr';
  text: string;
}

export interface LogSinkOptions {
  secrets?: string[];
  /** Flush partial output at least this often, so the log feels live. */
  flushBytes?: number;
  send: (chunk: LogChunk) => void | Promise<void>;
}

export class LogSink {
  private seq = 0;
  private readonly redact: Redactor;
  private readonly buffers: Record<'stdout' | 'stderr', string> = { stdout: '', stderr: '' };
  private readonly flushBytes: number;

  constructor(private readonly options: LogSinkOptions) {
    this.redact = createRedactor(options.secrets ?? []);
    this.flushBytes = options.flushBytes ?? 2048;
  }

  /** Buffers to whole lines so a credential cannot be split across chunks. */
  write(stream: 'stdout' | 'stderr', text: string): void {
    this.buffers[stream] += text;
    const lastBreak = this.buffers[stream].lastIndexOf('\n');
    if (lastBreak === -1 && this.buffers[stream].length < this.flushBytes) return;

    const cut = lastBreak === -1 ? this.buffers[stream].length : lastBreak + 1;
    const ready = this.buffers[stream].slice(0, cut);
    this.buffers[stream] = this.buffers[stream].slice(cut);
    this.emit(stream, ready);
  }

  /** Flush whatever is left when a step ends. */
  end(): void {
    for (const stream of ['stdout', 'stderr'] as const) {
      if (this.buffers[stream].length > 0) {
        this.emit(stream, this.buffers[stream]);
        this.buffers[stream] = '';
      }
    }
  }

  private emit(stream: 'stdout' | 'stderr', text: string) {
    this.seq += 1;
    void this.options.send({ seq: this.seq, stream, text: this.redact(text) });
  }

  get chunksSent(): number {
    return this.seq;
  }

  /**
   * The same redaction, for text that is retained but does not go through a
   * chunk — a step's failure detail, above all. That detail is shown to a
   * person and stored, so it is step output in every sense FR-084 means
   * (Principle V). One redactor per step, built from one set of secrets.
   */
  clean(text: string): string {
    return this.redact(text);
  }
}
