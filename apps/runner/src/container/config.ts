import type { PipelineSnapshot, SnapshotAgent } from '@factory/shared';
import type { ContainerHost } from './host';

/**
 * Each agent's system prompt and each attached skill are written into the
 * workspace, with the run's actual values substituted for the prompt
 * variables (FR-037). Skills come from the snapshot, so editing one later
 * cannot reach a run in flight.
 */

export interface SubstitutionContext {
  snapshot: PipelineSnapshot;
  /** Present after a change request (FR-038). */
  feedback?: string;
  /** Available after the specification step has classified the ticket. */
  hasUi?: boolean;
  /** Exported image paths; empty when no design step ran. */
  designScreens?: string[];
}

/** The variables in spec §8.3, plus the two the design stage added. */
export function substitute(template: string, context: SubstitutionContext): string {
  const { snapshot } = context;
  const values: Record<string, string> = {
    'ticket.id': snapshot.ticket.reference,
    'ticket.title': snapshot.ticket.title,
    'ticket.description': snapshot.ticket.description ?? '',
    'ticket.acceptance': snapshot.ticket.acceptance_criteria.map((line) => `- ${line}`).join('\n'),
    'ticket.has_ui': context.hasUi === undefined ? '' : String(context.hasUi),
    'repo.name':
      snapshot.repo.clone_url
        .split('/')
        .pop()
        ?.replace(/\.git$/, '') ?? '',
    'repo.branch': snapshot.repo.branch,
    'repo.default_branch': snapshot.repo.default_branch,
    'run.attempt': String(snapshot.attempt),
    feedback: context.feedback ?? '',
    'design.screens': (context.designScreens ?? []).join('\n'),
  };

  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (whole, name: string) =>
    name in values ? (values[name] as string) : whole,
  );
}

export function agentSlug(agent: SnapshotAgent): string {
  return agent.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Writes the agent and skill files the CLI reads. Nothing here is a
 * credential: those are environment only (FR-083).
 */
export async function writeAgentConfig(
  host: ContainerHost,
  containerId: string,
  workdir: string,
  context: SubstitutionContext,
): Promise<void> {
  const { snapshot } = context;

  await host.exec(containerId, [
    'mkdir',
    '-p',
    `${workdir}/.claude/agents`,
    `${workdir}/.claude/skills`,
    `${workdir}/.factory`,
  ]);

  // A change request re-runs the preceding step; the reviewer's words are put
  // where the agent can read them, not only interpolated into a prompt that
  // may not mention {{feedback}} at all (FR-038).
  if (context.feedback?.trim()) {
    await host.writeFile(
      containerId,
      `${workdir}/.factory/feedback.md`,
      `# Requested changes\n\nA reviewer read your last output and asked for changes:\n\n${context.feedback.trim()}\n`,
    );
  }

  // Ticket context, so a step can read it without us re-templating everything.
  await host.writeFile(
    containerId,
    `${workdir}/.factory/ticket.json`,
    `${JSON.stringify(
      {
        reference: snapshot.ticket.reference,
        title: snapshot.ticket.title,
        description: snapshot.ticket.description,
        acceptance_criteria: snapshot.ticket.acceptance_criteria,
        branch: snapshot.repo.branch,
        attempt: snapshot.attempt,
        has_ui: context.hasUi ?? null,
        feedback: context.feedback?.trim() || null,
      },
      null,
      2,
    )}\n`,
  );

  for (const agent of snapshot.agents) {
    await host.writeFile(
      containerId,
      `${workdir}/.claude/agents/${agentSlug(agent)}.md`,
      `${substitute(agent.system_prompt, context)}\n`,
    );
    for (const skill of agent.skills) {
      await host.exec(containerId, ['mkdir', '-p', `${workdir}/.claude/skills/${skill.name}`]);
      await host.writeFile(
        containerId,
        `${workdir}/.claude/skills/${skill.name}/SKILL.md`,
        `---\nname: ${skill.name}\ndescription: ${skill.description}\n---\n\n${substitute(
          skill.content,
          context,
        )}\n`,
      );
    }
  }
}
