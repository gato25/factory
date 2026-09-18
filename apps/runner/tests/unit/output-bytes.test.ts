import { describe, expect, test } from 'bun:test';
import { FactoryError } from '@factory/shared';
import { MAX_SCREEN_BYTES, readOutputBytes } from '../../src/outputs/contents';
import { FakeHost } from '../fake-host';

/**
 * The screens a step exported.
 *
 * `artifacts` named the image and nothing carried it, so the application
 * stored a row with no picture in it, the gallery asked for an image it did
 * not have, and the person who had just paid for a design saw a broken image
 * where their screens should be. This is the other half of the gap that
 * `output-contents.test.ts` closed for text.
 */

const screen = (path: string) => ({ kind: 'screen' as const, path, version: 1 });

/** A host whose `base64` behaves like the real one, wrapping and all. */
function withImages(files: Record<string, string>) {
  const host = new FakeHost();
  for (const [path, content] of Object.entries(files)) host.files.set(path, content);
  host.exec = async (_id: string, argv: string[]) => {
    const script = argv.at(-1) ?? '';
    const found = Object.keys(files).find((path) => script.includes(path));
    if (!found) return { exitCode: 1, stdout: '', stderr: 'No such file or directory' };
    const encoded = Buffer.from(files[found] as string, 'binary').toString('base64');
    // Wrapped at 76 columns, as coreutils wraps: the reader must not depend
    // on the line breaks being there or not being there.
    const wrapped = (encoded.match(/.{1,76}/g) ?? []).join('\n');
    return { exitCode: 0, stdout: `${wrapped}\n`, stderr: '' };
  };
  return host;
}

describe('what travels', () => {
  test('an exported screen travels as bytes, not as text', async () => {
    // Bytes a UTF-8 read would not survive: `readFile` decodes, and what it
    // returns for these is no longer a PNG.
    const binary = String.fromCharCode(0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0xff, 0xfe);
    const host = withImages({ '/work/docs/design/screens/ui.png': binary });

    const images = await readOutputBytes(host, 'container-1', '/work', [
      screen('docs/design/screens/ui.png'),
    ]);
    const carried = Buffer.from(images['docs/design/screens/ui.png'] as string, 'base64');
    expect(carried.toString('binary')).toBe(binary);
  });

  test('the line breaks base64 adds do not survive into the stored image', async () => {
    const host = withImages({ '/work/a.png': 'x'.repeat(200) });
    const images = await readOutputBytes(host, 'container-1', '/work', [screen('a.png')]);
    expect(images['a.png']).not.toContain('\n');
    expect(Buffer.from(images['a.png'] as string, 'base64').toString()).toBe('x'.repeat(200));
  });

  test('a step that exported nothing carries nothing', async () => {
    expect(await readOutputBytes(new FakeHost(), 'container-1', '/work', [])).toEqual({});
  });
});

describe('what this channel is not for', () => {
  test('a document is not carried here', async () => {
    // Two channels that do not overlap: one is redacted text, this one bytes.
    const host = withImages({ '/work/docs/spec.md': '# Spec' });
    expect(
      await readOutputBytes(host, 'container-1', '/work', [
        { kind: 'document', path: 'docs/spec.md', version: 1 },
      ]),
    ).toEqual({});
  });

  test('a design source is carried by neither, because nothing renders it', async () => {
    const host = withImages({ '/work/docs/design/ui.pen': 'binary' });
    expect(
      await readOutputBytes(host, 'container-1', '/work', [
        { kind: 'design_file', path: 'docs/design/ui.pen', version: 1 },
      ]),
    ).toEqual({});
  });

  test('the kinds that are not files at all are skipped', async () => {
    expect(
      await readOutputBytes(new FakeHost(), 'container-1', '/work', [
        { kind: 'commits', path: 'commits', version: 1 },
        { kind: 'merge_request', path: 'merge_request', version: 1 },
      ]),
    ).toEqual({});
  });
});

describe('what cannot travel', () => {
  test('a screen past the ceiling is left out rather than sent', async () => {
    // Base64 adds a third on top and the whole lot rides in one callback, so
    // the ceiling is real. The artifact row is still written from the
    // manifest; only the picture is absent.
    const host = withImages({ '/work/huge.png': 'y'.repeat(MAX_SCREEN_BYTES + 1) });
    expect(await readOutputBytes(host, 'container-1', '/work', [screen('huge.png')])).toEqual({});
  });

  test('a screen at exactly the ceiling is carried', async () => {
    const host = withImages({ '/work/big.png': 'z'.repeat(MAX_SCREEN_BYTES) });
    const images = await readOutputBytes(host, 'container-1', '/work', [screen('big.png')]);
    expect(images['big.png']).toBeDefined();
  });

  test('the ceiling is roomy enough for a real screen', async () => {
    // A full page at twice scale is megabytes — the first one this produced
    // was 6.5 MB. A ceiling that refuses the ordinary case is not a ceiling,
    // it is an outage.
    expect(MAX_SCREEN_BYTES).toBeGreaterThan(8 * 1024 * 1024);
  });

  test('a screen that is not there is left out rather than stored empty', async () => {
    expect(
      await readOutputBytes(new FakeHost(), 'container-1', '/work', [screen('gone.png')]),
    ).toEqual({});
  });

  test('a sandbox that went away does not turn a finished step into a failure', async () => {
    const host = new FakeHost();
    host.files.set('/work/ui.png', 'image');
    host.exec = async () => {
      throw new FactoryError('sandbox_lost', 'the sandbox is gone');
    };
    expect(await readOutputBytes(host, 'container-1', '/work', [screen('ui.png')])).toEqual({});
  });

  test('a read that fails leaves the picture out and the step alone', async () => {
    const host = new FakeHost();
    host.files.set('/work/ui.png', 'image');
    host.exec = async () => ({ exitCode: 1, stdout: '', stderr: 'base64: not found' });
    expect(await readOutputBytes(host, 'container-1', '/work', [screen('ui.png')])).toEqual({});
  });
});
