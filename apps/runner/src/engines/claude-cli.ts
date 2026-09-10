import {
  FactoryError,
  type PipelineSnapshot,
  type SnapshotAgent,
  type Step,
  type StepOutcome,
} from '@factory/shared';
import { agentSlug, substitute } from '../container/config';
import type { ContainerHost } from '../container/host';
import { WORKDIR } from '../container/start';
import { checkRequiredOutputs } from '../outputs/check';
import type { LogSink } from '../stream/logs';
import { usageFromClaudeJson } from './usage';

/**
 * An agent step is a headless CLI invocation (research.md D6). The working
 * directory is the workspace; the step prompt names the files to read and the
 * files to produce, and the workspace persists across steps, which is how work
 * is handed between them (FR-050).
 */

export interface ClaudeStepInput {
  step: Step;
  snapshot: PipelineSnapshot;
  agent: SnapshotAgent;
  containerId: string;
  logs: LogSink;
  feedback?: string;
  hasUi?: boolean;
  designScreens?: string[];
}

export function buildArgv(input: ClaudeStepInput, prompt: string): string[] {
  const argv = [
    'claude',
    '-p',
    prompt,
    '--output-format',
    'json',
    '--model',
    input.agent.model,
    '--append-system-prompt-file',
    `.claude/agents/${agentSlug(input.agent)}.md`,
  ];
  if (input.agent.allowed_tools.length > 0) {
    argv.push('--allowedTools', input.agent.allowed_tools.join(','));
  }
  if (input.agent.limits.max_turns) {
    argv.push('--max-turns', String(input.agent.limits.max_turns));
  }
  return argv;
}

export function buildPrompt(input: ClaudeStepInput): string {
  const outputs = input.step.output_files ?? [];
  const parts = [
    `Work on ticket ${input.snapshot.ticket.reference}: ${input.snapshot.ticket.title}.`,
    outputs.length > 0 ? `Produce: ${outputs.join(', ')}.` : '',
    input.designScreens?.length
      ? `Screens have already been designed and are at: ${input.designScreens.join(', ')}. ` +
        'Build the interface to match them.'
      : '',
    input.feedback
      ? `A reviewer requested changes. Their feedback:\n\n${input.feedback}\n\nAddress it.`
      : '',
  ];
  return substitute(parts.filter(Boolean).join('\n\n'), {
    snapshot: input.snapshot,
    feedback: input.feedback,
    hasUi: input.hasUi,
    designScreens: input.designScreens,
  });
}

export async function runClaudeStep(
  host: ContainerHost,
  input: ClaudeStepInput,
): Promise<StepOutcome> {
  const started = Date.now();
  const prompt = buildPrompt(input);
  const argv = buildArgv(input, prompt);

  const result = await host.exec(input.containerId, argv, {
    cwd: WORKDIR,
    timeoutMs: input.agent.limits.max_minutes ? input.agent.limits.max_minutes * 60_000 : undefined,
    onOutput: (stream, text) => input.logs.write(stream, text),
  });
  input.logs.end();

  // Cost comes from what the engine reported, never from our own estimate.
  const usage = usageFromClaudeJson(result.stdout);
  const durationS = Math.max(1, Math.round((usage.durationMs ?? Date.now() - started) / 1000));

  if (result.exitCode !== 0) {
    return {
      status: 'failed',
      costUsd: usage.costUsd,
      durationS,
      sessionId: usage.sessionId,
      outputs: [],
      error: {
        reason: 'command_failed',
        detail: result.stderr.trim().slice(0, 4000) || `the CLI exited ${result.exitCode}`,
      },
    };
  }

  try {
    await checkRequiredOutputs(host, input.containerId, WORKDIR, input.step.output_files ?? []);
  } catch (error) {
    return {
      status: 'failed',
      costUsd: usage.costUsd,
      durationS,
      sessionId: usage.sessionId,
      outputs: [],
      error: {
        reason: 'missing_output',
        detail: error instanceof FactoryError ? error.message : String(error),
      },
    };
  }

  return {
    status: 'done',
    costUsd: usage.costUsd,
    durationS,
    sessionId: usage.sessionId,
    summary: `${input.agent.name} finished in ${durationS}s`,
    outputs: (input.step.output_files ?? []).map((path) => ({
      kind: 'document' as const,
      path,
      version: 1,
    })),
  };
}
