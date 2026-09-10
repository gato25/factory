import { expect, test } from 'bun:test';
import { analyse, median, type Observation, withOverlap } from '../contention';

/**
 * SC-007's arithmetic. The audit itself reports INCONCLUSIVE against most
 * real data — nothing ran both alone and contended — which is precisely the
 * situation where a bug in the comparison would never be noticed. So the
 * comparison is exercised here, on data built to contain the answer.
 */

const at = (fromSeconds: number, seconds: number) => ({
  startedAt: new Date(1_700_000_000_000 + fromSeconds * 1000),
  finishedAt: new Date(1_700_000_000_000 + (fromSeconds + seconds) * 1000),
  durationS: seconds,
});

const step = (runId: string, kind: string, fromSeconds: number, seconds: number): Observation => ({
  runId,
  stepIndex: 0,
  kind,
  ...at(fromSeconds, seconds),
});

test('a step alone has no overlap; two runs overlapping have one each', () => {
  const measured = withOverlap([step('a', 'agent:Spec', 0, 10), step('b', 'agent:Spec', 100, 10)]);
  expect(measured.map((o) => o.overlap)).toEqual([0, 0]);

  const together = withOverlap([step('a', 'agent:Spec', 0, 10), step('b', 'agent:Spec', 5, 10)]);
  expect(together.map((o) => o.overlap)).toEqual([1, 1]);
});

test('two steps of the SAME run are sequential, so they are not contention', () => {
  // Same run, overlapping windows — which should not happen, but if the
  // record says so it is still not evidence about concurrency.
  const measured = withOverlap([
    { ...step('a', 'agent:Spec', 0, 10), stepIndex: 0 },
    { ...step('a', 'agent:Implement', 5, 10), stepIndex: 1 },
  ]);
  expect(measured.map((o) => o.overlap)).toEqual([0, 0]);
});

test('touching windows do not overlap, so a queue is not counted as contention', () => {
  // b starts exactly when a finishes: that is the cap working, not contention.
  const measured = withOverlap([step('a', 'agent:Spec', 0, 10), step('b', 'agent:Spec', 10, 10)]);
  expect(measured.map((o) => o.overlap)).toEqual([0, 0]);
});

test('a contended step more than the tolerance slower than its baseline is a finding', () => {
  const result = analyse(
    [
      // Three uncontended runs of the same step: the control.
      step('a', 'agent:Spec', 0, 10),
      step('b', 'agent:Spec', 20, 10),
      step('c', 'agent:Spec', 40, 10),
      // Two overlapping each other, one within tolerance and one beyond it.
      step('d', 'agent:Spec', 100, 12),
      step('e', 'agent:Spec', 100, 15),
    ],
    0.2,
  );

  expect(result.baselines).toEqual([{ kind: 'agent:Spec', baseline: 10, alone: 3, contended: 2 }]);
  expect(result.compared).toBe(2);
  // 12s is exactly 20% over, which the criterion allows; 15s is 50% over.
  expect(result.slowdowns.map((s) => s.observation.runId)).toEqual(['e']);
  expect(result.slowdowns[0]?.ratio).toBe(1.5);
  expect(result.peak).toBe(2);
});

test('a slowdown in one kind is not hidden by another kind being fine', () => {
  // Contention is machine-wide, so a control must overlap NOTHING, whatever
  // kind it is. These windows are laid out so each control stands alone.
  const result = analyse(
    [
      step('a', 'agent:Spec', 0, 10), // Spec control
      step('b', 'agent:Implement', 100, 100), // Implement control
      step('c', 'agent:Spec', 1000, 11), // Spec, contended, within tolerance
      step('d', 'agent:Spec', 1000, 11),
      step('e', 'agent:Implement', 2000, 400), // Implement, contended, four times
      step('f', 'agent:Implement', 2000, 100),
    ],
    0.2,
  );
  // Averaged across kinds, a 400s step against a 100s baseline would be
  // diluted by the fast ones. Compared per kind, it is a finding.
  expect(result.slowdowns.map((s) => s.observation.runId)).toEqual(['e']);
  expect(result.slowdowns[0]?.baseline).toBe(100);
  expect(result.slowdowns[0]?.ratio).toBe(4);
  expect(result.compared).toBe(4);
});

test('a kind with no uncontended run is skipped rather than guessed at', () => {
  const result = analyse([step('a', 'agent:Spec', 0, 10), step('b', 'agent:Spec', 5, 900)], 0.2);
  // Both contended, so there is no control. A 900s step next to a 10s one
  // looks damning, but nothing here says what either would take alone.
  expect(result.baselines).toEqual([]);
  expect(result.slowdowns).toEqual([]);
  expect(result.compared).toBe(0);
});

test('a kind with no contended run is skipped too, and reports nothing', () => {
  const result = analyse([step('a', 'agent:Spec', 0, 10), step('b', 'agent:Spec', 100, 300)], 0.2);
  expect(result.compared).toBe(0);
  expect(result.slowdowns).toEqual([]);
  expect(result.peak).toBe(1);
});

test('peak load counts the run itself, not just its neighbours', () => {
  const result = analyse(
    [
      step('a', 'agent:Spec', 0, 30),
      step('b', 'agent:Spec', 5, 30),
      step('c', 'agent:Spec', 10, 30),
    ],
    0.2,
  );
  // Three at once, so the peak is three — not the two neighbours each sees.
  expect(result.peak).toBe(3);
});

test('the baseline is a median, so one slow control does not excuse a slowdown', () => {
  const result = analyse(
    [
      step('a', 'agent:Spec', 0, 10),
      step('b', 'agent:Spec', 100, 10),
      // One pathological uncontended run. The mean of the controls would be
      // 340s, which would forgive anything; the median is 10s.
      step('c', 'agent:Spec', 200, 1000),
      // Two overlapping each other, at twice the median.
      step('d', 'agent:Spec', 5000, 20),
      step('e', 'agent:Spec', 5000, 20),
    ],
    0.2,
  );
  expect(result.baselines[0]).toEqual({
    kind: 'agent:Spec',
    baseline: 10,
    alone: 3,
    contended: 2,
  });
  expect(result.slowdowns.map((s) => s.observation.runId).sort()).toEqual(['d', 'e']);
  expect(result.slowdowns[0]?.ratio).toBe(2);
});

test('median handles both parities, and refuses to invent one from nothing', () => {
  expect(median([5])).toBe(5);
  expect(median([1, 3])).toBe(2);
  expect(median([3, 1, 2])).toBe(2);
  expect(median([4, 1, 3, 2])).toBe(2.5);
  expect(() => median([])).toThrow(/median of nothing/);
});
