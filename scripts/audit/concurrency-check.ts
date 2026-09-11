#!/usr/bin/env bun
/**
 * T226, SC-007 — the configured number of runs execute at once without any
 * run taking more than 20% longer than it would alone.
 *
 * The criterion is about CONTENTION, so it needs a baseline. "How long it
 * would take alone" is not observable while runs overlap, so this audit
 * takes the baseline from the record: for each step, the runs of it that had
 * the machine to themselves. A step run alone is the control; the same step
 * run alongside others is the measurement.
 *
 * Comparing per step rather than per run is what makes the comparison mean
 * anything — two runs of different pipelines take different times for
 * reasons that have nothing to do with contention, and averaging them would
 * hide exactly the slowdown being looked for. The arithmetic lives in
 * ./contention.ts and is tested in ./tests/contention.test.ts, because this
 * audit reports INCONCLUSIVE against most real data and a bug in a verdict
 * nobody reaches would never be noticed.
 *
 *   bun scripts/audit/concurrency-check.ts [--since 7d] [--tolerance 0.2]
 */

import { createClient } from '@factory/db';
import type { PipelineSnapshot } from '@factory/shared';
import { analyse, type Observation } from './contention';
import { type Finding, report, since } from './report';

const { iso, label } = since(Bun.argv);
const toleranceIndex = Bun.argv.indexOf('--tolerance');
const tolerance = toleranceIndex === -1 ? 0.2 : Number(Bun.argv[toleranceIndex + 1]);
if (!Number.isFinite(tolerance) || tolerance < 0) {
  throw new Error('--tolerance expects a fraction, for example 0.2 for 20%');
}

const { sql } = createClient();

const rows = await sql`
  select s.run_id, s.step_index, s.duration_s, s.started_at, s.finished_at, r.snapshot
  from step_results s
  join runs r on r.id = s.run_id
  where r.created_at >= ${iso}
    and s.status = 'done'
    and s.started_at is not null
    and s.finished_at is not null
    and s.duration_s is not null
    and s.duration_s > 0
  order by s.started_at`;

const observations: Observation[] = rows.map((row) => {
  const snapshot = row.snapshot as PipelineSnapshot;
  const step = snapshot.pipeline.steps[row.step_index as number];
  const agent = step?.agent_id ? snapshot.agents.find((a) => a.id === step.agent_id) : undefined;
  return {
    runId: row.run_id as string,
    stepIndex: row.step_index as number,
    // The agent's NAME, not its id: a renamed agent is the same work, and an
    // id changes whenever an agent is replaced, which would split a baseline
    // in two and leave both halves too small to compare.
    kind: agent ? `agent:${agent.name}` : `step:${step?.type ?? 'unknown'}`,
    durationS: row.duration_s as number,
    startedAt: new Date(row.started_at as string),
    finishedAt: new Date(row.finished_at as string),
  };
});

const result = analyse(observations, tolerance);

const findings: Finding[] = result.slowdowns.map(({ observation, baseline, ratio }) => ({
  where: `run=${observation.runId} step=${observation.stepIndex} (${observation.kind})`,
  detail:
    `${observation.durationS}s against a ${baseline}s baseline — ` +
    `${Math.round((ratio - 1) * 100)}% longer, alongside ${observation.overlap} ` +
    `other step(s); the criterion allows ${Math.round(tolerance * 100)}%`,
}));

const notes = result.baselines.map(
  ({ kind, baseline, alone, contended }) =>
    `${kind}: baseline ${baseline}s from ${alone} uncontended, ${contended} contended`,
);

const [workspace] = await sql`
  select max_concurrent_runs from workspaces order by created_at limit 1`;
const cap = (workspace?.max_concurrent_runs as number | undefined) ?? null;

if (cap !== null) {
  notes.push(`configured cap ${cap}; the most steps seen executing at once was ${result.peak}`);
  if (result.peak < cap && observations.length > 0) {
    // Worth saying plainly: passing under a lighter load than the configured
    // one has not tested the configured one.
    notes.push(
      `peak observed load (${result.peak}) never reached the cap (${cap}), so this period did ` +
        'not exercise the configured concurrency',
    );
  }
}

const code = report({
  criterion: `SC-007 — concurrent runs stay within ${Math.round(tolerance * 100)}% of running alone`,
  examined:
    `${observations.length} completed step(s) across ` +
    `${new Set(observations.map((o) => o.runId)).size} run(s) since ${label}; ` +
    `${result.compared} contended step(s) had an uncontended baseline`,
  findings,
  inconclusive:
    result.compared === 0
      ? 'no step ran both alone and alongside another run in this period, so there is no ' +
        'baseline to compare against — run the configured concurrency, then run this again'
      : undefined,
  notes,
});

await sql.end();
process.exit(code);
