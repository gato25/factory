import { describe, expect, test } from 'bun:test';
import type { Step } from '@factory/shared';
import { carryOver } from '../../src/lib/services/change-pipeline';

const doc = (path: string) =>
  ({ path, kind: 'document', runId: 'r', version: 1 }) as unknown as Parameters<
    typeof carryOver
  >[1] extends ReadonlyMap<string, infer A>
    ? A
    : never;

const steps: Step[] = [
  {
    type: 'agent',
    condition: 'always',
    agent_id: 'spec',
    output_files: ['docs/tickets/3/spec.md'],
  },
  { type: 'design', condition: 'ticket_has_ui', agent_id: 'design' },
  {
    type: 'agent',
    condition: 'always',
    agent_id: 'plan',
    output_files: ['docs/tickets/3/plan.md'],
  },
  { type: 'checkpoint', condition: 'always' },
  { type: 'agent', condition: 'always', agent_id: 'tasks', output_files: ['docs/tasks.md'] },
  { type: 'agent', condition: 'always', agent_id: 'implement', output_files: [] },
];

const produced = (...paths: string[]) => new Map(paths.map((p) => [p, doc(p)]));

describe('carrying finished work onto a new pipeline', () => {
  test('carries the spec and plan, skips the design on a ticket with no interface, stops at the gate', () => {
    const carried = carryOver(
      steps,
      produced('docs/tickets/3/spec.md', 'docs/tickets/3/plan.md'),
      false,
    );
    expect(carried.map((c) => [c.index, c.skipped])).toEqual([
      [0, false],
      [1, true],
      [2, false],
    ]);
  });

  test('a design step with no design yet stops the carrying', () => {
    const carried = carryOver(
      steps,
      produced('docs/tickets/3/spec.md', 'docs/tickets/3/plan.md'),
      true,
    );
    expect(carried.map((c) => c.index)).toEqual([0]);
  });

  test('carries the design with its screens when it exists', () => {
    const carried = carryOver(
      steps,
      produced(
        'docs/tickets/3/spec.md',
        'docs/design/ui.pen',
        'docs/design/screens/ui.png',
        'docs/tickets/3/plan.md',
      ),
      true,
    );
    expect(carried.map((c) => c.index)).toEqual([0, 1, 2]);
    expect(carried[1]?.outputs.map((o) => o.path)).toEqual([
      'docs/design/ui.pen',
      'docs/design/screens/ui.png',
    ]);
  });

  test('nothing produced yet carries nothing', () => {
    expect(carryOver(steps, produced(), null)).toEqual([]);
  });
});
