import { describe, expect, test } from 'bun:test';
import type { ContainerSpec, ExecResult } from '../../src/container/host';
import { isolatingHost } from '../../src/container/isolate';
import {
  KIND_LABEL,
  LAUNCH_LABEL,
  labelArgs,
  launchLabels,
  OWNED_FILTER,
  OWNER,
  OWNER_LABEL,
  RUN_LABEL,
  runLabels,
  STEP_LABEL,
  stepLabels,
} from '../../src/container/labels';
import { startRunWorkspace } from '../../src/container/start';
import { credentials, FakeHost, snapshot } from '../fake-host';

/**
 * Every container this service makes says what it was made for, so one that
 * nothing accounts for any more can be found and removed (`reap.ts`).
 */

describe('what a container is marked with', () => {
  test('a run’s sandbox names the service and the run', () => {
    expect(runLabels('run-1')).toEqual({
      [OWNER_LABEL]: OWNER,
      [KIND_LABEL]: 'run',
      [RUN_LABEL]: 'run-1',
    });
  });

  test('a launch names the launch', () => {
    expect(launchLabels('launch-9')).toEqual({
      [OWNER_LABEL]: OWNER,
      [KIND_LABEL]: 'launch',
      [LAUNCH_LABEL]: 'launch-9',
    });
  });

  test('an isolated step carries its run’s labels, re-marked as a step’s', () => {
    expect(stepLabels(runLabels('run-1'), 4)).toEqual({
      [OWNER_LABEL]: OWNER,
      [KIND_LABEL]: 'step',
      [RUN_LABEL]: 'run-1',
      [STEP_LABEL]: '4',
    });
    // A spec that carries no labels still yields a container this service owns.
    expect(stepLabels(undefined)).toEqual({ [OWNER_LABEL]: OWNER, [KIND_LABEL]: 'step' });
  });

  test('labels become `--label key=value` arguments, in a stable order', () => {
    expect(labelArgs({ b: '2', a: '1' })).toEqual(['--label', 'a=1', '--label', 'b=2']);
    expect(labelArgs(undefined)).toEqual([]);
  });

  test('the filter that finds them all is the owner label', () => {
    expect(OWNED_FILTER).toBe(`label=${OWNER_LABEL}=${OWNER}`);
  });
});

describe('where the labels are applied', () => {
  test('a run’s sandbox is created with the run’s labels', async () => {
    const host = new FakeHost();
    host.files.set('/work/docs/spec.md', '# Spec');
    await startRunWorkspace(host, {
      snapshot,
      credentials,
      sandbox: {
        image: 'factory/runner:1',
        cpu: 2,
        memoryMb: 4096,
        wallClockMinutes: 60,
        networkDuringImplement: true,
      },
    });
    expect(host.created[0]?.labels).toEqual(runLabels(snapshot.run_id));
  });

  test('an isolated step’s container is labelled as the run’s step', async () => {
    const calls: { command: string; argv: string[] }[] = [];
    const exec = async (command: string, argv: string[]): Promise<ExecResult> => {
      calls.push({ command, argv });
      return { exitCode: 0, stdout: '', stderr: '' };
    };
    const base = Object.assign(new FakeHost(), { root: '/runs' }) as FakeHost & { root: string };
    const host = isolatingHost({ base, image: 'code-factory/sandbox:latest', exec: exec as never });
    const spec: ContainerSpec = {
      image: 'unused',
      cpu: 2,
      memoryMb: 4096,
      wallClockMinutes: 90,
      network: true,
      env: {},
      workdir: '/work',
      labels: runLabels('run-7'),
    };
    const id = await host.create(spec);
    await host.execIsolated?.(id, ['claude', '-p', 'x']);

    const argv = calls[0]?.argv as string[];
    const labels = argv.filter((_, i) => argv[i - 1] === '--label');
    expect(labels).toEqual([`${KIND_LABEL}=step`, `${OWNER_LABEL}=${OWNER}`, `${RUN_LABEL}=run-7`]);
  });

  test('the Docker host passes the labels, and removes a sandbox when it stops', async () => {
    // Directives read from the source, as `sandbox-images.test.ts` does for
    // the flags that must never go missing: the daemon is a boundary, and
    // this is what the daemon is told.
    const source = await Bun.file('apps/runner/src/container/host.ts').text();
    const creation = source.slice(source.indexOf("'run',"), source.indexOf("'sleep',"));
    expect(creation).toContain("'--rm'");
    expect(creation).toContain('labelArgs(spec.labels)');
  });
});
