import { type SnapshotAgent, type Step, ticketDocsDir } from '@factory/shared';

export { ticketDocsDir };

/*
 * Where one ticket's documents live on its branch.
 *
 * Every ticket used to write `docs/spec.md` and `docs/plan.md`. On a
 * repository a previous ticket had already been merged into, the new run
 * cloned those files, the specification agent found a specification already
 * there, and the output check — which asks only that the file exist — passed
 * it. The new ticket was planned and built from the OLD ticket's spec.
 *
 * So each ticket's specification and plan go in its own folder, and those of
 * earlier tickets stay in the repository as the record of what was asked.
 *
 * Only those two. The design is one source the product grows ticket by
 * ticket, so every ticket updates the same `docs/design/ui.pen`; and the task
 * list is the working checklist of whichever ticket is in flight.
 */

/**
 * The shipped document paths, which agents and pipelines saved before this
 * existed still name literally. Mapped as well as the placeholder, so those
 * rows are fixed without anybody having to reset them. Only these: a path an
 * author chose for themselves is theirs.
 */
const SHIPPED = /(^|[^\w/.-])docs\/(spec\.md|plan\.md)/g;

export function toTicketDocs(text: string, dir: string): string {
  return text
    .replace(/\{\{\s*ticket\.docs\s*\}\}/g, dir)
    .replace(SHIPPED, (_whole, before: string, rest: string) => `${before}${dir}/${rest}`);
}

/** The pipeline's steps, writing their specification and plan into the ticket's folder. */
export function ticketSteps(steps: Step[], dir: string): Step[] {
  return steps.map((step) =>
    step.output_files
      ? { ...step, output_files: step.output_files.map((path) => toTicketDocs(path, dir)) }
      : step,
  );
}

/** An agent's instructions and skills, naming the ticket's folder. */
export function ticketAgent(agent: SnapshotAgent, dir: string): SnapshotAgent {
  return {
    ...agent,
    system_prompt: toTicketDocs(agent.system_prompt, dir),
    skills: agent.skills.map((skill) => ({ ...skill, content: toTicketDocs(skill.content, dir) })),
  };
}
