import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FactoryError } from '@factory/shared';
import {
  GIT_CLONE_TIMEOUT_MS,
  GIT_PUSH_TIMEOUT_MS,
  GIT_READ_TIMEOUT_MS,
  GIT_STALL_ENV,
  GIT_STEP_PUSH_TIMEOUT_MS,
} from '../../src/container/git-network';
import { dockerHost, hostDeadlines } from '../../src/container/host';
import { processHost } from '../../src/container/process-host';
import { pushBranch } from '../../src/container/push';
import { buildReplacement } from '../../src/container/recover';
import { branchExistsRemotely, resetRunBranch } from '../../src/container/reset';
import { cloneRepository } from '../../src/container/start';
import { OUTPUT_LIMIT_EXIT_CODE, TIMEOUT_EXIT_CODE } from '../../src/engines/limits';
import { runShellStep } from '../../src/engines/shell';
import { LogSink } from '../../src/stream/logs';
import { credentials, type ExecCall, FakeHost, snapshot } from '../fake-host';

/**
 * Nothing waits for ever.
 *
 * `git clone`, `git push`, `git fetch`, a shell step's command and every file
 * read through the container daemon were run with no deadline, so a repository
 * host that accepted a connection and then said nothing — or a daemon that
 * stopped answering — held the run until the sandbox's own lifetime ended it,
 * ninety minutes later by default. The host-outage handling only helps when a
 * call FAILS; a call that hangs never does. So each has a deadline, and the
 * deadline is what turns a hang into a failure the rest of the runner already
 * knows how to handle.
 */

const sandbox = {
  image: 'factory/runner:1',
  cpu: 2,
  memoryMb: 4096,
  wallClockMinutes: 60,
  networkDuringImplement: true,
};

let host: FakeHost;
beforeEach(() => {
  host = new FakeHost();
});

/** The call whose command line contains `fragment`. */
const callTo = (fragment: string): ExecCall | undefined =>
  host.calls.find((call) => call.argv.join(' ').includes(fragment));

describe('git commands that cross the network', () => {
  test('a clone has a deadline, and git is told to give up on a stalled transfer', async () => {
    await cloneRepository(host, 'container-1', snapshot, 'token');
    const clone = callTo('git clone');
    expect(clone?.options?.timeoutMs).toBe(GIT_CLONE_TIMEOUT_MS);
    expect(clone?.options?.env).toMatchObject(GIT_STALL_ENV);
    // The credential still travels the same way it always did.
    expect(clone?.options?.env?.GIT_TOKEN).toBe('token');
  });

  test('a clone that hits its deadline says so, and is not the sandbox’s fault', async () => {
    host.responses.push({
      match: 'git clone',
      result: { exitCode: TIMEOUT_EXIT_CODE, stderr: 'stopped after 900000ms' },
    });
    let thrown: unknown;
    try {
      await cloneRepository(host, 'container-1', snapshot, 'token');
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(FactoryError);
    // Not `sandbox_lost`: a replacement sandbox would clone from the same
    // host, and be given the same quarter of an hour, three times over.
    expect((thrown as FactoryError).reason).toBe('command_failed');
    expect((thrown as FactoryError).message).toContain(snapshot.repo.clone_url);
    expect((thrown as FactoryError).message).toContain('did not finish within 15 minutes');
  });

  test('a clone that fails any other way is still a sandbox problem, as before', async () => {
    host.responses.push({
      match: 'git clone',
      result: { exitCode: 128, stderr: 'fatal: unable to access' },
    });
    await expect(cloneRepository(host, 'container-1', snapshot, 'token')).rejects.toMatchObject({
      reason: 'sandbox_lost',
    });
  });

  test('the push that ends a run has ten minutes; the one after each step has three', async () => {
    await pushBranch(host, 'container-1', snapshot, 'token');
    expect(callTo('git push')?.options?.timeoutMs).toBe(GIT_PUSH_TIMEOUT_MS);
    expect(callTo('git push')?.options?.env).toMatchObject(GIT_STALL_ENV);

    host.calls.length = 0;
    await pushBranch(host, 'container-1', snapshot, 'token', {
      timeoutMs: GIT_STEP_PUSH_TIMEOUT_MS,
    });
    expect(callTo('git push')?.options?.timeoutMs).toBe(GIT_STEP_PUSH_TIMEOUT_MS);
    expect(GIT_STEP_PUSH_TIMEOUT_MS).toBeLessThan(GIT_PUSH_TIMEOUT_MS);
  });

  test('a push that hits its deadline reports the host, not a rejected token', async () => {
    host.responses.push({
      match: 'git push',
      result: { exitCode: TIMEOUT_EXIT_CODE, stderr: 'stopped after 600000ms' },
    });
    const outcome = await pushBranch(host, 'container-1', snapshot, 'token');
    expect(outcome.pushed).toBe(false);
    if (!outcome.pushed) {
      expect(outcome.reason).toContain('did not finish receiving the branch within 10 minutes');
    }
  });

  test('looking at what the remote has is bounded too', async () => {
    await pushBranch(host, 'container-1', snapshot, 'token', { force: true });
    expect(callTo('ls-remote')?.options?.timeoutMs).toBe(GIT_READ_TIMEOUT_MS);

    host.calls.length = 0;
    await branchExistsRemotely(host, 'container-1', snapshot, 'token');
    expect(callTo('ls-remote')?.options?.timeoutMs).toBe(GIT_READ_TIMEOUT_MS);

    host.calls.length = 0;
    await resetRunBranch(host, 'container-1', snapshot, 'token');
    expect(callTo('git fetch')?.options?.timeoutMs).toBe(GIT_READ_TIMEOUT_MS);
  });

  test('a replacement sandbox’s fetch of the run branch is bounded', async () => {
    await buildReplacement(host, { snapshot, credentials, sandbox });
    // The clone's own script fetches the branch too; that call has the clone's deadline.
    const fetched = host.calls.filter((call) => {
      const command = call.argv.join(' ');
      return command.includes('git fetch') && !command.includes('git clone');
    });
    expect(fetched.length).toBeGreaterThan(0);
    for (const call of fetched) expect(call.options?.timeoutMs).toBe(GIT_READ_TIMEOUT_MS);
  });
});

describe('a shell step, which is where the tests run', () => {
  const step = { type: 'shell' as const, condition: 'always' as const, command: 'bun test' };
  const sink = () => new LogSink({ send: () => {} });

  test('is held to the run’s time ceiling', async () => {
    await runShellStep(host, {
      step,
      containerId: 'container-1',
      logs: sink(),
      ceilingMinutes: 45,
    });
    expect(callTo('bun test')?.options?.timeoutMs).toBe(45 * 60_000);
  });

  test('that hits it fails as a time limit, in words, and not as "exited 124"', async () => {
    host.responses.push({
      match: 'bun test',
      result: { exitCode: TIMEOUT_EXIT_CODE, stderr: 'stopped after 2700000ms' },
    });
    const outcome = await runShellStep(host, {
      step,
      containerId: 'container-1',
      logs: sink(),
      ceilingMinutes: 45,
    });
    expect(outcome.status).toBe('failed');
    expect(outcome.error?.reason).toBe('time_exceeded');
    expect(outcome.error?.detail).toContain('was stopped after 45 minutes');
    expect(outcome.error?.detail).not.toContain('124');
  });

  test('that printed without end fails saying it was stopped, with what the host said', async () => {
    host.responses.push({
      match: 'bun test',
      result: {
        exitCode: OUTPUT_LIMIT_EXIT_CODE,
        stderr: 'stopped after printing more than 256.0 MB of output',
      },
    });
    const outcome = await runShellStep(host, {
      step,
      containerId: 'container-1',
      logs: sink(),
      ceilingMinutes: 45,
    });
    expect(outcome.status).toBe('failed');
    expect(outcome.error?.reason).toBe('command_failed');
    expect(outcome.error?.detail).toContain('was stopped');
    expect(outcome.error?.detail).toContain('256.0 MB');
  });

  test('an ordinary failure is reported as it always was', async () => {
    host.responses.push({ match: 'bun test', result: { exitCode: 1, stderr: '1 test failed' } });
    const outcome = await runShellStep(host, {
      step,
      containerId: 'container-1',
      logs: sink(),
      ceilingMinutes: 45,
    });
    expect(outcome.error?.reason).toBe('command_failed');
    expect(outcome.error?.detail).toContain('exited 1');
  });
});

/**
 * A daemon that has stopped answering: a `docker` that accepts every command
 * and never finishes it. Put first on the PATH, so the host's own calls reach
 * it exactly as they would reach the real one.
 */
describe.skipIf(process.platform === 'win32')('a container daemon that never answers', () => {
  const original = { ...hostDeadlines };
  const originalPath = process.env.PATH;
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'stuck-docker-'));
    await writeFile(join(directory, 'docker'), '#!/bin/sh\nexec sleep 30\n');
    await chmod(join(directory, 'docker'), 0o755);
    process.env.PATH = `${directory}:${originalPath}`;
    // Short, so the test does not wait a minute to see a minute's deadline.
    hostDeadlines.command = 300;
    hostDeadlines.file = 300;
    hostDeadlines.exec = 300;
  });
  afterEach(async () => {
    process.env.PATH = originalPath;
    Object.assign(hostDeadlines, original);
    await rm(directory, { recursive: true, force: true });
  });

  test('reading a file is a lost sandbox, so the run waits for the host, not for ever', async () => {
    const started = Date.now();
    await expect(dockerHost.readFile('c1', '/work/docs/spec.md')).rejects.toMatchObject({
      reason: 'sandbox_lost',
    });
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  test('writing a file is a lost sandbox too', async () => {
    const started = Date.now();
    await expect(dockerHost.writeFile('c1', '/work/x.md', 'text')).rejects.toMatchObject({
      reason: 'sandbox_lost',
    });
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  test('looking for a file is not "the file is not there"', async () => {
    await expect(dockerHost.stat('c1', '/work/docs/spec.md')).rejects.toMatchObject({
      reason: 'sandbox_lost',
    });
  });

  test('asking for a published port gets no address, not a wait', async () => {
    const started = Date.now();
    expect(await dockerHost.address('c1', 3000)).toBeNull();
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  test('a command that named no deadline gets the default one', async () => {
    const result = await dockerHost.exec('c1', ['true']);
    expect(result.exitCode).toBe(TIMEOUT_EXIT_CODE);
  });

  test('a command that named its own keeps it', async () => {
    hostDeadlines.exec = 60_000;
    const started = Date.now();
    const result = await dockerHost.exec('c1', ['true'], { timeoutMs: 300 });
    expect(result.exitCode).toBe(TIMEOUT_EXIT_CODE);
    expect(Date.now() - started).toBeLessThan(5_000);
  });
});

describe('processes on this machine', () => {
  const original = { ...hostDeadlines };
  afterEach(() => Object.assign(hostDeadlines, original));

  test('a command that named no deadline gets the default one', async () => {
    const root = await mkdtemp(join(tmpdir(), 'process-deadline-'));
    const process_ = processHost({ root });
    const id = await process_.create({ ...sandbox, network: true, env: {}, workdir: '/work' });
    try {
      hostDeadlines.exec = 300;
      const started = Date.now();
      const result = await process_.exec(id, ['sleep', '30']);
      expect(result.exitCode).toBe(TIMEOUT_EXIT_CODE);
      expect(Date.now() - started).toBeLessThan(5_000);
    } finally {
      await process_.destroy(id);
      await rm(root, { recursive: true, force: true });
    }
  });
});
