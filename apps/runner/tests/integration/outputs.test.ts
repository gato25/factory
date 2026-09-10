import { expect, test } from 'bun:test';
import { checkDesignOutputs, checkRequiredOutputs } from '../../src/outputs/check';
import { FakeHost } from '../fake-host';

test('a declared output that exists and has content passes (FR-051)', async () => {
  const host = new FakeHost();
  host.files.set('/work/docs/spec.md', '# Spec\n\nSomething real.');
  await expect(
    checkRequiredOutputs(host, 'c1', '/work', ['docs/spec.md']),
  ).resolves.toBeUndefined();
});

test('a MISSING declared output fails the step, naming the file (FR-051)', async () => {
  const host = new FakeHost();
  await expect(checkRequiredOutputs(host, 'c1', '/work', ['docs/spec.md'])).rejects.toThrow(
    /did not produce docs\/spec\.md/,
  );
});

test('an EMPTY declared output fails too — producing it is not enough (FR-051)', async () => {
  const host = new FakeHost();
  host.files.set('/work/docs/spec.md', '');
  await expect(checkRequiredOutputs(host, 'c1', '/work', ['docs/spec.md'])).rejects.toThrow(
    /left docs\/spec\.md empty/,
  );
});

test('missing and empty are reported together, so one round names both', async () => {
  const host = new FakeHost();
  host.files.set('/work/docs/plan.md', '');
  await expect(
    checkRequiredOutputs(host, 'c1', '/work', ['docs/spec.md', 'docs/plan.md']),
  ).rejects.toThrow(/did not produce docs\/spec\.md and left docs\/plan\.md empty/);
});

test('a step declaring no outputs passes trivially', async () => {
  const host = new FakeHost();
  await expect(checkRequiredOutputs(host, 'c1', '/work', [])).resolves.toBeUndefined();
});

// --- design outputs (FR-104) ---

test('a design step needs a source AND at least one image', async () => {
  const host = new FakeHost();
  host.files.set('/work/docs/design/ui.pen', '{"version":"2.17"}');
  host.responses = [{ match: 'ls -1', result: { stdout: '00-login.png\n01-callback.png\n' } }];
  const images = await checkDesignOutputs(
    host,
    'c1',
    '/work',
    'docs/design/ui.pen',
    'docs/design/screens',
  );
  expect(images).toEqual(['00-login.png', '01-callback.png']);
});

test('a design step with a source but no image fails (FR-104)', async () => {
  const host = new FakeHost();
  host.files.set('/work/docs/design/ui.pen', '{"version":"2.17"}');
  host.responses = [{ match: 'ls -1', result: { stdout: '' } }];
  await expect(
    checkDesignOutputs(host, 'c1', '/work', 'docs/design/ui.pen', 'docs/design/screens'),
  ).rejects.toThrow(/exported no images/);
});

test('a design step with images but no source fails (FR-104)', async () => {
  const host = new FakeHost();
  host.responses = [{ match: 'ls -1', result: { stdout: '00-login.png\n' } }];
  await expect(
    checkDesignOutputs(host, 'c1', '/work', 'docs/design/ui.pen', 'docs/design/screens'),
  ).rejects.toThrow(/did not produce docs\/design\/ui\.pen/);
});

test('non-image files in the export directory are not counted as screens', async () => {
  const host = new FakeHost();
  host.files.set('/work/docs/design/ui.pen', 'x');
  host.responses = [{ match: 'ls -1', result: { stdout: 'notes.txt\nREADME.md\n' } }];
  await expect(
    checkDesignOutputs(host, 'c1', '/work', 'docs/design/ui.pen', 'docs/design/screens'),
  ).rejects.toThrow(/exported no images/);
});
