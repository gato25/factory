import { afterAll, beforeEach, expect, test } from 'bun:test';
import { artifacts, runs, stepResults, tickets, users } from '@factory/db/schema';
import { eq, sql } from 'drizzle-orm';
import { composeMergeRequest, labelsFor } from '../../src/lib/services/merge-request';
import { mergeRequestBody } from '../../src/lib/services/merge-request-body';
import { startRun } from '../../src/lib/services/run';
import { connect, type Scenario, seed } from '../fixtures';

/**
 * SC-014 — a reviewer who never saw the ticket can judge the change from the
 * merge request alone. That is a claim about what the body CONTAINS, so this
 * asserts contents rather than that a body was produced.
 *
 * The composer had no caller when this was written: the workflow opened the
 * merge request with a field nothing had ever set, so a real merge request
 * would have carried an undefined body. `mergeRequestBody` is the caller,
 * and the route that exposes it is what the workflow fetches.
 */

const { db, sql: raw } = connect();
let scenario: Scenario;
const base = { callbackBaseUrl: 'https://factory.example' };
const PUBLIC = 'https://factory.netgroup.mn';

async function aRun() {
  const { run } = await startRun(db, { ticketId: scenario.ticketId, ...base });
  await db
    .update(runs)
    .set({
      costUsd: '1.8400',
      startedAt: sql`now() - interval '14 minutes'`,
      finishedAt: sql`now()`,
    })
    .where(eq(runs.id, run.id));
  return run.id;
}

async function document(runId: string, path: string, content: string, createdBy?: string) {
  await db
    .insert(artifacts)
    .values({ runId, stepIndex: 0, kind: 'document', path, version: 1, content, createdBy });
}

beforeEach(async () => {
  scenario = await seed(db);
});
afterAll(async () => {
  await raw.end();
});

test('the body carries everything a reviewer needs, in a readable order', async () => {
  const runId = await aRun();
  await document(runId, 'docs/spec.md', 'A "Continue with Google" button appears.');
  await document(runId, 'docs/plan.md', '1. Add the provider configuration.');

  const content = await composeMergeRequest(db, runId, { ticketUrl: `${PUBLIC}/tickets/x` });
  expect(content.title).toBe('Add Google OAuth sign-in');
  expect(content.sourceBranch).toBe('factory/142-add-google-oauth-sign-in');
  expect(content.targetBranch).toBe('main');

  // The ticket's own words first, then the criteria as a checklist a
  // reviewer can tick.
  expect(content.description).toContain('Users should be able to sign in with Google.');
  expect(content.description).toContain('- [ ] A Google button appears on the sign-in screen');
  expect(content.description).toContain('- [ ] Tests pass');

  // The specification is NOT collapsed: it is what a reviewer needs to judge
  // whether this is the right change, and a disclosure triangle is where
  // things go to be unread.
  expect(content.description).toContain('## Specification\n\nA "Continue with Google" button');
  // The plan is, because the diff already shows how the work was done.
  expect(content.description).toContain('<summary>Plan</summary>');

  // What it cost, how long, and that nothing is about to merge itself.
  expect(content.description).toContain('- Cost: $1.84');
  expect(content.description).toContain('- Duration: 14 min');
  expect(content.description).toContain('- First attempt');
  expect(content.description).toContain('never merges: this waits for a person');
});

test('a document a person edited at a gate says so', async () => {
  const runId = await aRun();
  const [editor] = await db
    .insert(users)
    .values({ name: 'Sara', email: 'sara@netgroup.mn' })
    .returning();
  await document(runId, 'docs/spec.md', 'A person rewrote this.', editor?.id);

  // An edited specification is a human's words, not an agent's, and that
  // changes how much weight a reviewer should give it.
  const content = await composeMergeRequest(db, runId, { ticketUrl: `${PUBLIC}/tickets/x` });
  expect(content.description).toContain('## Specification (edited by a person at a review gate)');
});

test('a document no person touched does not claim they did', async () => {
  const runId = await aRun();
  await document(runId, 'docs/spec.md', 'The agent wrote this.');
  const content = await composeMergeRequest(db, runId, { ticketUrl: `${PUBLIC}/tickets/x` });
  expect(content.description).toContain('## Specification\n\n');
  expect(content.description).not.toContain('edited by a person');
});

test('a second attempt says so, rather than burying it as a number', async () => {
  await aRun();
  await db
    .update(runs)
    .set({ status: 'failed', finishedAt: new Date() })
    .where(eq(runs.ticketId, scenario.ticketId));
  const { run } = await startRun(db, { ticketId: scenario.ticketId, ...base });
  const content = await composeMergeRequest(db, run.id, { ticketUrl: `${PUBLIC}/tickets/x` });
  expect(content.description).toContain('- Attempt 2 for this ticket');
});

test('screens are named, so a reviewer can tell which is which', async () => {
  const runId = await aRun();
  const content = await composeMergeRequest(db, runId, {
    ticketUrl: `${PUBLIC}/tickets/x`,
    screens: [
      { url: `${PUBLIC}/api/artifacts/a/image`, name: 'Sign in' },
      { url: `${PUBLIC}/api/artifacts/b/image`, name: 'Sign in — error' },
      { url: `${PUBLIC}/api/artifacts/c/image`, name: null },
    ],
    designSourceUrl: 'https://gitlab.com/n/s/-/blob/factory%2F142/design/sign-in.pen',
  });
  expect(content.description).toContain(
    '![Sign in](https://factory.netgroup.mn/api/artifacts/a/image)',
  );
  expect(content.description).toContain('![Sign in — error](');
  // An unnamed screen still gets something better than "screen".
  expect(content.description).toContain('![Screen 3](');
  expect(content.description).toContain('[Open the design source](https://gitlab.com/n/s/-/blob/');

  // Above the summary, so the intended interface is seen before the diff.
  const screensAt = content.description.indexOf('## Screens');
  const criteriaAt = content.description.indexOf('## Acceptance criteria');
  expect(screensAt).toBeGreaterThanOrEqual(0);
  expect(screensAt).toBeLessThan(criteriaAt);
});

test('a step that did not run is stated, not silently missing', async () => {
  const runId = await aRun();
  await db.insert(stepResults).values({
    runId,
    stepIndex: 1,
    status: 'skipped',
    conditionNotMet: 'this ticket does not change the interface',
  });
  // A ticket labelled `ui` with no screens is otherwise just puzzling.
  const content = await composeMergeRequest(db, runId, { ticketUrl: `${PUBLIC}/tickets/x` });
  expect(content.description).toContain('## Steps that did not run');
  expect(content.description).toContain('- Step 2: this ticket does not change the interface');
});

test('the labels identify the system and the pipeline that produced the work', async () => {
  expect(labelsFor({ pipeline: { name: 'Standard' } }, null)).toEqual([
    'code-factory',
    'pipeline:standard',
  ]);
  // Interface work carries one more (FR-068a).
  expect(labelsFor({ pipeline: { name: 'Design first' } }, true)).toEqual([
    'code-factory',
    'pipeline:design-first',
    'ui',
  ]);
  // Not classified is not the same as classified as not-interface.
  expect(labelsFor({ pipeline: { name: 'Standard' } }, false)).not.toContain('ui');
});

test('the body resolves screens and the design source from the run itself', async () => {
  const runId = await aRun();
  await db.insert(artifacts).values([
    {
      runId,
      stepIndex: 1,
      kind: 'screen',
      path: 'design/screens/sign-in.png',
      version: 1,
      screenName: 'Sign in',
    },
    {
      runId,
      stepIndex: 1,
      kind: 'design_file',
      path: 'design/sign-in.pen',
      version: 1,
      content: '{}',
    },
  ]);

  const content = await mergeRequestBody(db, runId, `${PUBLIC}/`);
  // The screen's address is on THIS deployment, which only the application
  // knows — the orchestration service holds the snapshot and nothing else.
  expect(content.description).toMatch(
    /!\[Sign in\]\(https:\/\/factory\.netgroup\.mn\/api\/artifacts\/[0-9a-f-]+\/image\)/,
  );
  // And the source opens on the provider, at the branch it was committed to.
  expect(content.description).toContain(
    '[Open the design source](https://gitlab.com/netgroup/shop-frontend/-/blob/',
  );
  expect(content.description).toContain('/design/sign-in.pen)');
  expect(content.description).toContain(
    `[Open ticket #142](${PUBLIC}/tickets/${scenario.ticketId}`,
  );
});

test('screens keep the order the design step produced them', async () => {
  const runId = await aRun();
  // Sorted by path, the error state would come first: a reviewer would meet
  // the failure before the thing that fails.
  for (const [path, name] of [
    ['design/screens/sign-in.png', 'Sign in'],
    ['design/screens/sign-in-error.png', 'Sign in — Google refused'],
  ] as const) {
    await db
      .insert(artifacts)
      .values({ runId, stepIndex: 1, kind: 'screen', path, version: 1, screenName: name });
  }
  const content = await mergeRequestBody(db, runId, PUBLIC);
  expect(content.description.indexOf('![Sign in](')).toBeLessThan(
    content.description.indexOf('![Sign in — Google refused]('),
  );
});

test('a revised design shows the newest screen, not both', async () => {
  const runId = await aRun();
  for (const version of [1, 2]) {
    await db.insert(artifacts).values({
      runId,
      stepIndex: 1,
      kind: 'screen',
      path: 'design/screens/sign-in.png',
      version,
      screenName: version === 1 ? 'Sign in' : 'Sign in (revised)',
    });
  }
  const content = await mergeRequestBody(db, runId, PUBLIC);
  expect(content.description).toContain('![Sign in (revised)](');
  expect(content.description).not.toContain('![Sign in](');
});

test('a run with no design step gets no Screens section at all', async () => {
  const runId = await aRun();
  const content = await mergeRequestBody(db, runId, PUBLIC);
  expect(content.description).not.toContain('## Screens');
  expect(content.description).not.toContain('design source');
});

test('completing a run stores the address and marks the ticket done', async () => {
  const { completeRun } = await import('../../src/lib/services/merge-request');
  const runId = await aRun();
  await completeRun(db, runId, 'https://gitlab.com/netgroup/shop-frontend/-/merge_requests/7');

  const [run] = await db.select().from(runs).where(eq(runs.id, runId)).limit(1);
  const [ticket] = await db
    .select()
    .from(tickets)
    .where(eq(tickets.id, scenario.ticketId))
    .limit(1);
  expect(run?.status).toBe('done');
  expect(ticket?.status).toBe('done');
  expect(ticket?.mergeRequestUrl).toBe(
    'https://gitlab.com/netgroup/shop-frontend/-/merge_requests/7',
  );
});
