#!/usr/bin/env bun
/**
 * A small, realistic workspace for looking at the screens.
 *
 * The development database accumulates browser-test debris — two hundred
 * repositories named `shop-<hex>`, a hundred tickets deliberately failed —
 * and a screen full of that cannot be compared to an artboard. This seeds
 * roughly what `design.pen` shows, so the two can be held side by side.
 *
 * Development only. It empties the database first.
 *
 * Note the `JSON.stringify(...)::jsonb` rather than `sql.json(...)`: the
 * driver's json helper throws under Bun, though it works under Node — which
 * is why the browser specs can use it and this cannot.
 *
 *   bun scripts/design/sample.ts
 */

import { createClient } from '@factory/db';
import { installDefaults } from '../../apps/web/src/lib/services/install-defaults';

const { db, sql } = createClient();

await sql`truncate table log_chunks, artifacts, approvals, step_results, runs,
  tickets, pipeline_versions, pipelines, agent_skills, agents, skill_versions, skills,
  repositories, credentials, users, workspaces cascade`;

const [workspace] = await sql`
  insert into workspaces (name, max_concurrent_runs, default_cost_ceiling_usd,
    default_time_ceiling_minutes)
  values ('Netgroup', 3, '5.0000', 45) returning id`;
if (!workspace) throw new Error('no workspace');

await installDefaults(db);

const [me] = await sql`
  insert into users (name, email, role)
  values ('Gantogtokh B.', 'gantogtokh.ba@netgroup.mn', 'admin') returning id`;
const [other] = await sql`
  insert into users (name, email, role) values ('Amina N.', 'amina@netgroup.mn', 'member')
  returning id`;

const [credential] = await sql`
  insert into credentials (kind, ciphertext, key_version, status)
  values ('git', 'sealed', 'v1', 'valid') returning id`;

const [standard] = await sql`select id from pipelines where name = 'Standard' limit 1`;

/** The four steps the design's progress bars and strips are drawn against. */
const STEPS = ['Spec', 'Plan', 'Tasks', 'Implement'] as const;
const agentRows = await sql`select id, name from agents`;
const agentIds = Object.fromEntries(
  STEPS.map((name) => [name, agentRows.find((row) => row.name === name)?.id as string]),
);
const [quick] = await sql`select id from pipelines where name = 'Quick fix' limit 1`;

const REPOS = [
  ['shop-frontend', 'netgroup/shop-frontend', 'gitlab', 'main', standard, 'connected'],
  ['billing-api', 'netgroup/billing-api', 'gitlab', 'main', standard, 'connected'],
  ['worker-service', 'netgroup/worker-service', 'github', 'main', quick, 'connected'],
  ['design-system', 'netgroup/design-system', 'github', 'trunk', standard, 'connected'],
  ['ops-scripts', 'netgroup/ops-scripts', 'gitlab', 'main', null, 'credential_expired'],
] as const;

const repoIds: Record<string, string> = {};
for (const [name, path, provider, branch, pipeline, status] of REPOS) {
  const [row] = await sql`
    insert into repositories (name, full_path, provider, clone_url, default_branch,
      credential_id, default_pipeline_id, status, status_detail)
    values (${name}, ${path}, ${provider}, ${`https://${provider}.com/${path}.git`}, ${branch},
      ${credential?.id ?? null}, ${(pipeline as { id: string } | null)?.id ?? null}, ${status},
      ${status === 'connected' ? null : 'A run could not authenticate. Replace the access token.'})
    returning id`;
  repoIds[name] = row?.id as string;
}

/** reference, title, repo, status, who, and what the strip should say. */
const TICKETS = [
  ['#145', 'Add a bulk export to the orders list', 'shop-frontend', 'draft', me],
  ['#146', 'Retry failed webhooks with backoff', 'billing-api', 'draft', other],
  ['#147', 'Drop the legacy session table', 'ops-scripts', 'draft', me],
  ['#142', 'Add OAuth login with Google', 'shop-frontend', 'running', me],
  ['#144', 'Migrate cron jobs to queue', 'worker-service', 'running', other],
  ['#140', 'Paginate the audit log', 'billing-api', 'running', me],
  ['#139', 'Fix invoice PDF rendering', 'billing-api', 'waiting_approval', other],
  ['#137', 'Tighten the rate limiter', 'worker-service', 'waiting_approval', me],
  ['#141', 'Move avatars to object storage', 'shop-frontend', 'done', me],
  ['#136', 'Add a health endpoint', 'worker-service', 'done', other],
  ['#135', 'Sort the settings alphabetically', 'design-system', 'done', me],
  ['#138', 'Split the billing webhook handler', 'billing-api', 'failed', other],
] as const;

for (const [reference, title, repo, status, who] of TICKETS) {
  const [ticket] = await sql`
    insert into tickets (repository_id, created_by, reference, title, description,
      acceptance_criteria, pipeline_id, pipeline_version, status, branch_name,
      merge_request_url, has_ui)
    values (${repoIds[repo] as string}, ${(who as { id: string }).id}, ${reference}, ${title},
      ${'Described by whoever raised it.'}, ${sql.array(['It works', 'Tests pass'])},
      ${standard?.id ?? null}, 1, ${status},
      ${`factory/${reference.slice(1)}`},
      ${status === 'done' ? `https://gitlab.com/netgroup/${repo}/-/merge_requests/91` : null},
      ${reference === '#142'})
    returning id`;
  if (!ticket) continue;

  if (['running', 'waiting_approval'].includes(status)) {
    const runStatus = status === 'running' ? 'running' : 'waiting_approval';
    const [run] = await sql`
      insert into runs (ticket_id, attempt, snapshot, status, current_step_index,
        cost_usd, cost_ceiling_usd, time_ceiling_minutes, started_at)
      values (${ticket.id}, 1, ${JSON.stringify({
        run_id: '00000000-0000-4000-8000-000000000000',
        attempt: 1,
        // Real steps, so a card's strip can name where the run is. Without
        // them the strip has nothing to say and the column reads as blank.
        pipeline: {
          id: standard?.id,
          version: 1,
          name: 'Standard',
          // A run waiting for approval is waiting AT a checkpoint, so the
          // snapshot has to contain one — screen 07 reads the step it is
          // paused at and refuses anything that is not a gate.
          steps:
            status === 'waiting_approval'
              ? [
                  ...STEPS.slice(0, 2).map((name) => ({
                    type: 'agent',
                    condition: 'always',
                    agent_id: agentIds[name],
                    output_files: [],
                  })),
                  { type: 'checkpoint', condition: 'always', approvers: 'anyone' },
                  ...STEPS.slice(2).map((name) => ({
                    type: 'agent',
                    condition: 'always',
                    agent_id: agentIds[name],
                    output_files: [],
                  })),
                ]
              : STEPS.map((name) => ({
                  type: 'agent',
                  condition: 'always',
                  agent_id: agentIds[name],
                  output_files: [],
                })),
        },
        agents: STEPS.map((name) => ({
          id: agentIds[name],
          name,
          engine: 'claude_cli',
          model: 'claude-sonnet-5',
          system_prompt: '',
          allowed_tools: [],
          skills: [],
          limits: {},
        })),
      })}::jsonb, ${runStatus}, ${status === 'running' ? 3 : 2}, '1.8400', '5.0000', 45, now())
      returning id`;
    if (!run) continue;
    await sql`update tickets set current_run_id = ${run.id} where id = ${ticket.id}`;

    // What the run has actually done, so screen 06 shows a tracker with
    // history behind it rather than five identical "waiting" circles.
    const reached = status === 'running' ? 4 : 2;
    const TOOK = [130, 161, 222, 65];
    const SPENT = ['0.1400', '0.4200', '0.5100', '0.0900'];
    const DOC = ['docs/spec.md', 'docs/plan.md', 'docs/tasks.md', null];
    for (let index = 0; index < reached; index += 1) {
      const running = status === 'running' && index === reached - 1;
      await sql`
        insert into step_results (run_id, step_index, status, started_at, finished_at,
          duration_s, cost_usd, summary)
        values (${run.id}, ${index}, ${running ? 'running' : 'done'},
          now() - interval '14 minutes', ${running ? null : new Date().toISOString()},
          ${running ? null : TOOK[index]}, ${running ? '0.3800' : SPENT[index]},
          ${running ? null : `${STEPS[index]} finished`})`;

      const path = DOC[index];
      if (!running && path) {
        await sql`
          insert into artifacts (run_id, step_index, kind, path, version, content)
          values (${run.id}, ${index}, 'document', ${path}, 1,
            ${`# ${STEPS[index]}\n\nWritten by the ${STEPS[index]} agent for ${reference}.`})`;
      }
    }

    if (status === 'running') {
      const LOG: [string, string][] = [
        ['stdout', 'Reading docs/tasks.md · 6 tasks found'],
        ['stdout', '✓ Task 1  Add the query parameters to the endpoint'],
        ['stdout', '✓ Task 2  Page the results in the repository layer'],
        ['stdout', '▶ Task 3  Write tests for the paging boundaries'],
        ['stdout', '  $ bun test audit-log'],
        ['stdout', '  ⚠ 1 failing: "rejects a negative page" — fixing'],
        ['stdout', '  Edited src/audit/log.ts (+12 −3)'],
        ['stdout', '  ✓ 14 passing'],
      ];
      let seq = 0;
      for (const [stream, text] of LOG) {
        seq += 1;
        await sql`
          insert into log_chunks (run_id, step_index, seq, stream, text, at)
          values (${run.id}, ${reached - 1}, ${seq}, ${stream}, ${`${text}\n`},
            now() - interval '1 minute' + ${`${seq * 12} seconds`}::interval)`;
      }
      await sql`
        insert into artifacts (run_id, step_index, kind, path, version)
        values (${run.id}, ${reached - 1}, 'commits', '4 commits', 1)`;
    }
  }
}

/**
 * The skills the artboard lists, so screen 11 can be held against it — each
 * with a version or two behind it, because the History button is only worth
 * looking at when there is something in it.
 */
const SKILLS: [string, string, string, number][] = [
  [
    'repo-conventions',
    'Project structure, naming and lint rules for netgroup repos. Use before creating or moving files.',
    [
      '# Repo conventions',
      '',
      '## Folder layout',
      '- `src/features/<name>/` holds UI, hooks and tests for one feature.',
      '- Shared code goes to `src/shared/`. Never import across features.',
      '',
      '## Naming',
      '- Files: kebab-case. React components: PascalCase.',
      '- Tests live next to the file: `thing.spec.ts`.',
      '',
      '## Lint & format',
      '- Run `npm run lint --fix` before every commit.',
      '- Do not disable eslint rules inline. Fix the code instead.',
      '',
      '## Database',
      '- Every schema change is a new migration in `db/migrations/`.',
      '- Never edit an existing migration.',
    ].join('\n'),
    4,
  ],
  [
    'commit-style',
    'Conventional commits with ticket id. Use when writing any commit message.',
    '# Commit style\n\n- `type(scope): summary`, then a blank line.\n- End the summary with the ticket id.',
    1,
  ],
  [
    'spec-template',
    'Structure for docs/spec.md. Use when writing a specification.',
    '# Spec template\n\n## Problem\n## Scope\n## Out of scope\n## Acceptance',
    1,
  ],
  [
    'ask-clarifying',
    'How to resolve ambiguity without a human. Use when a ticket leaves a choice open.',
    '# Ask clarifying\n\n- Write the assumption down in the spec.\n- Pick the reversible option.',
    1,
  ],
  [
    'owasp-checklist',
    'Top-10 checks for reviewing a diff. Use when reviewing anything that reaches a request.',
    '# OWASP checklist\n\n- Injection\n- Broken access control\n- Sensitive data in logs',
    1,
  ],
  [
    'docs-style',
    'Tone and structure for README updates. Use when changing anything a reader will see.',
    '# Docs style\n\n- Plain sentences. No exclamation marks.\n- Say what it does before how.',
    1,
  ],
  [
    'mn-localization',
    'Mongolian i18n rules for UI strings. Use when adding or changing any visible string.',
    '# Mongolian localisation\n\n- Keys are dotted and lower case.\n- Never concatenate translated fragments.',
    0,
  ],
];

const allAgents = await sql`select id, name from agents order by name`;
for (const [name, description, content, held] of SKILLS) {
  const [skill] = await sql`
    insert into skills (name, description, content, owner_id, updated_by)
    values (${name}, ${description}, ${content}, ${name === 'repo-conventions' ? null : me?.id},
      ${other?.id}) returning id`;
  if (!skill) continue;

  // A first version, then the state it is in now — so History shows a change
  // rather than a single row.
  await sql`
    insert into skill_versions (skill_id, version, name, description, content, created_by,
      created_at)
    values (${skill.id}, 1, ${name}, ${description}, ${content.split('\n').slice(0, 3).join('\n')},
      ${me?.id}, now() - interval '9 days')`;
  await sql`
    insert into skill_versions (skill_id, version, name, description, content, created_by,
      created_at)
    values (${skill.id}, 2, ${name}, ${description}, ${content}, ${other?.id},
      now() - interval '2 days')`;
  await sql`update skills set updated_at = now() - interval '2 days' where id = ${skill.id}`;

  for (const agent of allAgents.slice(0, held)) {
    await sql`insert into agent_skills (agent_id, skill_id) values (${agent.id}, ${skill.id})`;
  }
}

console.log(
  `seeded ${REPOS.length} repositories, ${TICKETS.length} tickets and ${SKILLS.length} skills`,
);
await sql.end();
