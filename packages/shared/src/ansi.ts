/**
 * Terminal escape sequences, removed from captured output.
 *
 * A tool run inside the sandbox writes for a terminal, because that is what
 * it believes it is attached to. The pen.dev CLI colours its banner, the
 * Claude CLI dims a hint, a test runner paints a diff red. None of that
 * survives the trip: the bytes are stored and then rendered as HTML, where
 * `[33m` is not a colour but four visible characters in the middle of
 * the sentence somebody is trying to read.
 *
 * Stripped at INGEST, beside redaction and for the same reason (Principle
 * V): every consumer of a step's output would otherwise have to do it, and
 * the one that forgets — a failure detail quoted into an error, say — shows
 * the escape codes to a person.
 *
 * What is removed is the non-printing part only. CSI sequences (colour,
 * cursor movement, erase), OSC strings (window titles, hyperlinks) and the
 * two-character escapes are matched; the text they wrapped is kept, because
 * the text is the output. A lone carriage return from a progress bar is
 * dropped too, since it re-draws a line that HTML has no way to re-draw.
 */

// biome-ignore lint/suspicious/noControlCharactersInRegex: escape sequences are control characters by definition.
const CSI = /\[[0-?]*[ -/]*[@-~]/g;
// biome-ignore lint/suspicious/noControlCharactersInRegex: as above.
const OSC = /\][^]*(?:|\\)/g;
// biome-ignore lint/suspicious/noControlCharactersInRegex: as above.
const SHORT = /[@-Z\\-_]/g;
// A CR that is not part of a CRLF: a progress bar rewriting its own line.
const BARE_CR = /\r(?!\n)/g;

export function stripAnsi(text: string): string {
  return text.replace(CSI, '').replace(OSC, '').replace(SHORT, '').replace(BARE_CR, '');
}
