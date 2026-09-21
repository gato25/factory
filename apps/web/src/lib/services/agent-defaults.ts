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
  /**
   * The longest this agent's step may take, when that is shorter or longer
   * than the run's own ceiling would give it.
   *
   * Left unset, a step inherits the WHOLE run ceiling as its deadline, which
   * is right for the four agents that read and write a document and wrong
   * for the one that builds the feature. Raising the pipeline's ceiling
   * instead would hand the same larger number to every step.
   *
   * It is still capped by the run ceiling (FR-079a), so this cannot buy more
   * time than the pipeline allows — it only asks for more of it.
   */
  maxMinutes?: number;
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
you break. A step that ends with the tests red has not finished.

Verifying means running this repository's own scripts: its typecheck, its
tests, its build. That is all it means here. Do not start a development or
preview server, do not fetch a page over HTTP, and do not install a browser
or a screenshot tool. There is no display in this sandbox and no browser in
its image, so an attempt to look at the result costs the whole of your time
limit and returns nothing. One run spent most of a forty-five minute limit
on exactly that and was killed with the work unfinished.

Where a design exists, build the interface to match it. Read the exported
screens for what it looks like, and \`docs/design/ui.txt\` for what it is
made of — that file is the design resolved into tokens and a tree, and it
carries the exact colours, spacing and type sizes a PNG cannot. Do not
write a parser for \`docs/design/ui.pen\`: it is a component tree of
variable references and per-instance override maps, the resolved form is
already sitting next to it, and doing that work by hand is a long detour
from the tasks.

A pipeline may install dependencies in a shell step before this one, so
check whether they are already there before installing them again. If a
tool you want is genuinely absent, say so and work without it rather than
building it yourself.`;

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
    // `Write` as well as `Edit`: this is the agent that creates files, and a
    // ticket on a new or nearly empty repository is all creation. Without it
    // every `Write` was refused — silently, as far as the step was concerned —
    // and the agent either improvised with a shell heredoc or gave up and
    // reported success having produced nothing.
    // No `GitPush`: pushing the branch is the execution service's own step
    // after the pipeline finishes, never a tool an agent calls.
    allowedTools: ['Read', 'Write', 'Edit', 'Bash'],
    outputFiles: [],
    // Building a feature is not the same size of job as writing a document.
    // The other four steps of the standard pipeline finish in a couple of
    // minutes each; this one is the work. It was being killed at the run's
    // 45-minute ceiling with the implementation half done.
    maxMinutes: 120,
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
