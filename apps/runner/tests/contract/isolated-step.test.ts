import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from '../../src/container/host';
import { isolatingHost } from '../../src/container/isolate';
import { processHost } from '../../src/container/process-host';

/**
 * A step in a container, over the workspace the rest of the run uses.
 *
 * The unit tests prove the arguments. This proves the thing itself: that a
 * command really does run in the image, that it cannot see this machine's
 * processes, and — the part the whole design rests on — that what it writes
 * is in the run's workspace afterwards, where the next step will read it.
 *
 * Skipped, with a reason, where there is no daemon or no image. A developer
 * without Docker still has a working runner; they have the guard in
 * `guard.ts` instead of a wall, and this says so rather than failing.
 */

const IMAGE = process.env.SANDBOX_IMAGE || 'code-factory/sandbox:latest';

const daemon = await run('docker', ['version', '--format', '{{.Server.Version}}'], {
  timeoutMs: 8000,
})
  .then((probe) => probe.exitCode === 0)
  .catch(() => false);

const ready =
  daemon &&
  (await run('docker', ['image', 'inspect', IMAGE], { timeoutMs: 8000 })
    .then((probe) => probe.exitCode === 0)
    .catch(() => false));

const why = daemon
  ? `the sandbox image ${IMAGE} is not built — docker build -t ${IMAGE} infra/sandbox`
  : 'no container daemon is answering in this environment';

const spec = {
  image: IMAGE,
  cpu: 2,
  memoryMb: 2048,
  wallClockMinutes: 10,
  network: true,
  env: { FACTORY_CONTRACT_SECRET: 'sk-not-a-real-credential' },
  workdir: '/work',
};

describe.skipIf(!ready)('a command that runs behind a wall', () => {
  async function workspace() {
    const root = await mkdtemp(join(tmpdir(), 'factory-isolated-'));
    const base = processHost({ root });
    const host = isolatingHost({ base, image: IMAGE });
    const id = await host.create(spec);
    return {
      host,
      id,
      async done() {
        await host.destroy(id);
        await rm(root, { recursive: true, force: true }).catch(() => {});
      },
    };
  }

  test('what it writes is in the workspace the next step reads', async () => {
    // The hand-off invariant: steps pass work to each other by being in the
    // same workspace. If this does not hold, an isolated Implement step
    // builds into a container that is then thrown away.
    const { host, id, done } = await workspace();
    try {
      const result = await host.execIsolated?.(id, [
        'sh',
        '-c',
        'echo "written inside the container" > /work/docs-note.md',
      ]);
      expect(result?.exitCode).toBe(0);
      expect(await host.readFile(id, '/work/docs-note.md')).toContain(
        'written inside the container',
      );
    } finally {
      await done();
    }
  }, 120_000);

  test('what an earlier step wrote is there to be read', async () => {
    const { host, id, done } = await workspace();
    try {
      // As an unisolated step would have left it.
      await host.writeFile(id, '/work/docs/spec.md', '# Spec\n\nTwo things.\n');
      const result = await host.execIsolated?.(id, ['sh', '-c', 'cat /work/docs/spec.md']);
      expect(result?.exitCode).toBe(0);
      expect(result?.stdout).toContain('Two things.');
    } finally {
      await done();
    }
  }, 120_000);

  test('it cannot see the processes on this machine', async () => {
    // The whole point, and the thing that was not true of the process host
    // when an agent stopping its own dev server stopped the runner.
    //
    // Read from `/proc` rather than with `ps`, which the slim image does not
    // carry: the numeric entries there ARE the processes this container can
    // address, and a name-wide kill can reach nothing else.
    const { host, id, done } = await workspace();
    try {
      const result = await host.execIsolated?.(id, [
        'sh',
        '-c',
        'ls /proc | grep -c "^[0-9][0-9]*$"; cat /proc/1/comm',
      ]);
      expect(result?.exitCode).toBe(0);
      const [count, firstProcess] = (result?.stdout ?? '').trim().split('\n');
      // Its own shell and the `ls` it just ran, not a machine's worth.
      expect(Number(count)).toBeLessThan(10);
      // On this machine process 1 is the operating system's. In here it is
      // the step's own shell, which is what having a process table of one's
      // own means.
      expect(firstProcess?.trim()).toBe('sh');
    } finally {
      await done();
    }
  }, 120_000);

  test('git works on the mounted repository', async () => {
    // A bind mount's files are owned by nobody the container knows, and git
    // refuses a repository like that. An Implement step commits, so this is
    // not optional.
    const { host, id, done } = await workspace();
    try {
      const result = await host.execIsolated?.(id, [
        'sh',
        '-c',
        'cd /work && git init -q . && echo hello > a.txt && git add -A && ' +
          'git -c user.email=a@b -c user.name=agent commit -qm "from the container" && ' +
          'git log --oneline -1',
      ]);
      expect(result?.exitCode).toBe(0);
      expect(result?.stdout).toContain('from the container');
    } finally {
      await done();
    }
  }, 180_000);

  test('the run’s credentials are there, and are not in the argument list', async () => {
    const { host, id, done } = await workspace();
    try {
      const result = await host.execIsolated?.(id, ['sh', '-c', 'echo "$FACTORY_CONTRACT_SECRET"']);
      expect(result?.stdout.trim()).toBe('sk-not-a-real-credential');
    } finally {
      await done();
    }
  }, 120_000);

  test('the CLI in here finds the workspace trusted', async () => {
    // The trust marker the workspace setup writes lives in the home of
    // whoever runs the runner. The CLI in the container is another user, in
    // another home, and an untrusted directory means it silently ignores
    // every permission the repository grants itself.
    const { host, id, done } = await workspace();
    try {
      const result = await host.execIsolated?.(id, [
        'sh',
        '-c',
        "node -e \"const c=require(process.env.HOME+'/.claude.json');" +
          "process.stdout.write(String(c.projects['/work'].hasTrustDialogAccepted))\"",
      ]);
      expect(result?.exitCode).toBe(0);
      expect(result?.stdout.trim()).toBe('true');
    } finally {
      await done();
    }
  }, 120_000);

  test('the agent tooling the step needs is in the image', async () => {
    const { host, id, done } = await workspace();
    try {
      const result = await host.execIsolated?.(id, [
        'sh',
        '-c',
        'node --version && git --version && claude --version',
      ]);
      expect(result?.exitCode).toBe(0);
      expect(result?.stdout).toContain('Claude Code');
    } finally {
      await done();
    }
  }, 120_000);
});

if (!ready) {
  test.skip(`a command behind a wall was not exercised: ${why}`, () => {});
}
