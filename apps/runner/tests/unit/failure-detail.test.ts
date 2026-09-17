import { describe, expect, test } from 'bun:test';
import { failureDetail } from '../../src/engines/claude-cli';

/**
 * What a failed step tells a person (FR-084).
 *
 * Written from a real run: the Plan step exited 1 with stderr empty, because
 * the account had reached its monthly spend limit. The CLI said exactly that
 * on stdout, the log kept it, and the step's own detail read "the CLI exited
 * 1" — a message that names nothing anybody can act on.
 */

const logs = { clean: (text: string) => text.replaceAll('sk-ant-secret', '[redacted]') };
const noWords = { resultText: null };

const SPEND_LIMIT =
  "You've hit your org's monthly spend limit · ask your admin to raise it at " +
  'claude.ai/admin-settings/usage · your session limit resets 1:40pm (UTC)';

describe('the detail a failed CLI step carries', () => {
  test('stderr wins, because a crash lands there', () => {
    const detail = failureDetail(
      logs,
      { exitCode: 1, stdout: 'chatter', stderr: 'Segmentation fault' },
      { resultText: 'never mind' },
    );
    expect(detail).toBe('Segmentation fault');
  });

  test('with stderr empty, the assistant’s last words', () => {
    const detail = failureDetail(
      logs,
      { exitCode: 1, stdout: 'earlier output', stderr: '   ' },
      { resultText: SPEND_LIMIT },
    );
    expect(detail).toBe(SPEND_LIMIT);
  });

  test('with neither, the tail of stdout — where a refusal is printed', () => {
    const stdout = [
      '▶ Read /work/docs/spec.md',
      '▶ Bash ls -la',
      SPEND_LIMIT,
      '✗ Ended · 9 turns · 1m 10s · $0.4219',
    ].join('\n');

    const detail = failureDetail(logs, { exitCode: 1, stdout, stderr: '' }, noWords);

    expect(detail).toContain('monthly spend limit');
    // The last line printed is the last line kept: that is where a refusal is.
    expect(detail.endsWith('✗ Ended · 9 turns · 1m 10s · $0.4219')).toBe(true);
  });

  test('only when there is nothing at all does it name the exit code', () => {
    expect(failureDetail(logs, { exitCode: 137, stdout: '  \n ', stderr: '' }, noWords)).toBe(
      'the CLI exited 137',
    );
  });

  test('a credential in the output is redacted, wherever the detail came from', () => {
    expect(
      failureDetail(logs, { exitCode: 1, stdout: 'used sk-ant-secret', stderr: '' }, noWords),
    ).toBe('used [redacted]');
    expect(
      failureDetail(logs, { exitCode: 1, stdout: '', stderr: 'sk-ant-secret rejected' }, noWords),
    ).toBe('[redacted] rejected');
  });

  test('a very long detail is capped', () => {
    const detail = failureDetail(
      logs,
      { exitCode: 1, stdout: '', stderr: 'x'.repeat(9000) },
      noWords,
    );
    expect(detail.length).toBe(4000);
  });

  test('the tail keeps the last twenty lines, not the first', () => {
    const stdout = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`).join('\n');
    const detail = failureDetail(logs, { exitCode: 1, stdout, stderr: '' }, noWords);
    expect(detail.split('\n')).toHaveLength(20);
    expect(detail).toContain('line 50');
    expect(detail).not.toContain('line 30');
  });
});
