import { describe, expect, test } from 'bun:test';
import { sandboxLifetime } from '../../src/router';

/**
 * A container must outlive the work it is handed. The two numbers were set
 * independently: a sandbox defaults to 90 minutes, and a step with no limit
 * of its own inherits the run's whole time ceiling as its deadline. Six
 * steps at 45 minutes is 270 minutes of authorised work inside a 90-minute
 * container, and when the container goes first the step fails as something
 * unreachable rather than on its own terms.
 */
const pipeline = (steps: number, perStep: number) => ({
  pipeline: { steps: Array.from({ length: steps }, () => ({})) },
  limits: { time_ceiling_minutes: perStep },
});

describe('how long a sandbox must live', () => {
  test('a configured lifetime that cannot hold the pipeline is raised', () => {
    // Six steps at 45 minutes each, plus the margin for clone and installs.
    expect(sandboxLifetime(pipeline(6, 45), 90)).toBe(285);
  });

  test('a configured lifetime longer than the work is left alone', () => {
    // This only ever raises a floor; it never shortens what somebody chose.
    expect(sandboxLifetime(pipeline(2, 10), 240)).toBe(240);
  });

  test('a snapshot that says nothing about its steps keeps the configured value', () => {
    expect(sandboxLifetime({}, 90)).toBe(90);
    expect(sandboxLifetime({ pipeline: { steps: [] } }, 90)).toBe(90);
    expect(sandboxLifetime(pipeline(4, 0), 90)).toBe(90);
  });

  test('the run that prompted this would have fitted', () => {
    // 95 minutes of wall clock against a 90-minute container.
    expect(sandboxLifetime(pipeline(6, 45), 90)).toBeGreaterThan(95);
  });
});
