import {
  FactoryError,
  type PipelineSnapshot,
  type SnapshotAgent,
  type Step,
  type StepOutcome,
} from '@factory/shared';
import { agentSlug, substitute } from '../container/config';
import { GUARD_SETTINGS_PATH } from '../container/guard';
import type { ContainerHost } from '../container/host';
import { needsIsolation } from '../container/isolate';
import { WORKDIR } from '../container/start';
import { checkRequiredOutputs } from '../outputs/check';
import { parseClassification } from '../outputs/classification';
import type { LogSink } from '../stream/logs';
import { ClaudeStreamRenderer, Heartbeat } from './claude-stream';
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

/**
 * The two names for one permission: may this agent run a command.
 *
 * A person permits `Bash`, because that is what the tool is called nearly
 * everywhere. On Windows the CLI offers `PowerShell` instead, and an agent
 * permitted only `Bash` there reaches for a tool it may not use and is
 * refused — silently, because in `-p` mode a refusal is not a prompt. So the
 * permission is read as what it means and written as what the sandbox calls
 * it. It grants nothing new: an agent permitted no shell at all is still
 * permitted none.
 */
const SHELL_TOOLS: Record<'posix' | 'windows', string> = {
  posix: 'Bash',
  windows: 'PowerShell',
};

export function shellToolsFor(permitted: string[], shell: 'posix' | 'windows'): string[] {
  const wantsShell = Object.values(SHELL_TOOLS).some((tool) => permitted.includes(tool));
  if (!wantsShell) return permitted;
  const named = SHELL_TOOLS[shell];
  return permitted.includes(named) ? permitted : [...permitted, named];
}

export function buildArgv(
  input: ClaudeStepInput,
  prompt: string,
  shell: 'posix' | 'windows' = 'posix',
): string[] {
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
    // The command guard (`container/guard.ts`). Passed here rather than left
    // in the workspace's own `.claude/settings.json`: this takes precedence
    // over whatever the cloned repository ships, and it applies whether or
    // not the trust dialog has been accepted for the directory.
    '--settings',
    GUARD_SETTINGS_PATH,
  ];
  // Tool permissions do not apply to the design engine (FR-036a). The
  // snapshot already empties them, and this holds the claim here too rather
  // than depending on that having happened.
  const permitted =
    input.agent.engine === 'design_cli' ? [] : shellToolsFor(input.agent.allowed_tools, shell);
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

/**
 * What a person is told when the CLI exits non-zero (FR-084).
 *
 * `stderr` first, because a crash lands there. But the CLI says its most
 * actionable refusals on STDOUT and exits 1 with stderr empty — a spend limit
 * reached, a session limit, a model not available to the account. The detail
 * then fell back to "the CLI exited 1", which names nothing anybody can act
 * on, while the sentence that did ("You've hit your org's monthly spend limit
 * · ask your admin to raise it") sat in the step's own log one pane away.
 *
 * So: stderr, else the assistant's last words, else the tail of stdout. The
 * tail rather than the head, because a refusal is the last thing printed and
 * the banner is the first.
 */
export function failureDetail(
  logs: Pick<LogSink, 'clean'>,
  result: { exitCode: number; stdout: string; stderr: string },
  rendered: Pick<ClaudeStreamRenderer, 'resultText'>,
): string {
  const stderr = logs.clean(result.stderr.trim()).trim();
  if (stderr) return stderr.slice(0, 4000);

  const spoken = logs.clean((rendered.resultText ?? '').trim()).trim();
  if (spoken) return spoken.slice(0, 4000);

  const tail = logs
    .clean(result.stdout.trim())
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-20)
    .join('\n')
    .trim();
  return tail ? tail.slice(-4000) : `the CLI exited ${result.exitCode}`;
}

export async function runClaudeStep(
  host: ContainerHost,
  input: ClaudeStepInput,
): Promise<StepOutcome> {
  const started = Date.now();
  const prompt = buildPrompt(input);

  /**
   * Where this step's command runs, and therefore which shell it will find.
   *
   * An isolated step runs in the Linux sandbox image whatever this machine
   * is, so the CLI there offers `Bash` and not `PowerShell`. Asking the host
   * for its shell would name the machine's, and an agent permitted a tool by
   * a name its CLI does not use is refused silently in `-p` mode.
   */
  const isolated = host.execIsolated !== undefined && needsIsolation(input.agent);
  const argv = buildArgv(input, prompt, isolated ? 'posix' : (host.shell ?? 'posix'));
  const execute = isolated
    ? (host.execIsolated as NonNullable<typeof host.execIsolated>).bind(host)
    : host.exec.bind(host);

  // The agent's own limits, capped at what the run may still consume (FR-080).
  const limits = effectiveLimits(input.agent, input.snapshot.limits, input.spentSoFarUsd);
  const rendered = new ClaudeStreamRenderer((text) => input.logs.write('stdout', text));
  // A line every half minute of silence, so a long turn is not mistaken for
  // a step that has stopped (FR-076).
  const heartbeat = new Heartbeat(
    (text) => input.logs.write('stdout', text),
    () => rendered.progress(),
  );
  heartbeat.start();
  let result: Awaited<ReturnType<typeof host.exec>>;
  try {
    result = await execute(input.containerId, argv, {
      cwd: WORKDIR,
      timeoutMs: timeoutMsFor(limits),
      onOutput: (stream, text) => {
        heartbeat.activity();
        if (stream === 'stdout') rendered.feed(text);
        else input.logs.write('stderr', text);
      },
    });
  } finally {
    heartbeat.stop();
  }
  rendered.end();
  input.logs.end();

  // Cost comes from what the engine reported, never from our own estimate.
  // The result event when there was one; the raw output otherwise, which is
  // what a CLI printing a single object, or nothing readable, comes down to.
  const usage = usageFromClaudeJson(rendered.resultJson ?? result.stdout);
  const durationS = Math.max(1, Math.round((usage.durationMs ?? Date.now() - started) / 1000));

  if (result.exitCode !== 0) {
    /**
     * A step stopped before it reported says so.
     *
     * Cost lives only in the CLI's final result event, and a step killed at
     * its deadline never emits one, so `usage.costUsd` here is $0.0000 —
     * which is indistinguishable from a step that really was free. FR-108
     * forbids substituting an estimate, and rightly: a guessed number would
     * be enforced against a ceiling. So the zero stands, and this names it
     * instead, with the turns and tokens the stream did report.
     */
    const unreported =
      rendered.resultJson === null && rendered.observed()
        ? ` It was stopped before reporting its cost, so this step is recorded at ` +
          `$0.0000 although it ran ${rendered.observed()}.`
        : '';
    const outcome = applyLimits(
      {
        status: 'failed',
        costUsd: usage.costUsd,
        durationS,
        sessionId: usage.sessionId,
        outputs: [],
        error: {
          reason: 'command_failed',
          // Redacted: a failure detail is retained and shown (FR-084).
          detail: failureDetail(input.logs, result, rendered),
        },
      },
      limits,
      { agentName: input.agent.name, exitCode: result.exitCode },
    );
    return unreported && outcome.error
      ? { ...outcome, error: { ...outcome.error, detail: outcome.error.detail + unreported } }
      : outcome;
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
