/**
 * How the shipped default agents and pipelines are SHOWN (FR-028).
 *
 * They are installed under their shipped names — "Spec", "Standard" — and
 * matched by those names whenever defaults are installed again, so renaming
 * the rows would make the next install create a second set. The names are
 * copy all the same, and copy belongs to the catalogue: on a Mongolian
 * deployment "Spec" reads "Тодорхойлолт агент", as the design draws it.
 *
 * So the rows keep their names and this is where a shipped name becomes the
 * catalogue's. Only the exact shipped names are touched: an agent somebody
 * made, or a default somebody renamed, is shown as they named it. That is
 * what keeps this from being the name map `step-kind.ts` warns about — it
 * reads nothing INTO a name, it only translates the eight the product ships.
 *
 * The names below are the ones in `services/agent-defaults.ts` and
 * `services/pipeline-defaults.ts`, copied rather than imported because those
 * modules carry the agents' full prompts and this one is loaded by the
 * browser. `tests/unit/default-names.test.ts` fails if the two lists part.
 */

import type { Messages } from './i18n';
import { m as current } from './i18n';

export const SHIPPED_AGENTS = {
  Spec: 'spec',
  Design: 'design',
  Plan: 'plan',
  Tasks: 'tasks',
  Implement: 'implement',
} as const;

export const SHIPPED_PIPELINES = {
  'Quick fix': 'quickFix',
  Standard: 'standard',
  'Review-heavy': 'reviewHeavy',
} as const;

type AgentKey = (typeof SHIPPED_AGENTS)[keyof typeof SHIPPED_AGENTS];
type PipelineKey = (typeof SHIPPED_PIPELINES)[keyof typeof SHIPPED_PIPELINES];

const agentKey = (name: string): AgentKey | undefined =>
  (SHIPPED_AGENTS as Record<string, AgentKey>)[name];
const pipelineKey = (name: string): PipelineKey | undefined =>
  (SHIPPED_PIPELINES as Record<string, PipelineKey>)[name];

/** An agent's name, as its card and its editor show it. */
export function agentName(name: string, m: Messages = current): string {
  const key = agentKey(name);
  return key ? m.defaults.agents[key].name : name;
}

/** A shipped agent's description, when it is still the shipped one. */
export function agentDescription(
  name: string,
  description: string | null,
  m: Messages = current,
): string | null {
  const key = agentKey(name);
  return key && description === ENGLISH_AGENT_DESCRIPTIONS[key]
    ? m.defaults.agents[key].description
    : description;
}

/** The label of a step an agent runs — "Хөгжүүлэлт" — on a step track or a board card. */
export function stepName(name: string, m: Messages = current): string {
  const key = agentKey(name);
  return key ? m.defaults.agents[key].step : name;
}

/** What a running step is doing, in words: "Хөгжүүлж байна", "pen.dev дээр зурж байна". */
export function runningPhrase(name: string, type: string, m: Messages = current): string {
  const key = agentKey(name);
  if (key) return m.defaults.agents[key].running;
  if (type === 'design') return m.defaults.designRunning;
  return m.defaults.running(name);
}

export function pipelineName(name: string, m: Messages = current): string {
  const key = pipelineKey(name);
  return key ? m.defaults.pipelines[key].name : name;
}

export function pipelineDescription(
  name: string,
  description: string | null,
  m: Messages = current,
): string | null {
  const key = pipelineKey(name);
  return key && description === ENGLISH_PIPELINE_DESCRIPTIONS[key]
    ? m.defaults.pipelines[key].description
    : description;
}

/**
 * The shipped descriptions, as stored. A description is translated only while
 * it is still this text: one somebody rewrote is theirs.
 */
const ENGLISH_AGENT_DESCRIPTIONS: Record<AgentKey, string> = {
  spec: 'Turns a ticket into a specification.',
  design: 'Produces screens before any code is planned.',
  plan: 'Turns a specification into an approach.',
  tasks: 'Turns a plan into ordered, verifiable tasks.',
  implement: 'Writes the code and leaves the tests passing.',
};

const ENGLISH_PIPELINE_DESCRIPTIONS: Record<PipelineKey, string> = {
  quickFix: 'No checkpoints. For small, well-described changes you trust unattended.',
  standard: 'One checkpoint, after the plan, before any code is written.',
  reviewHeavy: 'A checkpoint after the specification, the plan, and the implementation.',
};

/**
 * A step of a run as a person reads it: a shipped agent's step in the
 * catalogue's words, a checkpoint or a notification by what it is, a shell
 * step by its command. The run stores the agent's name, or an English word
 * for a step with no agent; neither is what a Mongolian screen should show.
 */
export function stepTitle(step: { type: string; label: string }, m: Messages = current): string {
  switch (step.type) {
    case 'agent':
    case 'design':
      return stepName(step.label, m);
    case 'checkpoint':
    case 'notify':
      return m.stepKind[step.type];
    default:
      return step.label;
  }
}
