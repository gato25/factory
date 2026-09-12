import { describe, expect, test } from 'bun:test';
import {
  commandLine,
  DEADLINE_CODES_AGREE,
  outerTimeoutMs,
  TIMEOUT_COMMAND_EXIT_CODE,
  WORK_USER,
} from '../../src/container/hosted-command';
import { TIMEOUT_EXIT_CODE } from '../../src/engines/limits';

/**
 * The managed host takes a command STRING where the Docker host takes an
 * argument list. Everything that protects a step lives in that one conversion:
 * the work runs unprivileged, the deadline starts when the command does, and
 * text a person typed stays text.
 *
 * These cases run the composed line through a real `sh`, because an assertion
 * about the string would only prove the code matches itself. `setpriv` and
 * `timeout` are not installed here, so what is proven is the ARGUMENT VECTOR a
 * shell would hand them — which is the part that can be got wrong.
 */

async function argumentsAfterShell(line: string): Promise<string[]> {
  // `printf '%s\0'` writes each argument exactly, with a separator no value can
  // contain, so an argument holding a newline is still one argument.
  const proc = Bun.spawn(['sh', '-c', `printf '%s\\0' ${line}`], { stdout: 'pipe' });
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  return out.split('\0').slice(0, -1);
}

describe('commandLine', () => {
  test('drops to the unprivileged user with no deadline set', async () => {
    expect(await argumentsAfterShell(commandLine(['claude', '--version']))).toEqual([
      'setpriv',
      `--reuid=${WORK_USER}`,
      `--regid=${WORK_USER}`,
      '--clear-groups',
      'claude',
      '--version',
    ]);
  });

  test('wraps in timeout when a deadline is set, converting to whole seconds', async () => {
    const args = await argumentsAfterShell(commandLine(['sleep', '99'], { timeoutMs: 90_000 }));
    expect(args.slice(0, 3)).toEqual(['timeout', '--signal=KILL', '90']);
    // And setpriv is INSIDE timeout, so the deadline covers the real work
    // rather than covering a process that drops privileges and exits.
    expect(args[3]).toBe('setpriv');
    expect(args.at(-2)).toBe('sleep');
  });

  test('a sub-second deadline still gets at least one second', async () => {
    const args = await argumentsAfterShell(commandLine(['true'], { timeoutMs: 40 }));
    expect(args[2]).toBe('1');
  });

  test('rounds a fractional deadline up, never down', async () => {
    // Rounding down would stop a step marginally before its own limit and
    // report a deadline the agent had not actually reached.
    const args = await argumentsAfterShell(commandLine(['true'], { timeoutMs: 1_500 }));
    expect(args[2]).toBe('2');
  });

  test('a ticket title cannot run a command, even wrapped in setpriv', async () => {
    // The shape somebody would actually try, now passing through two more
    // layers of command construction than the Docker host used.
    const attack = `x'; touch /tmp/factory-hosted-pwned; echo '`;
    const args = await argumentsAfterShell(
      commandLine(['claude', '-p', attack], { timeoutMs: 60_000 }),
    );
    expect(args.at(-1)).toBe(attack);
    const check = Bun.spawn(
      ['sh', '-c', 'test -e /tmp/factory-hosted-pwned && echo yes || echo no'],
      { stdout: 'pipe' },
    );
    expect((await new Response(check.stdout).text()).trim()).toBe('no');
  });

  test('a whole agent invocation round-trips unchanged', async () => {
    const argv = [
      'claude',
      '-p',
      'Work on ticket #142: Add "OAuth".\n\nProduce: docs/spec.md.',
      '--output-format',
      'json',
      '--allowedTools',
      'Read,Write,Edit',
    ];
    const args = await argumentsAfterShell(commandLine(argv, { timeoutMs: 600_000 }));
    expect(args.slice(-argv.length)).toEqual(argv);
  });
});

describe('the deadline a caller sees', () => {
  /**
   * The coupling that makes a hosted deadline indistinguishable from a Docker
   * one: `timeout(1)` exits 124, and 124 is what `runs.ts` branches on. If
   * either side ever moves, a step that hit its limit would start reading as an
   * ordinary failure — silently, and only in production.
   */
  test('timeout(1) and TIMEOUT_EXIT_CODE agree', () => {
    expect(TIMEOUT_COMMAND_EXIT_CODE).toBe(124);
    expect(TIMEOUT_EXIT_CODE).toBe(TIMEOUT_COMMAND_EXIT_CODE);
    expect(DEADLINE_CODES_AGREE).toBe(true);
  });

  test('the outer bound never fires before the step deadline', () => {
    // The SDK has no default timeout, so something must bound the call — but if
    // it fired first the result would carry no exit code and a deadline would
    // look like a hang.
    for (const step of [1_000, 60_000, 600_000, 5_400_000]) {
      expect(outerTimeoutMs(step)).toBeGreaterThan(step);
    }
  });

  test('an unbounded step still gets an outer bound', () => {
    expect(outerTimeoutMs()).toBeGreaterThan(0);
    expect(outerTimeoutMs(undefined)).toBe(outerTimeoutMs(0));
  });
});
