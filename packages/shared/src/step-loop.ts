import type { Step, StepCondition } from './snapshot';

/**
 * The orchestrator's ONLY logic: evaluate a step's condition, then branch on
 * its type. Nothing here knows what a specification, a design or a plan is —
 * that is what keeps one generic workflow serving every pipeline (FR-024,
 * Constitution Principle III).
 *
 * It lives here, typechecked and tested, and is mirrored into the workflow's
 * Code node (see orchestration/n8n/README.md).
 */

/** Facts a run has established. Today there is exactly one (FR-032b). */
export interface RunFacts {
  hasUi?: boolean;
}

export type StepDecision =
  | { action: 'run'; index: number; step: Step }
  | { action: 'skip'; index: number; step: Step; conditionNotMet: string }
  | { action: 'finish' };

/**
 * A condition is stated in words wherever a pipeline or a run is shown, never
 * as a code (FR-032f). Two phrasings, because they answer different
 * questions: what a step is waiting for, and what turned out not to be true.
 */
export const CONDITION_DESCRIPTION: Record<StepCondition, string | undefined> = {
  always: undefined,
  ticket_has_ui: 'зөвхөн энэ даалгавар интерфейс өөрчилдөг бол',
  ticket_has_no_ui: 'зөвхөн энэ даалгавар интерфейс өөрчилдөггүй бол',
};

/** The fact each condition depends on, for a message that names it. */
export const CONDITION_FACT: Record<StepCondition, string | undefined> = {
  always: undefined,
  ticket_has_ui: 'даалгавар интерфейс өөрчилдөг эсэх',
  ticket_has_no_ui: 'даалгавар интерфейс өөрчилдөг эсэх',
};

/** Why a step did not run, in the past tense — what a skipped step shows. */
const CONDITION_TEXT: Record<Exclude<StepCondition, 'always'>, string> = {
  ticket_has_ui: 'ticket has no UI change',
  ticket_has_no_ui: 'ticket changes the interface',
};

/** True when the condition holds. An unestablished fact reads as false. */
export function conditionHolds(condition: StepCondition, facts: RunFacts): boolean {
  switch (condition) {
    case 'always':
      return true;
    case 'ticket_has_ui':
      return facts.hasUi === true;
    case 'ticket_has_no_ui':
      return facts.hasUi !== true;
  }
}

/**
 * Decides what to do at `index`. A condition that does not hold yields `skip`
 * — recorded, never a failure, and the run continues (FR-110, FR-111).
 */
export function decideStep(steps: Step[], index: number, facts: RunFacts): StepDecision {
  if (index >= steps.length) return { action: 'finish' };
  const step = steps[index] as Step;
  if (conditionHolds(step.condition, facts)) {
    return { action: 'run', index, step };
  }
  return {
    action: 'skip',
    index,
    step,
    conditionNotMet: step.condition === 'always' ? 'never' : CONDITION_TEXT[step.condition],
  };
}

/**
 * Carries forward what a step established. The classification is the only
 * fact today, and it comes from the specification step (FR-099).
 */
export function applyStepResult(
  facts: RunFacts,
  // The whole step result, as the workflow has it. Only the classification
  // establishes a fact today; the rest is accepted and ignored so a caller
  // does not have to pick the field out first.
  result: { classification?: { has_ui: boolean; rationale?: string } },
): RunFacts {
  if (result.classification) return { ...facts, hasUi: result.classification.has_ui };
  return facts;
}

/**
 * Save-time validation: a condition must not depend on a fact that is not yet
 * established at that point (FR-032d), and a design step must not precede the
 * step that classifies the ticket (FR-032e).
 */
export interface PipelineProblem {
  index: number;
  message: string;
}

export function validateStepOrder(
  steps: Step[],
  /** Which step index establishes the classification — the specification step. */
  classifyingIndex: number | null,
): PipelineProblem[] {
  const problems: PipelineProblem[] = [];
  steps.forEach((step, index) => {
    const needsClassification = step.condition !== 'always';
    if (needsClassification && (classifyingIndex === null || index <= classifyingIndex)) {
      problems.push({
        index,
        message:
          `${index + 1}-р алхам ${CONDITION_DESCRIPTION[step.condition]} ажиллах боловч ` +
          `тэр үед ${CONDITION_FACT[step.condition]} хараахан мэдэгдээгүй байна. ` +
          'Тодорхойлолт бичдэг алхмын ард нь зөөнө үү.',
      });
    }
    if (step.type === 'design' && (classifyingIndex === null || index <= classifyingIndex)) {
      problems.push({
        index,
        message:
          `${index + 1}-р алхам бол дизайн алхам боловч даалгавар интерфейс өөрчилдөг эсэхийг ` +
          'шийддэг тодорхойлолтын алхмаас өмнө байна. Ард нь зөөнө үү.',
      });
    }
  });
  return problems;
}
