import { describe, expect, test } from 'bun:test';
import { deadlineFor } from '../../src/run-object-state';
import type { RunRecord } from '../../src/runs';
import { credentials, snapshot } from '../fake-host';

/**
 * That a sandbox is released at its wall-clock ceiling with no request made
 * (T038, FR-010, SC-008).
 *
 * This is the invariant the constitution gained in version 2.0.0, and it is
 * here because of what hosting changed. On a daemon the team administers, a
 * forgotten container is visible in `docker ps` and costs a machine somebody
 * already owns. On a managed service it costs money per minute, on an account,
 * until something releases it — and the thing that was supposed to release it
 * is the orchestrator, which is precisely what may have died.
 *
 * So the release cannot depend on anyone calling back. It is an alarm the
 * platform owns, set when the sandbox is created, and `sleepAfter` is a second
 * line underneath it rather than the mechanism (D5).
 */

const record = (wallClockMinutes: number): RunRecord => ({
  snapshot,
  credentials,
  sandbox: {
    image: 'factory/runner:1',
    cpu: 2,
    memoryMb: 4096,
    wallClockMinutes,
    networkDuringImplement: false,
  },
  containerId: 'sandbox_1x4.7f3c9a1e',
  outcome: 'running',
});

describe('the deadline the alarm fires at', () => {
  test('is the ceiling, from creation, to the minute (FR-009a)', () => {
    const created = Date.parse('2026-09-11T09:00:00.000Z');
    expect(deadlineFor(record(90), created)).toBe(Date.parse('2026-09-11T10:30:00.000Z'));
  });

  test('is absolute, so it cannot be pushed back by taking more steps', () => {
    // The failure this prevents: a duration re-derived on each write would
    // give a run that keeps working an unbounded life, which is exactly the
    // run whose cost nobody is watching.
    const created = Date.parse('2026-09-11T09:00:00.000Z');
    const atCreation = deadlineFor(record(30), created);
    const anHourLater = deadlineFor(record(30), created + 60 * 60_000);
    expect(anHourLater).toBeGreaterThan(atCreation);
    // Which is why `save` keeps the FIRST deadline rather than recomputing —
    // asserted against the Worker, since the storage itself is unreachable
    // from a test here.
    expect(atCreation).toBe(Date.parse('2026-09-11T09:30:00.000Z'));
  });
});

describe('the alarm is wired so that nothing has to call back', () => {
  test('the deadline is set once, on the first save, and never moved', async () => {
    const worker = await Bun.file('apps/runner/src/worker.ts').text();
    expect(worker).toContain('existing?.deadline ?? deadlineFor(record, Date.now())');
  });

  test('the alarm releases the sandbox and then forgets the run', async () => {
    const worker = await Bun.file('apps/runner/src/worker.ts').text();
    // Both halves matter. Releasing without forgetting leaves credentials
    // behind (FR-016); forgetting without releasing leaves a sandbox nobody
    // has the identifier for any more, which is the unbounded cost.
    const alarm = worker.slice(worker.indexOf('override async alarm()'));
    expect(alarm).toContain('.destroy(containerId)');
    expect(alarm).toContain('await this.forget()');
  });

  test('a retained failed sandbox moves the alarm rather than cancelling it', async () => {
    // Retention extends a sandbox's life past the run's end, so the backstop
    // has to move with it — and `setAlarm` replaces rather than adds, so
    // nothing needs to cancel the old one.
    const worker = await Bun.file('apps/runner/src/worker.ts').text();
    expect(worker).toContain('record.retainedUntil');
    expect(worker).toContain('setAlarm(at)');
  });

  test('`sleepAfter` is a second line, not the mechanism (D5)', async () => {
    // A slept sandbox is not a released one: it stops costing compute but the
    // run is not over and nothing has been cleaned up. If this were the
    // mechanism, FR-010 would be unmet.
    const hosted = await Bun.file('apps/runner/src/container/hosted.ts').text();
    expect(hosted).toContain('SLEEP_AFTER');
    expect(hosted).toContain('The wall-clock alarm is what ends it');
  });
});
