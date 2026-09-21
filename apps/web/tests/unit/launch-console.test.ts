import { describe, expect, test } from 'bun:test';
import {
  launchBlocker,
  normalisePath,
  parseHeaderLines,
  readUpTo,
} from '../../src/lib/services/launch';
import { m } from '../../src/lib/i18n';

/**
 * The parts of a launch the application decides on its own (003 FR-003,
 * FR-014): when Run it may be pressed, and how a typed request becomes one.
 */

describe('when Run it is available (FR-003)', () => {
  test('a finished ticket with a branch', () => {
    expect(launchBlocker({ status: 'done', branchName: 'factory/142-x' })).toBeNull();
  });

  // The reasons come from the catalogue, so this asserts which reason each
  // status gets rather than restating the interface's language.
  test.each([
    ['running', m.launch.afterPush],
    ['queued', m.launch.afterPush],
    ['waiting_approval', m.launch.atCheckpoint],
    ['failed', m.launch.didNotFinish],
    ['draft', m.launch.afterAnyRun],
  ])('a %s ticket says why not', (status, phrase) => {
    expect(launchBlocker({ status, branchName: 'factory/1-x' })).toBe(phrase);
  });

  test('no branch is the first reason, whatever the status', () => {
    expect(launchBlocker({ status: 'done', branchName: null })).toBe(m.launch.noBranchYet);
  });
});

describe('the request console', () => {
  test('headers are one per line, forgiving of spacing and blanks', () => {
    expect(parseHeaderLines('Accept: application/json\n\n  X-Debug :1  \nnonsense\n')).toEqual({
      Accept: 'application/json',
      'X-Debug': '1',
    });
  });

  test('a Host header is dropped, so the console cannot pose as another site', () => {
    expect(parseHeaderLines('Host: evil.example\nAccept: */*')).toEqual({ Accept: '*/*' });
  });

  test('a path is made absolute, and a full address is refused', () => {
    expect(normalisePath('api/items')).toBe('/api/items');
    expect(normalisePath('  ')).toBe('/');
    expect(normalisePath('/a?b=c')).toBe('/a?b=c');
    // The console sends to the launch and nowhere else: a URL here would turn
    // the application into an open proxy.
    expect(() => normalisePath('https://example.com/x')).toThrow(m.form.pathNotAddress);
    expect(() => normalisePath('//example.com/x')).toThrow();
  });
});

describe('reading a response body up to the cap', () => {
  const streamOf = (...chunks: number[]) =>
    new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          for (const size of chunks) controller.enqueue(new Uint8Array(size).fill(1));
          controller.close();
        },
      }),
    );

  test('a short body comes back whole', async () => {
    const { bytes, truncated } = await readUpTo(streamOf(100, 50), 250);
    expect(bytes.length).toBe(150);
    expect(truncated).toBe(false);
  });

  test('a long body stops at the cap, mid-chunk, and says so', async () => {
    const { bytes, truncated } = await readUpTo(streamOf(100, 100, 100, 100), 250);
    expect(bytes.length).toBe(250);
    expect(truncated).toBe(true);
  });

  test('a body of exactly the cap is not truncated', async () => {
    const { bytes, truncated } = await readUpTo(streamOf(250), 250);
    expect(bytes.length).toBe(250);
    expect(truncated).toBe(false);
  });

  test('no body is no bytes', async () => {
    const { bytes, truncated } = await readUpTo(new Response(null, { status: 204 }), 250);
    expect(bytes.length).toBe(0);
    expect(truncated).toBe(false);
  });
});
