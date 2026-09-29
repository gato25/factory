import { describe, expect, test } from 'bun:test';
import {
  BoundedText,
  DEFAULT_CAPTURE_BYTES,
  DEFAULT_MAX_OUTPUT_BYTES,
} from '../../src/container/capture';
import { drain } from '../../src/container/host';

/**
 * What a command's result remembers of what it printed.
 *
 * The result used to be every byte, in one string. A command that never
 * stopped printing therefore never stopped growing, and one second of it ended
 * the runner with `Out of memory` — every run on the machine with it. These
 * pin what is kept instead, and that the live log still sees all of it.
 */

const MB = 1024 * 1024;

/** A stream that yields these chunks, as a process's pipe does. */
function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let next = 0;
  return new ReadableStream({
    pull(controller) {
      const chunk = chunks[next];
      next += 1;
      if (chunk === undefined) controller.close();
      else controller.enqueue(encoder.encode(chunk));
    },
  });
}

describe('the text a result keeps', () => {
  test('all of it, while it fits', () => {
    const kept = new BoundedText(1000);
    kept.add('first line\n');
    kept.add('second line\n');
    expect(kept.toString()).toBe('first line\nsecond line\n');
  });

  test('the beginning and the end, with a line between saying how much was left out', () => {
    const kept = new BoundedText(1000);
    for (let i = 1; i <= 5000; i += 1) kept.add(`line ${i}\n`);
    const text = kept.toString();
    expect(text.startsWith('line 1\nline 2\n')).toBe(true);
    expect(text.endsWith('line 5000\n')).toBe(true);
    expect(text).toMatch(/\n… [\d.]+ (KB|MB|bytes) of output left out …\n/);
    // Nowhere near the 40 KB that was printed.
    expect(text.length).toBeLessThan(1300);
  });

  test('the end gets most of the room: it is the part that explains a failure', () => {
    const kept = new BoundedText(800);
    kept.add('H'.repeat(400));
    kept.add('M'.repeat(4000));
    kept.add('T'.repeat(400));
    const text = kept.toString();
    const head = text.split('\n')[0] ?? '';
    const tail = text.split('\n').at(-1) ?? '';
    expect(head.length).toBeLessThan(tail.length);
    expect(tail.endsWith('T'.repeat(400))).toBe(true);
    expect(text).not.toContain('M'.repeat(1000));
  });

  test('small chunks and one large chunk keep the same two ends', () => {
    const whole = Array.from({ length: 3000 }, (_, i) => `row ${i}\n`).join('');
    const oneAtATime = new BoundedText(2000);
    for (const line of whole.split(/(?<=\n)/)) oneAtATime.add(line);
    const allAtOnce = new BoundedText(2000);
    allAtOnce.add(whole);
    expect(oneAtATime.toString()).toBe(allAtOnce.toString());
  });

  test('what it holds stays near the limit however much it is given', () => {
    const kept = new BoundedText(1 * MB);
    const chunk = 'x'.repeat(64 * 1024);
    // 200 MB through it, in the pieces a pipe delivers.
    for (let i = 0; i < 3200; i += 1) kept.add(chunk);
    expect(kept.toString().length).toBeLessThan(1.1 * MB);
    expect(kept.omittedCharacters).toBeGreaterThan(190 * MB);
  });

  test('a command that prints exactly what fits is not reported as trimmed', () => {
    const kept = new BoundedText(100);
    kept.add('a'.repeat(100));
    expect(kept.toString()).toBe('a'.repeat(100));
    expect(kept.toString()).not.toContain('left out');
  });

  test('the defaults: room for any ordinary command, a hard stop far above it', () => {
    expect(DEFAULT_CAPTURE_BYTES).toBe(4 * MB);
    expect(DEFAULT_MAX_OUTPUT_BYTES).toBe(256 * MB);
    expect(DEFAULT_MAX_OUTPUT_BYTES).toBeGreaterThan(DEFAULT_CAPTURE_BYTES * 10);
  });
});

describe('reading a stream to its end', () => {
  test('the live log is told everything, even what the result does not keep', async () => {
    const lines = Array.from({ length: 2000 }, (_, i) => `line ${i}\n`);
    const heard: string[] = [];
    const kept = await drain(streamOf(lines), (text) => heard.push(text), { keepBytes: 500 });
    expect(heard.join('')).toBe(lines.join(''));
    expect(kept.length).toBeLessThan(700);
    expect(kept).toContain('of output left out');
    expect(kept.startsWith('line 0\n')).toBe(true);
    expect(kept.endsWith('line 1999\n')).toBe(true);
  });

  test('without a limit set it keeps what an ordinary command prints, whole', async () => {
    const text = 'a line of output\n'.repeat(10_000);
    expect(await drain(streamOf([text]))).toBe(text);
  });

  test('past the limit it says so once and stops reading', async () => {
    const chunk = 'y'.repeat(1024);
    const chunks = Array.from({ length: 1000 }, () => chunk);
    let limited = 0;
    let heard = 0;
    const kept = await drain(
      streamOf(chunks),
      (text) => {
        heard += text.length;
      },
      { keepBytes: 2048, maxBytes: 10 * 1024, onLimit: () => (limited += 1) },
    );
    expect(limited).toBe(1);
    // It stopped: the rest of the megabyte was never read.
    expect(heard).toBeLessThan(20 * 1024);
    expect(kept.length).toBeLessThan(4096);
  });

  test('a limit that is not reached changes nothing', async () => {
    let limited = 0;
    const kept = await drain(streamOf(['one\n', 'two\n']), undefined, {
      maxBytes: 1024,
      onLimit: () => (limited += 1),
    });
    expect(kept).toBe('one\ntwo\n');
    expect(limited).toBe(0);
  });

  test('multi-byte characters split across chunks survive being kept', async () => {
    const encoder = new TextEncoder();
    const bytes = encoder.encode('токен ашигласан\n');
    const half = Math.floor(bytes.length / 2);
    let next = 0;
    const pieces = [bytes.slice(0, half), bytes.slice(half)];
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        const piece = pieces[next];
        next += 1;
        if (piece === undefined) controller.close();
        else controller.enqueue(piece);
      },
    });
    expect(await drain(stream)).toBe('токен ашигласан\n');
  });
});
