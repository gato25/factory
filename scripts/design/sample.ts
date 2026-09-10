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
  tickets, pipeline_versions, pipelines, agent_skills, agents, skills, repositories,
  credentials, users, workspaces cascade`;

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
          steps: STEPS.map((name) => ({
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
      })}::jsonb, ${runStatus}, ${status === 'running' ? 3 : 1}, '1.8400', '5.0000', 45, now())
      returning id`;
    if (run) await sql`update tickets set current_run_id = ${run.id} where id = ${ticket.id}`;
  }
}

console.log(`seeded ${REPOS.length} repositories and ${TICKETS.length} tickets`);
await sql.end();
