import { type PipelineSnapshot, REQUIREMENTS_DIR, type SnapshotAgent } from '@factory/shared';
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
  /**
   * Requirement documents written into the sandbox, by name.
   *
   * The names rather than the content: the content is on disk where the agent
   * can read it, and putting several megabytes into a prompt variable would
   * charge for it on every step whether or not the step needed it.
   */
  requirementFiles?: string[];
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
    // A list of paths, so a prompt that mentions this points the agent at
    // the files rather than inlining them.
    'ticket.requirements': (context.requirementFiles ?? [])
      .map((name) => `- ${REQUIREMENTS_DIR}/${name}`)
      .join('\n'),
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
/**
 * Marks the workspace as trusted, because nobody is there to be asked.
 *
 * The CLI asks a person, once per directory, whether they trust it — and
 * until they say so it ignores that directory's `.claude/settings.local.json`
 * entirely. In a sandbox there is no person and no second chance: the CLI
 * writes `hasTrustDialogAccepted: false` on first start and then reports
 * `Ignoring N permissions.allow entries from .claude/settings.local.json`,
 * so every permission the repository grants itself is silently dropped and
 * the agent is refused tools it was meant to have. In `-p` mode a refusal is
 * not a prompt; it is simply a tool that does not work.
 *
 * Deciding it here is not a loosening. The sandbox is one container, built
 * for one run, holding one repository that somebody already connected on
 * purpose — the question the dialog asks has been answered by the act of
 * starting the run. What the agent may actually do is governed by the
 * agent's own allowed tools, which is a different mechanism and still applies.
 *
 * Written before the CLI first runs, and merged rather than replaced, so a
 * config the image ships with is not thrown away.
 */
async function trustWorkspace(
  host: ContainerHost,
  containerId: string,
  workdir: string,
): Promise<void> {
  const path = '$HOME/.claude.json';
  const script =
    `set -e; mkdir -p "$(dirname ${path})"; [ -f ${path} ] || echo '{}' > ${path}; ` +
    `WORKDIR=${JSON.stringify(workdir)} node -e '` +
    'const fs=require("fs");const p=process.env.HOME+"/.claude.json";' +
    'let c={};try{c=JSON.parse(fs.readFileSync(p,"utf8"))}catch{}' +
    'c.projects=c.projects||{};const w=process.env.WORKDIR;' +
    'c.projects[w]={...(c.projects[w]||{}),hasTrustDialogAccepted:true};' +
    'fs.writeFileSync(p,JSON.stringify(c,null,2));' +
    "'";
  // Not fatal: the run still works, with fewer permissions than the
  // repository asked for, and the CLI says so in its own output.
  await host.exec(containerId, ['sh', '-c', script]);
}

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

  await trustWorkspace(host, containerId, workdir);

  // Screens a design step produced are named where a following step will
  // look for them, not only interpolated into a prompt that may not mention
  // {{design.screens}} (FR-109).
  if (context.designScreens?.length) {
    await host.writeFile(
      containerId,
      `${workdir}/.factory/screens.md`,
      `# Designed screens\n\nThese were designed and reviewed before any code was planned. ` +
        `Build the interface to match them.\n\n${context.designScreens
          .map((path) => `- ${path}`)
          .join('\n')}\n`,
    );
  }

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
        // The screens a design step produced, so the planning and
        // implementing steps can read them (FR-109). Paths, not images: they
        // are on the branch, in the workspace these steps are working in.
        design_screens: context.designScreens ?? [],
        // Named here as well as in `.factory/requirements.md`, because a step
        // that reads this file should not have to know about a second one.
        requirement_files: (context.requirementFiles ?? []).map(
          (name) => `${REQUIREMENTS_DIR}/${name}`,
        ),
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
