import { describe, expect, test } from 'bun:test';
import type { StepType } from '@factory/shared';
import {
  position,
  type ShapeInput,
  segmentState,
  segmentTone,
  shapeOf,
} from '../../src/lib/step-shape';

/**
 * specs/004-bento-redesign data-model StepShape. The pipelines are the ones
 * the design draws — a two-step quick fix, the standard five with its
 * conditional design step, a reviewed seven with three checkpoints — so a bar
 * of 3, 6 and 8 segments is exactly what the artboards show.
 */

const steps = (...types: StepType[]) => types.map((type) => ({ type }));
const QUICK = steps('agent', 'agent');
const STANDARD = steps('agent', 'design', 'agent', 'agent', 'agent');
const REVIEWED = steps(
  'agent',
  'checkpoint',
  'agent',
  'checkpoint',
  'agent',
  'agent',
  'checkpoint',
);

const run = (input: Partial<ShapeInput> & Pick<ShapeInput, 'steps'>) =>
  shapeOf({ runStatus: 'running', currentStepIndex: 0, ...input });
const states = (shape: ReturnType<typeof shapeOf>) =>
  Array.from({ length: shape.count }, (_, i) => segmentState(shape, i));
const tones = (shape: ReturnType<typeof shapeOf>) =>
  Array.from({ length: shape.count }, (_, i) => segmentTone(shape, i));

describe('one segment per step, and one for the merge request', () => {
  test('3, 6 and 8 segments for pipelines of 2, 5 and 7 steps', () => {
    expect(run({ steps: QUICK }).count).toBe(3);
    expect(run({ steps: STANDARD }).count).toBe(6);
    expect(run({ steps: REVIEWED }).count).toBe(8);
  });

  test('the merge request is always the last segment', () => {
    expect(run({ steps: STANDARD }).kinds).toEqual([
      'agent',
      'design',
      'agent',
      'agent',
      'agent',
      'merge_request',
    ]);
  });
});

describe('where the run is', () => {
  test('running the fifth of five steps reads 5 of 6, with the four before it done', () => {
    const shape = run({ steps: STANDARD, currentStepIndex: 4 });
    expect(position(shape)).toBe(5);
    expect(states(shape)).toEqual(['done', 'done', 'done', 'done', 'current', 'upcoming']);
    expect(segmentTone(shape, 4)).toBe('run');
  });

  test('a running design step is drawn in pen.dev blue, not the accent', () => {
    const shape = run({ steps: STANDARD, currentStepIndex: 1 });
    expect(segmentTone(shape, 1)).toBe('pen');
  });

  test('a skipped step stays skipped, however far the run has got', () => {
    const shape = run({ steps: STANDARD, currentStepIndex: 3, skipped: [1] });
    expect(states(shape)).toEqual(['done', 'skipped', 'done', 'current', 'upcoming', 'upcoming']);
    const done = shapeOf({
      steps: STANDARD,
      runStatus: 'done',
      currentStepIndex: null,
      skipped: [1],
    });
    expect(segmentState(done, 1)).toBe('skipped');
  });

  test('waiting at the second checkpoint of eight segments is 4 of 8, in the approval colour', () => {
    const shape = shapeOf({ steps: REVIEWED, runStatus: 'waiting_approval', currentStepIndex: 3 });
    expect(shape.state).toBe('waiting');
    expect(position(shape)).toBe(4);
    expect(shape.kinds[3]).toBe('checkpoint');
    expect(segmentTone(shape, 3)).toBe('wait');
  });

  test('a failed run marks the step that failed, in red', () => {
    const shape = shapeOf({
      steps: STANDARD,
      runStatus: 'failed',
      currentStepIndex: 4,
      failureStepIndex: 4,
    });
    expect(tones(shape)).toEqual(['done', 'done', 'done', 'done', 'fail', 'upcoming']);
  });

  test('a cancelled run is not drawn as a failure', () => {
    const shape = shapeOf({ steps: STANDARD, runStatus: 'cancelled', currentStepIndex: 2 });
    expect(segmentTone(shape, 2)).toBe('cancelled');
  });

  test('opening the merge request is work on the last segment', () => {
    const shape = shapeOf({ steps: QUICK, runStatus: 'opening_mr', currentStepIndex: 1 });
    expect(shape.state).toBe('running');
    expect(states(shape)).toEqual(['done', 'done', 'current']);
    expect(position(shape)).toBe(3);
  });

  test('done is every segment done, and the whole count', () => {
    const shape = shapeOf({ steps: QUICK, runStatus: 'done', currentStepIndex: null });
    expect(states(shape)).toEqual(['done', 'done', 'done']);
    expect(position(shape)).toBe(3);
  });

  test('not started — queued, or no run yet — marks nothing current and reads 0', () => {
    for (const runStatus of ['queued', null] as const) {
      const shape = shapeOf({ steps: STANDARD, runStatus, currentStepIndex: null });
      expect(shape.current).toBeNull();
      expect(position(shape)).toBe(0);
      expect(states(shape).every((s) => s === 'upcoming')).toBe(true);
    }
  });

  test('an index past the end is held to the last segment rather than drawn off the bar', () => {
    expect(run({ steps: QUICK, currentStepIndex: 9 }).current).toBe(2);
  });
});
