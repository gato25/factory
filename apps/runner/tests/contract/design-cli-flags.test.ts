import { describe, expect, test } from 'bun:test';
import type { PipelineSnapshot, SnapshotAgent, Step } from '@factory/shared';
import { run } from '../../src/container/host';
import { buildDesignArgv } from '../../src/engines/design-cli';
import { LogSink } from '../../src/stream/logs';
import { snapshot } from '../fake-host';

/**
 * Every flag the design step passes is a flag the tool has.
 *
 * This is the test that was missing. The step was written against a `create`
 * subcommand taking `--source`, `--export-dir`, `--brief` and `--screens`,
 * none of which the pen.dev CLI has ever had, and every design step died on
 * its first line with "--out or --export is required". Nothing caught it,
 * because the only tests were of this function's output against this
 * function's own expectations, through a stand-in host. Those tests pass
 * whatever we invent.
 *
 * So this one asks the tool. It reads `pen --help`, which needs no
 * credential and no network, and checks that each flag we send appears
 * there. It cannot prove the tool does what we mean by a flag; it does
 * prove we are not inventing flags, which is the mistake that was made.
 *
 * Skipped with a reason where the CLI is not installed, so a developer
 * without it still has a working suite.
 */

const help = await run('pen', ['--help'], { timeoutMs: 20_000 })
  .then((probe) => (probe.exitCode === 0 ? `${probe.stdout}\n${probe.stderr}` : null))
  .catch(() => null);

const step: Step = {
  ...(snapshot.pipeline.steps[0] as Step),
  type: 'design',
  design: {
    source_path: 'docs/design/ui.pen',
    export_dir: 'docs/design/screens',
    export_scale: 2,
  },
};

const input = {
  step,
  snapshot: snapshot as PipelineSnapshot,
  agent: snapshot.agents[0] as SnapshotAgent,
  containerId: 'c1',
  logs: new LogSink({ send: () => {} }),
};

/** The `--flags` in an argv, without their values. */
const flagsIn = (argv: string[]): string[] => argv.filter((token) => token.startsWith('--'));

describe.skipIf(help === null)('the flags the design step sends', () => {
  test('a first run passes only flags the tool documents', () => {
    for (const flag of flagsIn(buildDesignArgv(input, false))) {
      expect(help as string).toContain(flag);
    }
  });

  test('a revision passes only flags the tool documents', () => {
    for (const flag of flagsIn(buildDesignArgv(input, true))) {
      expect(help as string).toContain(flag);
    }
  });

  test('the two the tool requires are both there', () => {
    // Its own refusal names these: "--out or --export is required", and
    // `--prompt` is required alongside them.
    const argv = buildDesignArgv(input, false);
    expect(argv).toContain('--out');
    expect(argv).toContain('--prompt');
  });

  test('the flags it never had are gone', () => {
    const argv = buildDesignArgv(input, false).join(' ');
    for (const invented of ['--source', '--export-dir', '--brief', '--screens']) {
      expect(argv).not.toContain(invented);
    }
    // And no subcommand: the tool takes flags directly.
    expect(buildDesignArgv(input, false)[1]?.startsWith('--')).toBe(true);
  });
});

if (help === null) {
  test.skip('the design tool is not installed here, so its flags were not checked', () => {});
}
