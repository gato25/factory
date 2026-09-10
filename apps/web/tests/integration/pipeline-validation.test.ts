import { afterAll, beforeEach, expect, test } from 'bun:test';
import { pipelines, pipelineVersions } from '@factory/db/schema';
import type { Step } from '@factory/shared';
import { eq } from 'drizzle-orm';
import { savePipeline } from '../../src/lib/services/pipeline';
import {
  assertSavable,
  classifyingIndex,
  problemsWith,
  producesCode,
} from '../../src/lib/services/pipeline-validate';
import { connect, type Scenario, seed } from '../fixtures';

/**
 * The three refusals (FR-028, FR-032d, FR-032e). Each names the offending
 * step and says what to do, because a refusal a person cannot act on is
 * worse than none: they delete the step that seemed to cause it.
 *
 * Everything else about a pipeline is taste. These three describe a pipeline
 * that cannot do what it claims.
 */

const { db, sql: raw } = connect();
let scenario: Scenario;
let owner: { id: string; name: string; email: string; role: 'member' };

const spec = (): Step => ({
  type: 'agent',
  condition: 'always',
  agent_id: 'a-spec',
  output_files: ['docs/spec.md'],
});
const code = (): Step => ({ type: 'agent', condition: 'always', agent_id: 'a-impl' });
const design = (condition: Step['condition'] = 'ticket_has_ui'): Step => ({
  type: 'design',
  condition,
  agent_id: 'a-design',
});
const gate = (condition: Step['condition'] = 'always'): Step => ({
  type: 'checkpoint',
  condition,
  approvers: 'anyone',
});
const shell = (command = 'bun test'): Step => ({ type: 'shell', condition: 'always', command });

const messages = (steps: Step[]) => problemsWith(steps).map((p) => p.message);

beforeEach(async () => {
  scenario = await seed(db);
  owner = { id: scenario.userId, name: 'Bat', email: 'bat@netgroup.mn', role: 'member' };
  await db
    .update(pipelines)
    .set({ ownerId: scenario.userId })
    .where(eq(pipelines.id, scenario.pipelineId));
});
afterAll(async () => {
  await raw.end();
});

// --- FR-028: no code-producing step ---

test('a pipeline with no code-producing step is refused, and told what to add', () => {
  const problems = problemsWith([spec(), gate(), shell()]);
  expect(problems).toHaveLength(1);
  expect(problems[0]?.index).toBeNull();
  expect(problems[0]?.message).toContain('no step that writes code');
  // And it says which steps it looked at, rather than leaving them guessing.
  expect(problems[0]?.message).toContain('every agent step here declares documents');
  expect(problems[0]?.message).toContain('Add an agent step with no required documents');
});

test('a pipeline with nothing but verification says so more plainly', () => {
  const problems = problemsWith([shell()]);
  expect(problems[0]?.message).toContain('cannot produce a merge request');
  expect(problems[0]?.message).not.toContain('every agent step here');
});

test('verification, gates and notifications may follow the code step (FR-028)', () => {
  expect(
    messages([
      spec(),
      code(),
      shell(),
      gate(),
      { type: 'notify', condition: 'always', channel: '#x', template: 'done' },
    ]),
  ).toEqual([]);
});

test('the code-producing step is the agent step with no required documents', () => {
  expect(producesCode(code())).toBe(true);
  expect(producesCode(spec())).toBe(false);
  expect(producesCode(gate())).toBe(false);
  expect(producesCode(shell())).toBe(false);
  expect(producesCode(design())).toBe(false);
});

test('an empty pipeline is refused, and told where to start', () => {
  expect(messages([])).toEqual(['A pipeline needs at least one step. Add one from the palette.']);
});

// --- FR-032e: a design step before the classifying step ---

test('a design step before the classifying step is refused, naming it', () => {
  const problems = problemsWith([design(), spec(), code()]);
  const about = problems.filter((p) => p.index === 0);
  expect(about.length).toBeGreaterThan(0);
  expect(about.some((p) => p.message.includes('Step 1 is a design step'))).toBe(true);
  expect(about.some((p) => p.message.includes('before the specification step that decides'))).toBe(
    true,
  );
});

test('a design step after it is fine', () => {
  expect(messages([spec(), design(), code()])).toEqual([]);
});

test('a design step in a pipeline that classifies nowhere is refused', () => {
  // No document-producing step, so nothing ever decides.
  const problems = problemsWith([design('always'), code()]);
  expect(problems.some((p) => p.message.includes('Step 1 is a design step'))).toBe(true);
  expect(classifyingIndex([design('always'), code()])).toBeNull();
});

// --- FR-032d: a condition depending on a fact not yet established ---

test('a condition before the fact is established is refused, naming step and fact', () => {
  const problems = problemsWith([gate('ticket_has_ui'), spec(), code()]);
  const first = problems.find((p) => p.index === 0);
  expect(first?.message).toContain('Step 1 runs only if this ticket changes the interface');
  // The FACT in words, which is what FR-032d asks be stated.
  expect(first?.message).toContain('whether the ticket changes the interface is not known yet');
  expect(first?.message).toContain('Move it after the step that writes the specification');
});

test('the inverse condition is refused in the same place', () => {
  const problems = problemsWith([gate('ticket_has_no_ui'), spec(), code()]);
  expect(problems[0]?.message).toContain(
    'Step 1 runs only if this ticket does not change the interface',
  );
});

test('a condition ON the classifying step is refused: it has not decided yet', () => {
  const conditional: Step = { ...spec(), condition: 'ticket_has_ui' };
  expect(problemsWith([conditional, code()]).length).toBeGreaterThan(0);
});

test('a condition after the fact is established is fine', () => {
  expect(messages([spec(), gate('ticket_has_ui'), code()])).toEqual([]);
  expect(messages([spec(), design(), gate('ticket_has_ui'), code()])).toEqual([]);
});

test('an always condition needs nothing established, anywhere', () => {
  expect(messages([code()])).toEqual([]);
  expect(messages([gate(), code()])).toEqual([]);
});

test('no condition mentions a code — every message is in words (FR-032f)', () => {
  const everything = [
    ...messages([gate('ticket_has_ui'), spec(), code()]),
    ...messages([gate('ticket_has_no_ui'), spec(), code()]),
    ...messages([design(), spec(), code()]),
  ];
  expect(everything.length).toBeGreaterThan(0);
  for (const message of everything) {
    expect(message).not.toContain('ticket_has_ui');
    expect(message).not.toContain('ticket_has_no_ui');
  }
});

// --- the smaller refusals, which are the same kind of claim ---

test('a gate nobody can decide is refused', () => {
  const problems = problemsWith([
    code(),
    { type: 'checkpoint', condition: 'always', approvers: [] },
  ]);
  expect(problems[0]?.message).toContain('nobody could ever decide it');
});

test('a gate that expires before anyone could look is refused', () => {
  const problems = problemsWith([
    code(),
    { type: 'checkpoint', condition: 'always', approvers: 'anyone', timeout_hours: 0 },
  ]);
  expect(problems[0]?.message).toContain('expires before anyone could look at it');
});

test('a shell step with no command is refused: it would pass without running', () => {
  expect(messages([code(), shell('')])[0]).toContain('would pass without running anything');
});

test('an agent step with no agent is refused', () => {
  expect(messages([{ type: 'agent', condition: 'always' }])[0]).toContain('no agent chosen');
});

// --- the refusals reach the save, and every one is reported at once ---

test('a save is refused, and reports every problem in one pass', async () => {
  let refused: Error | null = null;
  try {
    await savePipeline(
      db,
      // No code step; a design step and a condition both before the step
      // that decides whether the ticket changes the interface.
      { pipelineId: scenario.pipelineId, steps: [design(), gate('ticket_has_ui'), spec()] },
      owner,
    );
  } catch (error) {
    refused = error as Error;
  }

  const message = refused?.message ?? '';
  // No code step, a condition too early, and a design step too early.
  expect(message).toContain('no step that writes code');
  expect(message).toContain('Step 2 runs only if this ticket changes the interface');
  expect(message).toContain('Step 1 is a design step');

  // And nothing was written: the pipeline is still on version 1.
  const [pipeline] = await db
    .select()
    .from(pipelines)
    .where(eq(pipelines.id, scenario.pipelineId))
    .limit(1);
  expect(pipeline?.currentVersion).toBe(1);
  expect(
    await db
      .select()
      .from(pipelineVersions)
      .where(eq(pipelineVersions.pipelineId, scenario.pipelineId)),
  ).toHaveLength(1);
});

test('assertSavable passes silently on a pipeline that is fine', () => {
  expect(() =>
    assertSavable([spec(), design(), gate('ticket_has_ui'), code(), shell()]),
  ).not.toThrow();
});

test('the shipped default pipeline saves without complaint', async () => {
  const [version] = await db
    .select()
    .from(pipelineVersions)
    .where(eq(pipelineVersions.pipelineId, scenario.pipelineId));
  // Whatever ships must pass the rules it will be judged by.
  expect(problemsWith((version?.steps ?? []) as Step[])).toEqual([]);
});
