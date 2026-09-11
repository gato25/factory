import { beforeEach, expect, test } from 'bun:test';
import { FactoryError } from '@factory/shared';
import { runDesignStep } from '../../src/engines/design-cli';
import { checkDesignOutputs, collectDesignOutputs } from '../../src/outputs/design';
import { LogSink } from '../../src/stream/logs';
import { credentials, FakeHost, snapshot } from '../fake-host';

/**
 * FR-104 — a design step that produced no design source, or exported no
 * image at all, fails. Whatever it DID produce is retained for inspection:
 * three screens and a crash on the fourth still leaves three screens worth
 * looking at, and a reviewer who can see them can say what went wrong.
 */

const WORK = '/work';
const SOURCE = 'docs/design/ui.pen';
const EXPORTS = 'docs/design/screens';

let host: FakeHost;
const designAgent = {
  ...snapshot.agents[0]!,
  name: 'Design',
  engine: 'design_cli' as const,
  allowed_tools: [],
};

function sink() {
  const chunks: { seq: number; stream: string; text: string }[] = [];
  return {
    chunks,
    logs: new LogSink({
      send: (c) => {
        chunks.push(c);
      },
    }),
  };
}

const run = (extra: Record<string, unknown> = {}) =>
  runDesignStep(host, {
    step: { type: 'design', condition: 'always' },
    snapshot,
    agent: designAgent,
    containerId: 'c1',
    logs: sink().logs,
    ...extra,
  });

function exported(...names: string[]) {
  host.responses = [{ match: 'ls -1', result: { stdout: `${names.join('\n')}\n` } }];
}

beforeEach(() => {
  host = new FakeHost();
  host.files.set('/work/.factory/design-usage.json', '{"cost_usd":0.25,"duration_ms":30000}');
});

// --- what the check itself decides ---

test('a source and at least one image passes', async () => {
  host.files.set(`${WORK}/${SOURCE}`, '{"version":"2.17"}');
  exported('00-login.png', '01-callback.png');

  expect(await checkDesignOutputs(host, 'c1', WORK, SOURCE, EXPORTS)).toEqual({
    source: SOURCE,
    screens: [`${EXPORTS}/00-login.png`, `${EXPORTS}/01-callback.png`],
  });
});

test('no source and no image says both are missing', async () => {
  exported();
  const error = await checkDesignOutputs(host, 'c1', WORK, SOURCE, EXPORTS).catch((e) => e);
  expect(error).toBeInstanceOf(FactoryError);
  expect(error.reason).toBe('missing_output');
  expect(error.message).toContain('neither docs/design/ui.pen nor any exported screen');
});

test('images but no source says why that is not enough', async () => {
  exported('00-login.png');
  const error = await checkDesignOutputs(host, 'c1', WORK, SOURCE, EXPORTS).catch((e) => e);
  // The reason matters: without a source, FR-106's revision is impossible.
  expect(error.message).toContain('no editable design source');
  expect(error.message).toContain('nothing can revise it later');
});

test('a source but no image says why that is not enough either', async () => {
  host.files.set(`${WORK}/${SOURCE}`, '{"version":"2.17"}');
  exported();
  const error = await checkDesignOutputs(host, 'c1', WORK, SOURCE, EXPORTS).catch((e) => e);
  expect(error.message).toContain('exported no screen');
  expect(error.message).toContain('nothing for a person to review');
});

test('an empty source file is not a source', async () => {
  host.files.set(`${WORK}/${SOURCE}`, '');
  exported('00-login.png');
  const error = await checkDesignOutputs(host, 'c1', WORK, SOURCE, EXPORTS).catch((e) => e);
  expect(error.message).toContain('no editable design source');
});

test('non-images in the export directory are not screens', async () => {
  host.files.set(`${WORK}/${SOURCE}`, 'x');
  exported('notes.txt', 'README.md', '.DS_Store');
  const error = await checkDesignOutputs(host, 'c1', WORK, SOURCE, EXPORTS).catch((e) => e);
  expect(error.message).toContain('exported no screen');
});

test('png, jpg, jpeg and webp all count; screens come back in order', async () => {
  host.files.set(`${WORK}/${SOURCE}`, 'x');
  exported('02-c.webp', '00-a.png', '03-d.jpeg', '01-b.jpg', 'notes.txt');
  const outputs = await checkDesignOutputs(host, 'c1', WORK, SOURCE, EXPORTS);
  expect(outputs.screens).toEqual([
    `${EXPORTS}/00-a.png`,
    `${EXPORTS}/01-b.jpg`,
    `${EXPORTS}/02-c.webp`,
    `${EXPORTS}/03-d.jpeg`,
  ]);
});

test('an export directory that does not exist is no images, not an error', async () => {
  host.responses = [{ match: 'ls -1', result: { exitCode: 0, stdout: '' } }];
  const collected = await collectDesignOutputs(host, 'c1', WORK, SOURCE, EXPORTS);
  expect(collected).toEqual({ sourceExists: false, screens: [] });
});

// --- what the step does with that verdict: retain, then fail (FR-104) ---

test('a partial export is retained on the failed step', async () => {
  // The tool drew three screens, then died before writing the source.
  exported('00-login.png', '01-callback.png', '02-error.png');
  const outcome = await run();

  expect(outcome.status).toBe('failed');
  expect(outcome.error?.reason).toBe('missing_output');
  // All three are on the outcome, so they reach the app and can be looked at.
  expect(outcome.outputs.map((o) => o.path)).toEqual([
    `${EXPORTS}/00-login.png`,
    `${EXPORTS}/01-callback.png`,
    `${EXPORTS}/02-error.png`,
  ]);
  expect(outcome.outputs.every((o) => o.kind === 'screen')).toBe(true);
  // And what it spent is still accounted for (FR-108).
  expect(outcome.costUsd).toBe('0.2500');
});

test('a source written but nothing exported is retained too', async () => {
  host.files.set(`${WORK}/${SOURCE}`, '{"version":"2.17"}');
  exported();
  const outcome = await run();

  expect(outcome.status).toBe('failed');
  expect(outcome.outputs).toEqual([{ kind: 'design_file', path: SOURCE, version: 1 }]);
});

test('a tool that crashed keeps whatever it had drawn by then', async () => {
  host.files.set(`${WORK}/${SOURCE}`, '{"version":"2.17"}');
  host.responses = [
    { match: 'pen', result: { exitCode: 137, stderr: 'killed' } },
    { match: 'ls -1', result: { stdout: '00-login.png\n' } },
  ];
  const outcome = await run();

  expect(outcome.status).toBe('failed');
  expect(outcome.error?.reason).toBe('command_failed');
  expect(outcome.outputs.map((o) => o.path)).toEqual([SOURCE, `${EXPORTS}/00-login.png`]);
});

test('a failed design step never commits: the branch stays as it was', async () => {
  exported('00-login.png');
  await run();
  expect(host.calls.some((c) => c.argv.join(' ').includes('git commit'))).toBe(false);
});

test('a passing design step commits both the source and the screens (FR-105)', async () => {
  host.files.set(`${WORK}/${SOURCE}`, '{"version":"2.17"}');
  host.responses = [
    { match: 'ls -1', result: { stdout: '00-login.png\n' } },
    { match: 'git add', result: { stdout: 'commit9\n' } },
  ];
  const outcome = await run();

  expect(outcome.status).toBe('done');
  const script = host.calls.find((c) => c.argv.join(' ').includes('git add'))?.argv.join(' ') ?? '';
  // Asserted as arguments rather than as quoted text: whether a path needs
  // quoting is the quoting helper's business, and `shell.test.ts` proves that
  // through a real shell. What matters here is that both paths are staged.
  expect(script).toContain(`git add -- `);
  expect(script).toContain(SOURCE);
  expect(script).toContain(`${EXPORTS}/00-login.png`);
});

test('nothing about the failure leaks a credential', async () => {
  const chunks: { text: string }[] = [];
  const logs = new LogSink({
    secrets: [credentials.gitToken, credentials.modelKey],
    send: (c) => {
      chunks.push(c);
    },
  });
  host.responses = [
    {
      match: 'pen',
      result: { exitCode: 1, stderr: `auth failed for ${credentials.modelKey}` },
    },
    { match: 'ls -1', result: { stdout: '' } },
  ];
  const outcome = await runDesignStep(host, {
    step: { type: 'design', condition: 'always' },
    snapshot,
    agent: designAgent,
    containerId: 'c1',
    logs,
  });

  expect(chunks.map((c) => c.text).join('')).not.toContain(credentials.modelKey);
  // The failure detail is shown to a person, so it must be clean too.
  expect(outcome.error?.detail ?? '').not.toContain(credentials.modelKey);
});
