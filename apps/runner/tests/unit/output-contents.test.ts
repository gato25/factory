import { describe, expect, test } from 'bun:test';
import { createRedactor, FactoryError } from '@factory/shared';
import { MAX_DOCUMENT_BYTES, readOutputContents } from '../../src/outputs/contents';
import { FakeHost } from '../fake-host';

/**
 * The text of the documents a step produced.
 *
 * Without this the application received a manifest and stored rows with
 * nothing in them: a checkpoint with nothing to review, and a merge request
 * whose Specification section would have been empty.
 */

const plain = (text: string) => text;
const document = (path: string) => ({ kind: 'document' as const, path, version: 1 });

describe('what travels', () => {
  test('a document is read from the workspace, by the path the outcome names', async () => {
    const host = new FakeHost();
    host.files.set('/work/docs/spec.md', '# Spec\n\nThe ticket asks for two things.');
    host.files.set('/work/docs/plan.md', '# Plan\n\nThree files change.');

    const contents = await readOutputContents(
      host,
      'container-1',
      '/work',
      [document('docs/spec.md'), document('docs/plan.md')],
      plain,
    );
    expect(contents).toEqual({
      'docs/spec.md': '# Spec\n\nThe ticket asks for two things.',
      'docs/plan.md': '# Plan\n\nThree files change.',
    });
  });

  test('a screen and a design source are left out: they are binary, not text', async () => {
    // The same gap, and they need a way to read bytes out of a sandbox —
    // separate work. Reading a PNG as text would store something worse than
    // nothing: a row that looks filled and is corrupt.
    const host = new FakeHost();
    host.files.set('/work/docs/design/ui.pen', 'not really a pen file');
    host.files.set('/work/docs/design/screens/01-sign-in.png', 'not really a png');
    const contents = await readOutputContents(
      host,
      'container-1',
      '/work',
      [
        { kind: 'design_file', path: 'docs/design/ui.pen', version: 1 },
        { kind: 'screen', path: 'docs/design/screens/01-sign-in.png', version: 1 },
        { kind: 'commits', path: 'commits', version: 1 },
        { kind: 'merge_request', path: 'merge_request', version: 1 },
      ],
      plain,
    );
    expect(contents).toEqual({});
  });

  test('a step that produced nothing carries nothing', async () => {
    expect(await readOutputContents(new FakeHost(), 'container-1', '/work', [], plain)).toEqual({});
  });
});

describe('a credential never reaches a stored document (Principle V, FR-084)', () => {
  test('the text is redacted where it is read, not where it is shown', async () => {
    const host = new FakeHost();
    host.files.set(
      '/work/docs/spec.md',
      '# Spec\n\nThe deploy uses glpat-abcdefghijklmnop1234 as its token.',
    );
    const contents = await readOutputContents(
      host,
      'container-1',
      '/work',
      [document('docs/spec.md')],
      createRedactor(['glpat-abcdefghijklmnop1234']),
    );
    expect(contents['docs/spec.md']).not.toContain('glpat-abcdefghijklmnop1234');
    expect(contents['docs/spec.md']).toContain('[redacted]');
    expect(contents['docs/spec.md']).toContain('# Spec');
  });
});

describe('what cannot travel whole', () => {
  test('a document larger than the cap is cut, and says it was cut', async () => {
    const host = new FakeHost();
    const huge = `${'x'.repeat(MAX_DOCUMENT_BYTES + 5_000)}\nTHE END`;
    host.files.set('/work/docs/plan.md', huge);

    const contents = await readOutputContents(
      host,
      'container-1',
      '/work',
      [document('docs/plan.md')],
      plain,
    );
    const carried = contents['docs/plan.md'] as string;
    // The beginning is there, the end is not, and the note is what stops the
    // beginning being read as the whole.
    expect(carried.startsWith('xxxx')).toBe(true);
    expect(carried).not.toContain('THE END');
    expect(carried).toContain('bytes; the first');
    expect(carried).toContain("on the run's branch");
  });

  test('a document at exactly the cap is carried whole', async () => {
    const host = new FakeHost();
    host.files.set('/work/docs/plan.md', 'y'.repeat(MAX_DOCUMENT_BYTES));
    const contents = await readOutputContents(
      host,
      'container-1',
      '/work',
      [document('docs/plan.md')],
      plain,
    );
    expect(contents['docs/plan.md']).toBe('y'.repeat(MAX_DOCUMENT_BYTES));
  });
});

describe('when the document cannot be read', () => {
  test('a file that is not there is left out rather than stored empty', async () => {
    const contents = await readOutputContents(
      new FakeHost(),
      'container-1',
      '/work',
      [document('docs/spec.md')],
      plain,
    );
    expect(contents).toEqual({});
  });

  test('a sandbox that went away does not turn a finished step into a failure', async () => {
    // The step is done and its outcome is what matters; the document is
    // reported without its text.
    const host = new FakeHost();
    host.readFile = async () => {
      throw new FactoryError('sandbox_lost', 'the sandbox is gone');
    };
    const contents = await readOutputContents(
      host,
      'container-1',
      '/work',
      [document('docs/spec.md')],
      plain,
    );
    expect(contents).toEqual({});
  });
});
