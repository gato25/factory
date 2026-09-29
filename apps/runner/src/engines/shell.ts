import type { Step, StepOutcome } from '@factory/shared';
import type { ContainerHost } from '../container/host';
import { WORKDIR } from '../container/start';
import type { LogSink } from '../stream/logs';
import { OUTPUT_LIMIT_EXIT_CODE, TIMEOUT_EXIT_CODE } from './limits';

/**
 * A shell step runs the author's fixed command. A non-zero exit fails the
 * step and with it the run, and the full output is retained (FR-055c). No
 * preceding agent step is re-run automatically (FR-055d).
 *
 * This is the ONLY verification mechanism: the system never infers or supplies
 * a command the pipeline did not specify (FR-055b).
 */
export async function runShellStep(
  host: ContainerHost,
  input: {
    step: Step;
    containerId: string;
    logs: LogSink;
    /** The longest the command may run, in minutes; absent, the host's own default deadline. */
    ceilingMinutes?: number;
  },
): Promise<StepOutcome> {
  const command = input.step.command;
  if (!command || command.trim().length === 0) {
    return {
      status: 'failed',
      costUsd: '0.0000',
      durationS: 0,
      outputs: [],
      error: { reason: 'invalid_input', detail: 'this shell step has no command' },
    };
  }

  const started = Date.now();
  const result = await host.exec(input.containerId, ['sh', '-lc', command], {
    cwd: WORKDIR,
    timeoutMs: input.ceilingMinutes ? input.ceilingMinutes * 60_000 : undefined,
    onOutput: (stream, text) => input.logs.write(stream, text),
  });
  input.logs.end();
  const durationS = Math.max(1, Math.round((Date.now() - started) / 1000));

  // Said as they are, and not as "exited 124": a person reading a failed
  // verification step should see that it was stopped, and why.
  if (result.exitCode === TIMEOUT_EXIT_CODE && input.ceilingMinutes) {
    return {
      status: 'failed',
      costUsd: '0.0000',
      durationS,
      outputs: [],
      error: {
        reason: 'time_exceeded',
        detail:
          `\`${command}\` was stopped after ${input.ceilingMinutes} minutes, ` +
          'which is the longest this step may take.',
      },
    };
  }
  if (result.exitCode === OUTPUT_LIMIT_EXIT_CODE) {
    return {
      status: 'failed',
      costUsd: '0.0000',
      durationS,
      outputs: [],
      error: {
        reason: 'command_failed',
        detail: `\`${command}\` was stopped.\n${input.logs
          .clean(result.stderr.trim())
          .slice(-4000)}`,
      },
    };
  }

  if (result.exitCode !== 0) {
    return {
      status: 'failed',
      // A shell step costs nothing: no model ran.
      costUsd: '0.0000',
      durationS,
      outputs: [],
      error: {
        reason: 'command_failed',
        // Redacted: a failure detail is retained and shown (FR-084).
        detail: `\`${command}\` exited ${result.exitCode}.\n${input.logs
          .clean(result.stderr.trim())
          .slice(0, 4000)}`,
      },
    };
  }

  return {
    status: 'done',
    costUsd: '0.0000',
    durationS,
    summary: `\`${command}\` passed`,
    outputs: [],
  };
}
