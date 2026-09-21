import {
  CONDITION_DESCRIPTION,
  CONDITION_FACT,
  invalidInput,
  type Step,
  validateStepOrder,
} from '@factory/shared';
import { m } from '$lib/i18n';

/**
 * The three refusals a save can meet (FR-028, FR-032d, FR-032e). Each names
 * the offending step and why, because a refusal a person cannot act on is
 * worse than no validation: they will simply delete the step that seemed to
 * cause it.
 *
 * Everything else about a pipeline is a matter of taste. These three are not:
 * each describes a pipeline that cannot do what it claims.
 */

export interface Problem {
  /** Which step, or null when the pipeline as a whole is the problem. */
  index: number | null;
  message: string;
}

/**
 * A step that writes code. Only an agent step can, and the ones that declare
 * required documents are producing those documents — the code-producing step
 * is the one whose output IS the repository, so it declares none. That is how
 * the shipped defaults are shaped, and it is a property of the steps
 * themselves, so the check needs no agent lookup.
 */
export function producesCode(step: Step): boolean {
  return step.type === 'agent' && (step.output_files?.length ?? 0) === 0;
}

/** The step expected to classify the ticket: the first that writes a document. */
export function classifyingIndex(steps: Step[]): number | null {
  const index = steps.findIndex(
    (step) => step.type === 'agent' && (step.output_files?.length ?? 0) > 0,
  );
  return index === -1 ? null : index;
}

/**
 * FR-028 — a pipeline with nothing that writes code cannot produce a merge
 * request, so saving it would promise something it cannot deliver. An agent
 * step that declares no required documents is the code-producing one: the
 * ones that declare documents are writing documents.
 */
function checkProducesCode(steps: Step[]): Problem[] {
  if (steps.some(producesCode)) return [];
  const documentOnly = steps.filter((step) => step.type === 'agent').length;
  return [
    {
      index: null,
      message: documentOnly
        ? 'This pipeline has no step that writes code — every agent step here declares ' +
          'documents it must produce, so all of them are writing documents. Add an agent ' +
          'step with no required documents, and put any verification, gate or notification ' +
          'after it.'
        : 'This pipeline has no step that writes code, so it cannot produce a merge request. ' +
          m.validate.addAgentStep,
    },
  ];
}

/**
 * FR-032d and FR-032e — a condition evaluated before the fact it depends on
 * is established always reads the same way, which makes it a lie rather than
 * a condition. The shared validator is the same code the orchestrator's loop
 * mirrors, so what is refused here is exactly what would misbehave there.
 */
function checkOrder(steps: Step[]): Problem[] {
  return validateStepOrder(steps, classifyingIndex(steps));
}

/** A gate's own settings have to be answerable (FR-032). */
function checkGates(steps: Step[]): Problem[] {
  const problems: Problem[] = [];
  steps.forEach((step, index) => {
    if (step.type !== 'checkpoint') return;
    if (Array.isArray(step.approvers) && step.approvers.length === 0) {
      problems.push({
        index,
        message:
          `Step ${index + 1} is a checkpoint whose approver list is empty, so nobody could ` +
          'ever decide it. Name someone, or let anyone in the workspace decide.',
      });
    }
    if (step.timeout_hours !== undefined && step.timeout_hours <= 0) {
      problems.push({
        index,
        message:
          `Step ${index + 1} waits ${step.timeout_hours} hours, which expires before anyone ` +
          'could look at it. Leave the waiting time empty to wait indefinitely.',
      });
    }
  });
  return problems;
}

/** A shell step with no command runs nothing and passes (FR-055b). */
function checkShell(steps: Step[]): Problem[] {
  return steps.flatMap((step, index) =>
    step.type === 'shell' && !step.command?.trim()
      ? [
          {
            index,
            message:
              `Step ${index + 1} is a shell command with no command, so it would pass without ` +
              'running anything. Give it the command this repository uses.',
          },
        ]
      : [],
  );
}

/** An agent step needs an agent to run (FR-025). */
function checkAgents(steps: Step[]): Problem[] {
  return steps.flatMap((step, index) =>
    (step.type === 'agent' || step.type === 'design') && !step.agent_id
      ? [
          {
            index,
            message: `Step ${index + 1} has no agent chosen. Pick one, or remove the step.`,
          },
        ]
      : [],
  );
}

export function problemsWith(steps: Step[]): Problem[] {
  if (steps.length === 0) {
    return [
      {
        index: null,
        message: 'A pipeline needs at least one step. Add one from the palette.',
      },
    ];
  }
  return [
    ...checkProducesCode(steps),
    ...checkOrder(steps),
    ...checkAgents(steps),
    ...checkGates(steps),
    ...checkShell(steps),
  ];
}

/** Throws with every problem, so a person fixes them in one pass. */
export function assertSavable(steps: Step[]): void {
  const problems = problemsWith(steps);
  if (problems.length === 0) return;
  throw invalidInput(
    problems.map((problem) => problem.message).join('\n'),
    JSON.stringify(problems),
  );
}

/**
 * What the builder shows beside a conditional step, in words (FR-032f). Here
 * rather than in a component so every surface says the same thing.
 */
export function conditionWords(step: Step): string | undefined {
  return CONDITION_DESCRIPTION[step.condition];
}
