import type { Step } from '@factory/shared';
import { agentStep } from './agent-defaults';

/**
 * Three shipped pipelines differing only in how much human oversight they
 * impose (FR-034).
 *
 * None carries a verification command, because that command is
 * repository-specific and the system never infers one (FR-034a, FR-055b). The
 * consequence is deliberate and must be visible: until an author adds a shell
 * step, nothing beyond the implementing agent checks the result — which is
 * what `verifies()` below reports and SC-016 measures.
 */

export interface DefaultPipeline {
  slug: string;
  name: string;
  description: string;
  steps: Step[];
}

const gate = (approvers: 'anyone' | 'ticket_creator' = 'anyone'): Step => ({
  type: 'checkpoint',
  condition: 'always',
  approvers,
  timeout_hours: undefined,
  on_timeout: 'wait',
});

export const DEFAULT_PIPELINES: DefaultPipeline[] = [
  {
    slug: 'quick-fix',
    name: 'Quick fix',
    description: 'No checkpoints. For small, well-described changes you trust unattended.',
    steps: [agentStep('spec'), agentStep('plan'), agentStep('tasks'), agentStep('implement')],
  },
  {
    slug: 'standard',
    name: 'Standard',
    description: 'One checkpoint, after the plan, before any code is written.',
    steps: [
      agentStep('spec'),
      agentStep('plan'),
      gate(),
      agentStep('tasks'),
      agentStep('implement'),
    ],
  },
  {
    slug: 'review-heavy',
    name: 'Review-heavy',
    description: 'A checkpoint after the specification, the plan, and the implementation.',
    steps: [
      agentStep('spec'),
      gate(),
      agentStep('plan'),
      gate(),
      agentStep('tasks'),
      agentStep('implement'),
      gate(),
    ],
  },
];

/**
 * Whether a pipeline checks its own result. A pipeline verifies only if an
 * author added a shell step (FR-055a); this is what the builder and the
 * pre-flight preview must make plain (FR-034a, SC-016).
 */
export function verifies(steps: Step[]): boolean {
  return steps.some((step) => step.type === 'shell' && Boolean(step.command));
}
