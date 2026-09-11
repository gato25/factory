import type { Step } from '@factory/shared';

/**
 * The shipped defaults, so a workspace produces a merge request with nothing
 * configured (FR-033). Model identifiers are exact and carry no date suffix.
 * Contracts are those in contracts/step-engines.md.
 */

export interface DefaultAgent {
  slug: string;
  name: string;
  description: string;
  icon: string;
  engine: 'claude_cli' | 'design_cli';
  model: string;
  systemPrompt: string;
  allowedTools: string[];
  outputFiles: string[];
}

const SPEC_PROMPT = `You write the specification for one ticket.

Read the ticket's title, description and acceptance criteria. Write
\`docs/spec.md\` containing: the goal, what is in scope, what is explicitly out
of scope, the acceptance criteria restated in your own words, and any open
question resolved by a stated assumption rather than left open.

End the document with exactly this block, and nothing after it:

\`\`\`factory
has_ui: true | false
rationale: <one sentence>
\`\`\`

\`has_ui\` is true when a person using the product would see something new or
different, and false when the change is not visible to them — a migration, a
job, an internal API. Nobody asked the ticket's author to decide this: you are
deciding it, and the rationale is the sentence they will read when a design
step runs or is skipped because of your answer.

Write nothing else. Do not plan the work and do not touch code.`;

const DESIGN_PROMPT = `You design the screens for one ticket.

Read \`docs/spec.md\` and the ticket's acceptance criteria. Produce an editable
design source and one exported image per screen. Design only what the ticket
asks for; a screen the acceptance criteria do not mention does not belong.`;

const PLAN_PROMPT = `You plan the implementation for one ticket.

Read \`docs/spec.md\`, and the design screens if any exist. Explore the
repository read-only to learn how it is actually built. Write \`docs/plan.md\`
containing: the approach, the files you will change and why, any data change,
and the risks. Where a design exists, plan to build the interface to match it.

Do not write code.`;

const TASKS_PROMPT = `You break one plan into ordered tasks.

Read \`docs/spec.md\` and \`docs/plan.md\`. Write \`docs/tasks.md\` as an ordered
list of small tasks, each with the verification that shows it is done. A task
that cannot be verified is too vague — split it or state its check.

Do not write code.`;

const IMPLEMENT_PROMPT = `You implement one ticket.

Read \`docs/spec.md\`, \`docs/plan.md\`, \`docs/tasks.md\`, and the design screens
if any exist. Work through the tasks in order, committing once per task with a
message of the form \`feat(#<ticket>): <task>\`.

You are responsible for leaving the repository's tests passing within this
step, using the tools you have been permitted. Find how this repository runs
its tests — its own scripts, not an assumed command — run them, and fix what
you break. Nothing downstream will do it for you: there is no verification
stage after this one, and a step that ends with the tests red has not
finished. Where a design exists, build the interface to match it.`;

export const DEFAULT_AGENTS: DefaultAgent[] = [
  {
    slug: 'spec',
    name: 'Spec',
    description: 'Turns a ticket into a specification.',
    icon: 'file-text',
    engine: 'claude_cli',
    model: 'claude-sonnet-5',
    systemPrompt: SPEC_PROMPT,
    allowedTools: ['Read', 'Write'],
    outputFiles: ['docs/spec.md'],
  },
  {
    // Ships as an agent from user story 1 (FR-033). The default pipelines
    // below gain a conditional design step in user story 5, once the
    // orchestrator evaluates conditions (T141) — until then a design step
    // would run on every ticket.
    slug: 'design',
    name: 'Design',
    description: 'Produces screens before any code is planned.',
    icon: 'palette',
    engine: 'design_cli',
    model: 'pen-default',
    systemPrompt: DESIGN_PROMPT,
    // Tool permissions do not apply to this engine (FR-036a).
    allowedTools: [],
    outputFiles: ['docs/design/ui.pen'],
  },
  {
    slug: 'plan',
    name: 'Plan',
    description: 'Turns a specification into an approach.',
    icon: 'map',
    engine: 'claude_cli',
    model: 'claude-opus-5',
    systemPrompt: PLAN_PROMPT,
    allowedTools: ['Read', 'Write', 'Bash'],
    outputFiles: ['docs/plan.md'],
  },
  {
    slug: 'tasks',
    name: 'Tasks',
    description: 'Turns a plan into ordered, verifiable tasks.',
    icon: 'list-checks',
    engine: 'claude_cli',
    model: 'claude-sonnet-5',
    systemPrompt: TASKS_PROMPT,
    allowedTools: ['Read', 'Write'],
    outputFiles: ['docs/tasks.md'],
  },
  {
    slug: 'implement',
    name: 'Implement',
    description: 'Writes the code and leaves the tests passing.',
    icon: 'code',
    engine: 'claude_cli',
    model: 'claude-opus-5',
    systemPrompt: IMPLEMENT_PROMPT,
    allowedTools: ['Read', 'Edit', 'Bash', 'GitPush'],
    outputFiles: [],
  },
];

export function defaultAgent(slug: string): DefaultAgent {
  const found = DEFAULT_AGENTS.find((a) => a.slug === slug);
  if (!found) throw new Error(`no default agent named ${slug}`);
  return found;
}

/** An agent step built from a shipped default. */
export function agentStep(slug: string, extra: Partial<Step> = {}): Step {
  const agent = defaultAgent(slug);
  return {
    type: 'agent',
    condition: 'always',
    agent_id: agent.slug,
    output_files: agent.outputFiles,
    ...extra,
  };
}
