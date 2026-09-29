import { describeBytes } from '@factory/shared';

/**
 * What a command's result remembers of everything it printed.
 *
 * A command's output goes to two places. The live log gets every chunk as it
 * arrives (`onOutput`), which needs no memory at all. The RESULT also carried
 * every byte, in one string that grew with the output — so a step that never
 * stopped printing was a process that never stopped growing. One second of a
 * loop printing a line was enough to end the runner with `Out of memory`, well
 * before the step's own deadline could fire, and the runner holds every run on
 * the machine: they all restarted their current step with it.
 *
 * Nothing that reads a result needs all of it. A failure detail wants the end,
 * where the error is; a fallback for the CLI's usage object wants a small
 * object; a git command prints a few lines. So the result keeps the beginning
 * and the end, and a line between them saying how much was left out. The end
 * gets most of the room, because it is the part that explains a failure.
 *
 * Two callers do need the whole of something — a document read back out of a
 * sandbox, and a screen encoded for the application — and they say how much
 * with `captureBytes`, at a size their own limits already fix.
 */

/** Per stream. Generous for every command that is not a whole file being read. */
export const DEFAULT_CAPTURE_BYTES = 4 * 1024 * 1024;

/**
 * The most either stream may produce before the command is stopped.
 *
 * Far past anything a step legitimately prints — an agent working for the
 * whole of its time ceiling writes tens of megabytes, a verbose test run
 * fewer. It exists for the loop that prints without end, whose output at
 * gigabytes a second costs the runner its time even when none of it is kept.
 */
export const DEFAULT_MAX_OUTPUT_BYTES = 256 * 1024 * 1024;

export class BoundedText {
  private head = '';
  private tail = '';
  private omitted = 0;
  private readonly headLimit: number;
  private readonly tailLimit: number;

  /** `keep` is in characters, which for the text a command prints is bytes to within a few percent. */
  constructor(keep: number) {
    const wanted = Math.max(2, Math.floor(keep));
    this.headLimit = wanted >> 3;
    this.tailLimit = wanted - this.headLimit;
  }

  add(text: string): void {
    let rest = text;
    if (this.head.length < this.headLimit) {
      const room = this.headLimit - this.head.length;
      this.head += rest.slice(0, room);
      rest = rest.slice(room);
    }
    if (rest.length === 0) return;
    this.tail += rest;
    // Trimmed when it is twice over rather than every time, so a stream of
    // small chunks does not copy the whole tail for each one.
    if (this.tail.length > this.tailLimit * 2) this.trim();
  }

  /** How many characters were dropped from between the two ends so far. */
  get omittedCharacters(): number {
    return this.omitted + Math.max(0, this.tail.length - this.tailLimit);
  }

  toString(): string {
    if (this.tail.length > this.tailLimit) this.trim();
    if (this.omitted === 0) return this.head + this.tail;
    // On a line of its own, so it cannot be mistaken for the end of a line the
    // command was in the middle of.
    return `${this.head}\n… ${describeBytes(this.omitted)} of output left out …\n${this.tail}`;
  }

  private trim(): void {
    const cut = this.tail.length - this.tailLimit;
    this.omitted += cut;
    this.tail = this.tail.slice(cut);
  }
}
