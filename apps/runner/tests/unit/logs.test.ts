import { describe, expect, test } from 'bun:test';
import { LogSink } from '../../src/stream/logs';

/**
 * How much a step's output costs to stream, and whether it still feels live
 * (T066, FR-076, FR-017, D9).
 *
 * Each chunk is one HTTP request from the execution service to the application
 * plus one row written. Flushing on every newline turned a step printing 2,000
 * lines into 2,000 requests and 2,000 rows, for output nobody reads a line at
 * a time.
 *
 * Three properties, in the order they outrank each other:
 *
 * 1. A credential is never split across two chunks. This is why the sink
 *    buffers at all, and it beats both of the others.
 * 2. Output after a pause goes out at once, so the log reads as live.
 * 3. A burst is coalesced, so the request count is bounded by time rather than
 *    by how chatty the step is.
 */

/** A clock a test can move, so intervals are asserted rather than waited for. */
function sinkAt(startAt = 10_000, options: { flushBytes?: number; secrets?: string[] } = {}) {
  let clock = startAt;
  const chunks: { seq: number; stream: string; text: string }[] = [];
  const sink = new LogSink({
    ...options,
    now: () => clock,
    send: (chunk) => {
      chunks.push(chunk);
    },
  });
  return { sink, chunks, advance: (ms: number) => (clock += ms) };
}

describe('a credential is never split across chunks (FR-017)', () => {
  test('a partial line is held whatever the interval says', () => {
    const { sink, chunks } = sinkAt(0, { secrets: ['glpat-secret-value'] });
    // Arriving in pieces, which is what a stream does. Emitting the first
    // piece would put `glpat-secret` into a chunk with nothing to match.
    sink.write('stdout', 'token is glpat-');
    sink.write('stdout', 'secret-');
    expect(chunks).toEqual([]);

    sink.write('stdout', 'value\n');
    sink.end();
    const everything = chunks.map((c) => c.text).join('');
    expect(everything).not.toContain('glpat-secret-value');
    expect(everything).toContain('token is');
  });
});

describe('the log still reads as live (FR-076)', () => {
  test('the first line of a step goes out immediately', () => {
    const { sink, chunks } = sinkAt();
    sink.write('stdout', 'Analysing the ticket…\n');
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.text).toBe('Analysing the ticket…\n');
  });

  test('a lone line after a pause is not delayed at all', () => {
    // The case somebody watching actually cares about: an agent that prints
    // one line, thinks, then prints another. Neither may be held.
    const { sink, chunks, advance } = sinkAt();
    sink.write('stdout', 'Reading the repository\n');
    advance(5_000);
    sink.write('stdout', 'Writing docs/spec.md\n');
    advance(5_000);
    sink.write('stdout', 'Done\n');
    expect(chunks).toHaveLength(3);
  });
});

describe('a burst becomes a handful of chunks, not a thousand', () => {
  test('lines arriving inside one interval are coalesced', () => {
    const { sink, chunks, advance } = sinkAt();
    // A test runner emitting its results as fast as it can.
    for (let line = 0; line < 200; line += 1) sink.write('stdout', `ok ${line}\n`);

    // Far fewer than 200. What is asserted is the ORDER of magnitude, not an
    // exact figure, because the exact figure depends on `flushBytes` and
    // pinning it would make this test object to a harmless tuning change.
    expect(chunks.length).toBeLessThan(20);

    // And nothing is lost: every line is present, in order.
    advance(1_000);
    sink.end();
    const everything = chunks.map((c) => c.text).join('');
    expect(everything).toContain('ok 0\n');
    expect(everything).toContain('ok 199\n');
    expect(everything.split('\n').filter(Boolean)).toHaveLength(200);
  });

  test('a burst still flushes on volume, so nothing unbounded is held', () => {
    const { sink, chunks } = sinkAt(0, { flushBytes: 256 });
    // One interval, one very chatty step. The byte threshold is what keeps
    // memory bounded when the clock says to wait.
    for (let line = 0; line < 100; line += 1) sink.write('stdout', `${'x'.repeat(60)}\n`);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      // Each chunk is roughly the threshold, not the whole burst.
      expect(chunk.text.length).toBeLessThan(256 + 61);
    }
  });

  test('what a burst leaves behind is flushed when the step ends', () => {
    // The stated wart, bounded: output accumulated inside an interval and
    // followed by silence waits for `end()`, and `end()` always comes.
    const { sink, chunks } = sinkAt();
    sink.write('stdout', 'first\n');
    const afterFirst = chunks.length;
    sink.write('stdout', 'held by the interval\n');
    expect(chunks).toHaveLength(afterFirst);

    sink.end();
    expect(chunks.map((c) => c.text).join('')).toContain('held by the interval');
  });
});

describe('sequence numbers stay contiguous', () => {
  test('every chunk is numbered from one, with no gaps', () => {
    // The application orders a log by this, so a gap would read as a lost
    // chunk and a repeat would read as duplicated output.
    const { sink, chunks, advance } = sinkAt();
    for (let i = 0; i < 20; i += 1) {
      sink.write('stdout', `line ${i}\n`);
      advance(200);
    }
    sink.write('stderr', 'a warning\n');
    sink.end();
    expect(chunks.map((c) => c.seq)).toEqual(chunks.map((_, index) => index + 1));
    expect(sink.chunksSent).toBe(chunks.length);
  });

  test('the two streams are numbered together and stay distinguishable', () => {
    const { sink, chunks, advance } = sinkAt();
    sink.write('stdout', 'out\n');
    advance(200);
    sink.write('stderr', 'err\n');
    expect(chunks.map((c) => c.stream)).toEqual(['stdout', 'stderr']);
    expect(chunks.map((c) => c.seq)).toEqual([1, 2]);
  });
});
