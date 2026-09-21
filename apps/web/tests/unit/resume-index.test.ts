import { describe, expect, test } from 'bun:test';
import { resumeIndex } from '../../src/lib/services/continue';

/**
 * Where a continued run picks up.
 *
 * The rule has to cope with a step that leaves no record. A checkpoint
 * writes no step result, so a run that passed its gate and failed later
 * looked, to the old rule, as though the gate had never happened.
 */
const settled = (...indexes: number[]) => new Set(indexes);

describe('the step a continued run starts at', () => {
  test('the first step, when nothing has run', () => {
    expect(resumeIndex(6, settled())).toBe(0);
  });

  test('the first step with no result, in the ordinary case', () => {
    expect(resumeIndex(6, settled(0, 1))).toBe(2);
  });

  test('a passed checkpoint is not mistaken for unfinished work', () => {
    // The real shape of the run that prompted this: spec, design and plan
    // done, a checkpoint at 3 that recorded nothing, tasks done at 4, and
    // implement killed at its deadline. It must resume at 5, not at 3.
    expect(resumeIndex(6, settled(0, 1, 2, 4))).toBe(5);
  });

  test('the failed step itself is where it resumes, not the one after', () => {
    // A failed step is not settled, so it is the first thing to run again.
    expect(resumeIndex(6, settled(0, 1, 2, 3, 4))).toBe(5);
  });

  test('a skipped step counts as settled', () => {
    expect(resumeIndex(3, settled(0, 1, 2))).toBe(-1);
  });

  test('nothing left to do says so rather than starting over', () => {
    expect(resumeIndex(2, settled(0, 1))).toBe(-1);
    // Even with a gap behind the furthest settled step: those are steps the
    // run has already gone past, not work waiting to be done.
    expect(resumeIndex(2, settled(1))).toBe(-1);
  });
});
