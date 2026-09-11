import { createClient, type Database } from '@factory/db';
import {
  agents,
  credentials,
  pipelines,
  pipelineVersions,
  repositories,
  runs,
  tickets,
  users,
  workspaces,
} from '@factory/db/schema';
import type { ApproverRule, Step, TimeoutBehaviour } from '@factory/shared';
import { sql } from 'drizzle-orm';

export function connect() {
  return createClient(
    process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/factory_test',
  );
}

export async function reset(db: Database) {
  await db.execute(sql`truncate table log_chunks, artifacts, approvals, step_results, runs,
    tickets, pipeline_versions, pipelines, agent_skills, agents, skill_versions, skills,
    repositories, credentials, users, workspaces cascade`);
}

function only<T>(rows: T[], what: string): T {
  const row = rows[0];
  if (!row) throw new Error(`expected one ${what}`);
  return row;
}

export interface Scenario {
  workspaceId: string;
  userId: string;
  repositoryId: string;
  pipelineId: string;
  pipelineVersion: number;
  specAgentId: string;
  implementAgentId: string;
  ticketId: string;
}

/** A workspace with one repository, one pipeline and one queued ticket. */
export async function seed(
  db: Database,
  options: { steps?: (specId: string, implId: string) => Step[]; agentCostUsd?: string } = {},
): Promise<Scenario> {
  await reset(db);

  const workspace = only(
    await db
      .insert(workspaces)
      .values({ name: 'Netgroup', defaultCostCeilingUsd: '5.0000', defaultTimeCeilingMinutes: 45 })
      .returning(),
    'workspace',
  );
  const user = only(
    await db.insert(users).values({ name: 'Bat', email: 'bat@netgroup.mn' }).returning(),
    'user',
  );
  const credential = only(
    await db
      .insert(credentials)
      .values({ kind: 'git', ciphertext: 'sealed', keyVersion: 'v1', status: 'valid' })
      .returning(),
    'credential',
  );
  const repository = only(
    await db
      .insert(repositories)
      .values({
        name: 'shop-frontend',
        fullPath: 'netgroup/shop-frontend',
        provider: 'gitlab',
        cloneUrl: 'https://gitlab.com/netgroup/shop-frontend.git',
        defaultBranch: 'main',
        credentialId: credential.id,
        status: 'connected',
      })
      .returning(),
    'repository',
  );
  const spec = only(
    await db
      .insert(agents)
      .values({
        name: 'Spec',
        kind: 'default',
        engine: 'claude_cli',
        model: 'claude-sonnet-5',
        systemPrompt: 'write docs/spec.md',
        allowedTools: ['Read', 'Write'],
        maxCostUsd: options.agentCostUsd ?? null,
      })
      .returning(),
    'spec agent',
  );
  const implement = only(
    await db
      .insert(agents)
      .values({
        name: 'Implement',
        kind: 'default',
        engine: 'claude_cli',
        model: 'claude-opus-5',
        systemPrompt: 'write the code',
        allowedTools: ['Read', 'Edit', 'Bash', 'GitPush'],
      })
      .returning(),
    'implement agent',
  );
  const pipeline = only(
    await db.insert(pipelines).values({ name: 'Standard', currentVersion: 1 }).returning(),
    'pipeline',
  );
  const steps: Step[] = options.steps?.(spec.id, implement.id) ?? [
    { type: 'agent', condition: 'always', agent_id: spec.id, output_files: ['docs/spec.md'] },
    { type: 'agent', condition: 'always', agent_id: implement.id, output_files: [] },
  ];
  await db.insert(pipelineVersions).values({ pipelineId: pipeline.id, version: 1, steps });
  await db
    .update(repositories)
    .set({ defaultPipelineId: pipeline.id })
    .where(sql`${repositories.id} = ${repository.id}::uuid`);

  const ticket = only(
    await db
      .insert(tickets)
      .values({
        repositoryId: repository.id,
        createdBy: user.id,
        reference: '#142',
        title: 'Add Google OAuth sign-in',
        description: 'Users should be able to sign in with Google.',
        acceptanceCriteria: ['A Google button appears on the sign-in screen', 'Tests pass'],
        pipelineId: pipeline.id,
        pipelineVersion: 1,
        status: 'queued',
        branchName: 'factory/142-add-google-oauth-sign-in',
      })
      .returning(),
    'ticket',
  );

  return {
    workspaceId: workspace.id,
    userId: user.id,
    repositoryId: repository.id,
    pipelineId: pipeline.id,
    pipelineVersion: 1,
    specAgentId: spec.id,
    implementAgentId: implement.id,
    ticketId: ticket.id,
  };
}

export { agents, pipelineVersions, runs, tickets };

/**
 * A three-step pipeline with a checkpoint in the middle, for gate tests:
 * spec agent -> checkpoint -> implement agent.
 */
export const withCheckpoint =
  (
    approvers: ApproverRule = 'anyone',
    timeoutHours?: number,
    onTimeout: TimeoutBehaviour = 'wait',
  ) =>
  (specId: string, implId: string): Step[] => [
    { type: 'agent', condition: 'always', agent_id: specId, output_files: ['docs/spec.md'] },
    {
      type: 'checkpoint',
      condition: 'always',
      approvers,
      timeout_hours: timeoutHours,
      on_timeout: onTimeout,
    },
    { type: 'agent', condition: 'always', agent_id: implId, output_files: [] },
  ];
