import {
  type DesignStepConfig,
  outline,
  type PenFile,
  type PipelineSnapshot,
  type SnapshotAgent,
  type Step,
  type StepOutcome,
} from '@factory/shared';
import { commitDesign } from '../container/commit';
import type { ContainerHost } from '../container/host';
import { WORKDIR } from '../container/start';
import { checkDesignOutputs, collectDesignOutputs } from '../outputs/design';
import type { LogSink } from '../stream/logs';
import { applyLimits, effectiveLimits, timeoutMsFor } from './limits';
import { usageFromDesignJson } from './usage';

/**
 * A design step invokes the design CLI in the workspace. It writes an editable
 * design source at the step's configured path and exports one image per
 * screen into the export directory (FR-103).
 *
 * Two things make it a step like any other rather than a special case: its
 * output streams as log chunks naming the command (FR-107), and its cost
 * comes from the tool's own reported usage and counts against the same
 * ceilings as everything else (FR-108). Tool permissions do not apply to
 * this engine (FR-036a).
 */

export const DEFAULT_DESIGN: DesignStepConfig = {
  source_path: 'docs/design/ui.pen',
  export_dir: 'docs/design/screens',
  export_scale: 2,
};

export interface DesignStepInput {
  step: Step;
  snapshot: PipelineSnapshot;
  agent: SnapshotAgent;
  containerId: string;
  logs: LogSink;
  /** What the run has already spent, so this step's limit is what is left. */
  spentSoFarUsd?: string;
  /** Present after a change request at a design gate (FR-061a, FR-038). */
  feedback?: string;
}

export function designConfig(step: Step): DesignStepConfig {
  return { ...DEFAULT_DESIGN, ...(step.design ?? {}) };
}

/** Where the tool writes what it spent, so we never estimate it (FR-108). */
const USAGE_PATH = '.factory/design-usage.json';

/** Where the brief is written, and attached from. */
const BRIEF_PATH = '.factory/design-brief.md';

/**
 * The single image the tool exports.
 *
 * FR-103 asks for one image per screen, and the tool does not offer that: it
 * exports "an image of the final result" to one path. So the step produces
 * one image of what was drawn, which is what `checkDesignOutputs` needs and
 * what a reviewer at the design gate looks at. Per-screen images need the
 * tool's batch mode and are not attempted here — a step that runs and
 * produces one reviewable image beats a step that produces nothing.
 */
export function exportPath(config: DesignStepConfig): string {
  return `${config.export_dir.replace(/\/+$/, '')}/ui.png`;
}

/**
 * The invocation, as the tool actually accepts it.
 *
 * This was written against an interface the CLI does not have — a `create`
 * subcommand with `--source`, `--export-dir`, `--brief` and `--screens`, none
 * of which exist. Every design step failed on its first line with "--out or
 * --export is required", and nothing caught it: no pipeline carried a design
 * step until now, and the tests compare this function's output against this
 * function's own expectations through a fake host, which is a test of our
 * intent and not of the tool.
 *
 * What the tool takes: `--in` an optional input file, `--out` the output file
 * (required), `--prompt` the instruction (required), `--prompt-file` files to
 * send with it, `--export` one image, `--export-scale`, `--export-type` and
 * `--usage`. Verified against 0.3.6 on a developer machine and 0.3.7 in the
 * sandbox image, which agree.
 */
export function buildDesignArgv(input: DesignStepInput, revising: boolean): string[] {
  const config = designConfig(input.step);
  return [
    'pen',
    // The repository the design is for.
    //
    // The tool runs an agent of its own, and that agent refuses to read
    // anything outside the folder it was given — "Path is outside allowed
    // working directories". Without this it was given none, so every read of
    // the project was denied and the first design drawn here was drawn from
    // the brief alone, against a home page it had never seen. It said so
    // itself in its closing note. A design step exists to change an interface
    // that already exists; it has to be able to look at it.
    '--repo',
    WORKDIR,
    // Revising reads the accepted design and writes it back to the same path,
    // which is FR-106: a step that runs again revises rather than replaces.
    // A first run has nothing to read and starts from an empty canvas.
    ...(revising ? ['--in', config.source_path] : []),
    '--out',
    config.source_path,
    // The instruction is required and is kept short on purpose: the brief is
    // attached whole, and this line is echoed into the step's log (FR-107),
    // where a ticket's entire brief would bury the command it is naming.
    '--prompt',
    revising
      ? 'Revise the attached design to address the brief. Change what the brief asks for and ' +
        'leave the rest as it is.'
      : 'Design the screens this ticket needs, following the attached brief.',
    '--prompt-file',
    BRIEF_PATH,
    '--export',
    exportPath(config),
    '--export-scale',
    String(config.export_scale),
    '--export-type',
    'png',
    '--usage',
    USAGE_PATH,
  ];
}

/**
 * What the tool is asked to draw. Written as a file rather than passed as an
 * argument so it can be as long as the ticket needs, and so the reviewer at
 * the design gate can see what the tool was actually told.
 */
export function buildBrief(input: DesignStepInput): string {
  const { ticket } = input.snapshot;
  const config = designConfig(input.step);
  const parts = [
    `# ${ticket.reference} ${ticket.title}`,
    ticket.description ?? '',
    ticket.acceptance_criteria.length > 0
      ? `## Acceptance criteria\n\n${ticket.acceptance_criteria.map((c) => `- ${c}`).join('\n')}`
      : '',
    // The screens a pipeline author named. They used to be a `--screens`
    // argument, which the tool has no such flag for; said here instead, where
    // the tool actually reads its instructions, so configuring them still
    // means something.
    config.screens?.length
      ? `## Screens to draw\n\n${config.screens.map((name) => `- ${name}`).join('\n')}`
      : '',
    // A revision must address the reviewer, not redraw from the ticket.
    input.feedback
      ? `## Requested changes\n\nA reviewer looked at the previous screens and asked for:\n\n${input.feedback}`
      : '',
    'Design only what the ticket asks for. A screen the acceptance criteria do not mention does not belong.',
  ];
  return `${parts.filter(Boolean).join('\n\n')}\n`;
}

export async function runDesignStep(
  host: ContainerHost,
  input: DesignStepInput,
): Promise<StepOutcome> {
  const started = Date.now();
  const config = designConfig(input.step);

  /**
   * FR-106 — whenever a design step runs again, whether from a change
   * request or a retry, the existing source is revised rather than replaced.
   * The source is on the branch (FR-105), so a retry that re-cloned it finds
   * it there; this is what keeps a reviewer's accepted work from being
   * silently redrawn.
   */
  const existing = await host.stat(input.containerId, `${WORKDIR}/${config.source_path}`);
  const revising = Boolean(existing && existing.size > 0);

  await host.exec(input.containerId, [
    'mkdir',
    '-p',
    `${WORKDIR}/${config.export_dir}`,
    // The source's own directory, which is only the same one by default: the
    // tool writes `--out` and does not make the path it was given.
    `${WORKDIR}/${config.source_path.slice(0, config.source_path.lastIndexOf('/')) || '.'}`,
    `${WORKDIR}/.factory`,
  ]);
  await host.writeFile(input.containerId, `${WORKDIR}/${BRIEF_PATH}`, buildBrief(input));

  const argv = buildDesignArgv(input, revising);
  // The command is named in the log, on the same terms as an agent step
  // (FR-107). It carries no credential: those are environment only (FR-083).
  input.logs.write('stdout', `$ ${argv.join(' ')}\n`);

  const limits = effectiveLimits(input.agent, input.snapshot.limits, input.spentSoFarUsd);
  const result = await host.exec(input.containerId, argv, {
    cwd: WORKDIR,
    timeoutMs: timeoutMsFor(limits),
    onOutput: (stream, text) => input.logs.write(stream, text),
  });
  input.logs.end();

  const usage = usageFromDesignJson(
    (await host.readFile(input.containerId, `${WORKDIR}/${USAGE_PATH}`)) ?? '',
  );
  const durationS = Math.max(1, Math.round((usage.durationMs ?? Date.now() - started) / 1000));

  if (result.exitCode !== 0) {
    // Whatever it drew before failing is retained (FR-104).
    const partial = await collectDesignOutputs(
      host,
      input.containerId,
      WORKDIR,
      config.source_path,
      config.export_dir,
    );
    return applyLimits(
      {
        status: 'failed',
        costUsd: usage.costUsd,
        durationS,
        outputs: outputsFor(partial.sourceExists ? config.source_path : null, partial.screens),
        error: {
          reason: rejectedCredential(result.stderr) ? 'credential_invalid' : 'command_failed',
          detail: rejectedCredential(result.stderr)
            ? 'The design service rejected its credential. An administrator can replace it ' +
              'under Settings → Design.'
            : input.logs.clean(result.stderr.trim()).slice(0, 4000) ||
              `the design tool exited ${result.exitCode}`,
        },
      },
      limits,
      { agentName: input.agent.name, exitCode: result.exitCode },
    );
  }

  let produced: { source: string; screens: string[] };
  try {
    produced = await checkDesignOutputs(
      host,
      input.containerId,
      WORKDIR,
      config.source_path,
      config.export_dir,
    );
  } catch (error) {
    // Retained, not discarded: a partial design is still worth looking at.
    const partial = await collectDesignOutputs(
      host,
      input.containerId,
      WORKDIR,
      config.source_path,
      config.export_dir,
    );
    return {
      status: 'failed',
      costUsd: usage.costUsd,
      durationS,
      outputs: outputsFor(partial.sourceExists ? config.source_path : null, partial.screens),
      error: {
        reason: 'missing_output',
        detail: error instanceof Error ? error.message : String(error),
      },
    };
  }

  // The design, resolved, written beside it as text.
  //
  // What the implementing agent is given otherwise is PNG exports, which
  // show what a screen looks like and carry none of its values — no hex, no
  // spacing, no type size. So it opens the `.pen` instead, and a `.pen` is
  // not a description of a screen: it is a component tree of `$variable`
  // references and per-instance override maps, and reading one means
  // writing the resolver in `@factory/shared`. A run was observed doing
  // exactly that, in `node -e` one-liners, and was killed at its deadline
  // with the feature half built. Resolving it here costs milliseconds and
  // happens once.
  //
  // Best-effort: a design that cannot be resolved is still a design, and
  // failing the step over its companion file would be the tail wagging the
  // dog. The reason lands in the log, where somebody can see it.
  const outlined = await writeOutline(host, input.containerId, produced.source, input.logs);

  // The source, the screens and the outline go onto the branch, so the
  // design travels with the code it describes (FR-105).
  await commitDesign(host, input.containerId, {
    reference: input.snapshot.ticket.reference,
    paths: [produced.source, ...(outlined ? [outlined] : []), ...produced.screens],
    revising,
  });

  return applyLimits(
    {
      status: 'done',
      costUsd: usage.costUsd,
      durationS,
      summary: `${revising ? 'Revised' : 'Designed'} ${produced.screens.length} screen${
        produced.screens.length === 1 ? '' : 's'
      }`,
      outputs: outputsFor(produced.source, produced.screens),
    },
    limits,
    { agentName: input.agent.name, exitCode: 0 },
  );
}

/** `docs/design/ui.pen` → `docs/design/ui.txt`. */
export function outlinePath(source: string): string {
  return source.replace(/\.pen$/i, '') + '.txt';
}

/**
 * Resolves the design the step just wrote and leaves it as text beside it.
 * Returns the path written, or nothing if it could not be.
 */
async function writeOutline(
  host: ContainerHost,
  containerId: string,
  source: string,
  logs: LogSink,
): Promise<string | null> {
  const path = outlinePath(source);
  try {
    const raw = await host.readFile(containerId, `${WORKDIR}/${source}`);
    if (!raw) return null;
    const text = outline(JSON.parse(raw) as PenFile);
    await host.writeFile(containerId, `${WORKDIR}/${path}`, text);
    logs.write('stdout', `✓ Resolved the design into ${path}\n`);
    return path;
  } catch (error) {
    logs.write(
      'stdout',
      `⚠ Could not resolve the design into text: ${
        error instanceof Error ? error.message : String(error)
      }\n`,
    );
    return null;
  }
}

/** The design source and each screen, as the app stores artifacts. */
function outputsFor(source: string | null, screens: string[]) {
  return [
    ...(source ? [{ kind: 'design_file' as const, path: source, version: 1 }] : []),
    ...screens.map((path) => ({
      kind: 'screen' as const,
      path,
      version: 1,
      screen_name: screenName(path),
    })),
  ];
}

/** `docs/design/screens/01-sign-in.png` → `sign in`. */
export function screenName(path: string): string {
  return (path.split('/').pop() ?? path)
    .replace(/\.(png|jpe?g|webp)$/i, '')
    .replace(/^\d+[-_]/, '')
    .replace(/[-_]+/g, ' ')
    .trim();
}

function rejectedCredential(stderr: string): boolean {
  return /401|403|unauthori[sz]ed|invalid api key|rejected/i.test(stderr);
}
