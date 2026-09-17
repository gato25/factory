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
import { parseClassification } from '../outputs/classification';
import type { LogSink } from '../stream/logs';
import { ClaudeStreamRenderer } from './claude-stream';
import { applyLimits, effectiveLimits, timeoutMsFor } from './limits';
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
  /** What the run has already spent, so this step's limit is what is left. */
  spentSoFarUsd?: string;
  feedback?: string;
  hasUi?: boolean;
  designScreens?: string[];
}

export function buildArgv(input: ClaudeStepInput, prompt: string): string[] {
  const argv = [
    'claude',
    '-p',
    prompt,
    // One JSON line per event as the agent works, rendered into a legible
    // log by `ClaudeStreamRenderer`; the final `result` line is the same
    // object `--output-format json` used to print, and the cost is read from
    // it exactly as before. `--verbose` is required for the stream form.
    '--output-format',
    'stream-json',
    '--verbose',
    '--model',
    input.agent.model,
    '--append-system-prompt-file',
    `.claude/agents/${agentSlug(input.agent)}.md`,
  ];
  // Tool permissions do not apply to the design engine (FR-036a). The
  // snapshot already empties them, and this holds the claim here too rather
  // than depending on that having happened.
  const permitted = input.agent.engine === 'design_cli' ? [] : input.agent.allowed_tools;
  if (permitted.length > 0) {
    argv.push('--allowedTools', permitted.join(','));
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

  // The agent's own limits, capped at what the run may still consume (FR-080).
  const limits = effectiveLimits(input.agent, input.snapshot.limits, input.spentSoFarUsd);
  const rendered = new ClaudeStreamRenderer((text) => input.logs.write('stdout', text));
  const result = await host.exec(input.containerId, argv, {
    cwd: WORKDIR,
    timeoutMs: timeoutMsFor(limits),
    onOutput: (stream, text) =>
      stream === 'stdout' ? rendered.feed(text) : input.logs.write('stderr', text),
  });
  rendered.end();
  input.logs.end();

  // Cost comes from what the engine reported, never from our own estimate.
  // The result event when there was one; the raw output otherwise, which is
  // what a CLI printing a single object, or nothing readable, comes down to.
  const usage = usageFromClaudeJson(rendered.resultJson ?? result.stdout);
  const durationS = Math.max(1, Math.round((usage.durationMs ?? Date.now() - started) / 1000));

  if (result.exitCode !== 0) {
    return applyLimits(
      {
        status: 'failed',
        costUsd: usage.costUsd,
        durationS,
        sessionId: usage.sessionId,
        outputs: [],
        error: {
          reason: 'command_failed',
          // Redacted: a failure detail is retained and shown (FR-084).
          detail:
            input.logs.clean(result.stderr.trim()).slice(0, 4000) ||
            `the CLI exited ${result.exitCode}`,
        },
      },
      limits,
      { agentName: input.agent.name, exitCode: result.exitCode },
    );
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

  // The specification step also decides whether the ticket changes the
  // interface, in a block at the end of its document (FR-099). An
  // unparseable block returns nothing, and the app makes that visible rather
  // than guessing (FR-102).
  const classification = await classify(host, input);

  // A step that produced everything asked of it can still have overspent its
  // own limit; the limit is what a person needs told, not the output (FR-080).
  return applyLimits(
    {
      status: 'done',
      costUsd: usage.costUsd,
      durationS,
      sessionId: usage.sessionId,
      // The agent's own closing line where it wrote one — "Wrote docs/spec.md"
      // says more on a step card than the time it took.
      summary: rendered.resultText
        ? firstSentence(rendered.resultText)
        : `${input.agent.name} finished in ${durationS}s`,
      outputs: (input.step.output_files ?? []).map((path) => ({
        kind: 'document' as const,
        path,
        version: 1,
      })),
      ...(classification ? { classification } : {}),
    },
    limits,
    { agentName: input.agent.name, exitCode: 0 },
  );
}

/**
 * Reads the decision block out of whichever document the step produced. A
 * step that writes no document classifies nothing — the block lives in the
 * specification, not in the CLI's own output.
 */
async function classify(host: ContainerHost, input: ClaudeStepInput) {
  for (const path of input.step.output_files ?? []) {
    const content = await host.readFile(input.containerId, `${WORKDIR}/${path}`);
    const parsed = parseClassification(content);
    if (parsed) return parsed;
  }
  return null;
}

/** The first line of the agent's closing message, bounded for a card. */
function firstSentence(text: string): string {
  const line =
    text
      .split('\n')
      .find((candidate) => candidate.trim())
      ?.trim() ?? '';
  return line.length > 200 ? `${line.slice(0, 199)}…` : line;
}
