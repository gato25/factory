/**
 * The arithmetic behind the SC-007 audit, separated from its database
 * reading so it can be tested. An audit whose verdict nobody has ever seen
 * be wrong is not evidence of anything, and this one reports INCONCLUSIVE
 * for most real data — which is exactly the case where a silent bug would
 * never be noticed.
 */

export interface Observation {
  runId: string;
  stepIndex: number;
  /** What makes two measurements comparable: the agent, or the step's type. */
  kind: string;
  durationS: number;
  startedAt: Date;
  finishedAt: Date;
}

export interface Overlapped extends Observation {
  /** Steps of OTHER runs executing during any part of this one's window. */
  overlap: number;
}

export interface Slowdown {
  observation: Overlapped;
  baseline: number;
  ratio: number;
}

export interface Contention {
  measured: Overlapped[];
  /** Per kind, the uncontended baseline and how many were compared. */
  baselines: { kind: string; baseline: number; alone: number; contended: number }[];
  slowdowns: Slowdown[];
  /** How many contended steps had a baseline to be compared against. */
  compared: number;
  /** The most steps seen executing at the same moment. */
  peak: number;
}

/**
 * Two steps of the same run are sequential by construction, so they are not
 * contention. Only other runs count.
 */
export function withOverlap(observations: Observation[]): Overlapped[] {
  return observations.map((one) => ({
    ...one,
    overlap: observations.filter(
      (other) =>
        other.runId !== one.runId &&
        other.startedAt < one.finishedAt &&
        other.finishedAt > one.startedAt,
    ).length,
  }));
}

/**
 * The median, not the mean: one pathological run should not move the
 * baseline, and one should not be excused by a fast neighbour either.
 */
export function median(values: number[]): number {
  if (values.length === 0) throw new Error('median of nothing');
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2
    : (sorted[middle] as number);
}

export function analyse(observations: Observation[], tolerance: number): Contention {
  const measured = withOverlap(observations);

  const byKind = new Map<string, Overlapped[]>();
  for (const observation of measured) {
    const list = byKind.get(observation.kind) ?? [];
    list.push(observation);
    byKind.set(observation.kind, list);
  }

  const baselines: Contention['baselines'] = [];
  const slowdowns: Slowdown[] = [];
  let compared = 0;

  for (const [kind, group] of byKind) {
    const alone = group.filter((o) => o.overlap === 0);
    const contended = group.filter((o) => o.overlap > 0);
    // A kind with no uncontended run has no control, and a kind with no
    // contended run has nothing to measure. Neither is a failure.
    if (alone.length === 0 || contended.length === 0) continue;

    const baseline = median(alone.map((o) => o.durationS));
    compared += contended.length;
    baselines.push({ kind, baseline, alone: alone.length, contended: contended.length });

    for (const observation of contended) {
      const ratio = observation.durationS / baseline;
      if (ratio > 1 + tolerance) slowdowns.push({ observation, baseline, ratio });
    }
  }

  return {
    measured,
    baselines,
    slowdowns,
    compared,
    // Overlap counts other runs, so the load at that moment is one more.
    peak: measured.reduce((most, o) => Math.max(most, o.overlap + 1), 0),
  };
}
