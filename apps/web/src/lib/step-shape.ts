/**
 * How far one ticket is through ITS OWN pipeline, in the form every step bar
 * draws: the dashboard's rows, the board's cards, the run page's track
 * (specs/004-bento-redesign data-model: StepShape).
 *
 * The bar used to be four segments on every ticket — Spec, Plan, Tasks,
 * Implement — whatever the pipeline was. Pipelines are data (Constitution
 * III): a quick fix has two steps and a reviewed pipeline seven, so a fixed
 * bar misdrew nearly every ticket. The shape is built from the steps the run
 * pinned, never from the pipeline's current version (Constitution IV).
 *
 * The merge request is a segment of its own, last. Every pipeline ends in one
 * (spec.md §4 08: "the MR step is implicit and always last"), the run page's
 * track draws it, and the design counts it: "5/6 алхам" is the fifth of five
 * steps, with the merge request still to come.
 *
 * Pure, and shared by server and browser: no database, no catalogue.
 */

import type { StepType } from '@factory/shared';

export type SegmentKind = StepType | 'merge_request';
export type ShapeState = 'queued' | 'running' | 'waiting' | 'failed' | 'cancelled' | 'done';

export interface StepShape {
  /** Segments: the pipeline's steps plus the merge request. */
  count: number;
  /** The segment the run is on, or `null` before it starts. */
  current: number | null;
  kinds: SegmentKind[];
  /** Segments recorded as skipped — a condition not met (FR-075a). */
  skipped: number[];
  state: ShapeState;
}

export type RunStatus =
  | 'queued'
  | 'running'
  | 'waiting_approval'
  | 'opening_mr'
  | 'done'
  | 'failed'
  | 'cancelled';

export interface ShapeInput {
  steps: { type: StepType }[];
  /** `null` for a ticket that has no run yet. */
  runStatus: RunStatus | null;
  currentStepIndex: number | null;
  failureStepIndex?: number | null;
  skipped?: number[];
}

export function shapeOf(input: ShapeInput): StepShape {
  const kinds: SegmentKind[] = [...input.steps.map((step) => step.type), 'merge_request'];
  const count = kinds.length;
  const last = count - 1;
  const skipped = [...(input.skipped ?? [])].sort((a, b) => a - b);
  const at = (index: number | null | undefined) =>
    index === null || index === undefined ? 0 : Math.min(Math.max(index, 0), last);

  switch (input.runStatus) {
    case null:
    case 'queued':
      return { count, current: null, kinds, skipped, state: 'queued' };
    case 'running':
      return { count, current: at(input.currentStepIndex), kinds, skipped, state: 'running' };
    case 'waiting_approval':
      return { count, current: at(input.currentStepIndex), kinds, skipped, state: 'waiting' };
    // Every step has run; what is left is the merge request itself.
    case 'opening_mr':
      return { count, current: last, kinds, skipped, state: 'running' };
    case 'done':
      return { count, current: last, kinds, skipped, state: 'done' };
    case 'failed':
      return {
        count,
        current: at(input.failureStepIndex ?? input.currentStepIndex),
        kinds,
        skipped,
        state: 'failed',
      };
    case 'cancelled':
      return { count, current: at(input.currentStepIndex), kinds, skipped, state: 'cancelled' };
  }
}

export type SegmentState = 'done' | 'current' | 'upcoming' | 'skipped';

export function segmentState(shape: StepShape, index: number): SegmentState {
  if (shape.skipped.includes(index)) return 'skipped';
  if (shape.state === 'done') return 'done';
  if (shape.current === null) return 'upcoming';
  if (index < shape.current) return 'done';
  if (index === shape.current) return 'current';
  return 'upcoming';
}

/**
 * The colour a segment wears, by the one meaning each colour keeps on every
 * screen (FR-005): the accent for work in progress, pen.dev blue for design
 * work, golden yellow for a person's approval, red for a failure, green for
 * done.
 */
export type SegmentTone =
  | 'done'
  | 'run'
  | 'pen'
  | 'wait'
  | 'fail'
  | 'cancelled'
  | 'upcoming'
  | 'skipped';

export function segmentTone(shape: StepShape, index: number): SegmentTone {
  const state = segmentState(shape, index);
  if (state !== 'current') return state;
  switch (shape.state) {
    case 'waiting':
      return 'wait';
    case 'failed':
      return 'fail';
    case 'cancelled':
      return 'cancelled';
    default:
      return shape.kinds[index] === 'design' ? 'pen' : 'run';
  }
}

/** "5" of "5/6 алхам": the segment being worked, 0 before the start, all of them once done. */
export function position(shape: StepShape): number {
  if (shape.state === 'done') return shape.count;
  return shape.current === null ? 0 : shape.current + 1;
}
