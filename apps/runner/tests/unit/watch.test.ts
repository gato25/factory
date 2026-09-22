import { describe, expect, test } from 'bun:test';
import { type HostProbe, watchContainerHost } from '../../src/container/watch';

/**
 * The container host is asked again and again, and each CHANGE is said once.
 *
 * A daemon probed at startup and then assumed was discovered missing by the
 * next step, as a sentence about the sandbox; nothing said when it went away
 * or came back.
 */

function harness(answers: HostProbe[]) {
  const lines: { level: string; message: string; fields?: Record<string, unknown> }[] = [];
  let clock = Date.parse('2026-09-22T12:00:00.000Z');
  let index = 0;
  const watch = watchContainerHost({
    probe: async () => {
      const answer = answers[Math.min(index, answers.length - 1)] as HostProbe;
      index += 1;
      return answer;
    },
    intervalMs: 30_000,
    consequence: 'no sandbox can be created until it answers',
    log: {
      info: (message, fields) => lines.push({ level: 'info', message, fields }),
      error: (message, fields) => lines.push({ level: 'error', message, fields }),
    },
    now: () => clock,
  });
  const tick = (ms: number) => {
    clock += ms;
  };
  return { watch, lines, tick };
}

const up: HostProbe = { reachable: true, detail: 'docker 29.3.1' };
const down: HostProbe = { reachable: false, detail: 'the container host is not answering' };

describe('watching the container host', () => {
  test('nothing is said while the host keeps answering', async () => {
    const { watch, lines, tick } = harness([up, up, up]);
    expect(watch.current()).toBeUndefined();
    await watch.check();
    tick(30_000);
    await watch.check();
    tick(30_000);
    await watch.check();
    expect(lines).toEqual([]);
    expect(watch.current()).toMatchObject({ reachable: true, detail: 'docker 29.3.1' });
    // Reachable since the first probe, checked at the last.
    expect(watch.current()?.since).toBe('2026-09-22T12:00:00.000Z');
    expect(watch.current()?.checkedAt).toBe('2026-09-22T12:01:00.000Z');
  });

  test('a host that stops answering is said once, with what that means', async () => {
    const { watch, lines, tick } = harness([up, down, down, down]);
    await watch.check();
    tick(30_000);
    await watch.check();
    tick(30_000);
    await watch.check();
    tick(30_000);
    await watch.check();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      level: 'error',
      message: 'the container host is not answering',
      fields: {
        detail: 'the container host is not answering',
        consequence: 'no sandbox can be created until it answers',
        answered_since: '2026-09-22T12:00:00.000Z',
      },
    });
    expect(watch.current()).toMatchObject({ reachable: false, since: '2026-09-22T12:00:30.000Z' });
  });

  test('a host that answers again is said once, with how long it was gone', async () => {
    const { watch, lines, tick } = harness([up, down, down, up, up]);
    for (let i = 0; i < 5; i += 1) {
      await watch.check();
      tick(30_000);
    }
    expect(lines.map((l) => l.message)).toEqual([
      'the container host is not answering',
      'the container host is answering again',
    ]);
    // Unreachable from the second probe (12:00:30) until the fourth (12:01:30).
    expect(lines[1]?.fields).toMatchObject({ unreachable_for_ms: 60_000 });
  });

  test('a host that is not answering at the first probe is said too', async () => {
    const { watch, lines } = harness([down]);
    await watch.check();
    expect(lines).toHaveLength(1);
    expect(lines[0]?.fields).not.toHaveProperty('answered_since');
  });

  test('a probe that throws counts as not answering, with its message', async () => {
    const lines: string[] = [];
    const watch = watchContainerHost({
      probe: async () => {
        throw new Error('spawn docker ENOENT');
      },
      intervalMs: 30_000,
      consequence: 'x',
      log: { info: () => {}, error: (message) => lines.push(message) },
    });
    const status = await watch.check();
    expect(status.reachable).toBe(false);
    expect(status.detail).toBe('spawn docker ENOENT');
    expect(lines).toEqual(['the container host is not answering']);
  });

  test('concurrent checks share one probe', async () => {
    let probes = 0;
    const watch = watchContainerHost({
      probe: async () => {
        probes += 1;
        await new Promise((resolve) => setTimeout(resolve, 5));
        return up;
      },
      intervalMs: 30_000,
      consequence: 'x',
      log: { info: () => {}, error: () => {} },
    });
    await Promise.all([watch.check(), watch.check(), watch.check()]);
    expect(probes).toBe(1);
  });

  test('started, it asks on the interval, and stopped, it does not', async () => {
    let probes = 0;
    const watch = watchContainerHost({
      probe: async () => {
        probes += 1;
        return up;
      },
      intervalMs: 5,
      consequence: 'x',
      log: { info: () => {}, error: () => {} },
    });
    watch.start();
    await new Promise((resolve) => setTimeout(resolve, 40));
    watch.stop();
    const seen = probes;
    expect(seen).toBeGreaterThanOrEqual(3);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(probes).toBe(seen);
  });
});
