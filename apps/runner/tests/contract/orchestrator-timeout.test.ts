import { describe, expect, test } from 'bun:test';

/**
 * That the orchestrator will wait as long as a step may take (T064, 002 D9).
 *
 * A step's request is held open for the length of the step. That was always
 * true, but hosting changed its consequence: **the client disconnecting now
 * cancels the step**, including the cleanup in its `finally`. So an
 * orchestrator request timeout shorter than a step's ceiling does not merely
 * report a timeout — it kills work that was going fine, and can leave a sandbox
 * behind.
 *
 * n8n's HTTP Request node defaults to a five-minute timeout. An agent step
 * routinely takes longer than that. So every call that is held open for a step
 * must set one explicitly, and it must be derived from the run's own ceiling
 * rather than from a figure somebody guessed — otherwise raising the workspace's
 * wall-clock limit silently fails to raise this.
 */

const workflow = (await Bun.file('orchestration/n8n/run-ticket-pipeline.json').json()) as {
  nodes: {
    name: string;
    type: string;
    parameters: { url?: string; options?: { timeout?: string } };
  }[];
};

/** The calls that are held open for the length of a step or a whole start. */
const LONG_HELD = ['Runner: start', 'Runner: run step', 'Runner: verify and push'];

describe('every long-held call sets its own timeout', () => {
  test.each(LONG_HELD)('%s', (name) => {
    const node = workflow.nodes.find((candidate) => candidate.name === name);
    expect(node, `the workflow has no node named ${name}`).toBeDefined();
    const timeout = node?.parameters.options?.timeout;
    // Absent means n8n's five-minute default, which is shorter than a great
    // many legitimate steps.
    expect(timeout, `${name} must set options.timeout explicitly`).toBeTruthy();
  });

  test('the timeout is derived from the run’s wall-clock ceiling, not a fixed figure', () => {
    for (const name of LONG_HELD) {
      const timeout =
        workflow.nodes.find((n) => n.name === name)?.parameters.options?.timeout ?? '';
      // An expression, reading the snapshot's own ceiling. A hard-coded number
      // would mean raising the workspace's limit silently failed to raise this,
      // which is the failure that is hardest to attribute.
      expect(timeout.startsWith('={{')).toBe(true);
      expect(timeout).toContain('wall_clock_minutes');
    }
  });

  test('it exceeds the ceiling rather than equalling it', () => {
    // A timeout equal to the ceiling is a race between two clocks. The margin
    // is what makes the SANDBOX's own deadline the thing that fires, so the
    // failure is reported as a deadline rather than as a lost connection.
    const timeout = workflow.nodes.find((n) => n.name === 'Runner: run step')?.parameters.options
      ?.timeout as string;
    // Evaluated for a 90-minute ceiling, the figure the defaults ship with.
    const ms = evaluate(timeout, { sandbox: { wall_clock_minutes: 90 } });
    expect(ms).toBeGreaterThan(90 * 60_000);
  });

  test('a snapshot with no ceiling still gets a generous timeout, not zero', () => {
    // The expression must survive an older snapshot. Falling through to `0`
    // would make every step fail instantly, which is a far worse outcome than
    // waiting too long.
    const timeout = workflow.nodes.find((n) => n.name === 'Runner: run step')?.parameters.options
      ?.timeout as string;
    expect(evaluate(timeout, {})).toBeGreaterThan(60 * 60_000);
  });
});

/**
 * Evaluates an n8n expression against a `$json` value.
 *
 * Only enough of n8n to check the arithmetic: the expressions here read
 * `$json` and nothing else. Asserting the arithmetic matters more than
 * asserting the string, because the string being present is not the same as
 * the number it produces being large enough.
 */
function evaluate(expression: string, json: unknown): number {
  const body = expression.replace(/^=\{\{/, '').replace(/\}\}$/, '');
  return Number(new Function('$json', `return (${body});`)(json));
}
