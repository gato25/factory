import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CALLBACK_EVENTS } from '@factory/shared';

/**
 * contracts/orchestrator.md — one generic workflow serves every pipeline and
 * is never edited per pipeline. Nothing here runs n8n; these are the
 * properties that can be checked without it, and they are the ones that
 * would otherwise fail silently in production: unparseable code in a Code
 * node, a switch output nothing is wired to, an event name that drifted from
 * the shared contract.
 */

const WORKFLOW = resolve(import.meta.dir, '../../../../orchestration/n8n/run-ticket-pipeline.json');

interface Node {
  name: string;
  type: string;
  parameters: Record<string, unknown>;
}
interface Workflow {
  name: string;
  nodes: Node[];
  connections: Record<string, { main: { node: string; type: string; index: number }[][] }>;
}

const workflow = JSON.parse(readFileSync(WORKFLOW, 'utf8')) as Workflow;
const names = new Set(workflow.nodes.map((n) => n.name));
const codeNodes = workflow.nodes.filter((n) => n.type === 'n8n-nodes-base.code');

test('the workflow is one generic definition, not one per pipeline', () => {
  expect(workflow.name).toBe('run-ticket-pipeline');
  expect(workflow.nodes.length).toBeGreaterThan(0);
  // A pipeline's steps are read from the snapshot at runtime; no step name,
  // agent name or model may be baked into the workflow itself.
  const text = JSON.stringify(workflow);
  for (const baked of ['docs/spec.md', 'claude-opus-5', 'claude-sonnet-5', 'Implement']) {
    expect(text.includes(baked), `the workflow mentions ${baked}`).toBe(false);
  }
});

test('every Code node parses as JavaScript', () => {
  expect(codeNodes.length).toBeGreaterThan(0);
  for (const node of codeNodes) {
    const code = node.parameters.jsCode as string;
    expect(typeof code, `${node.name} has no jsCode`).toBe('string');
    // Compiled, not run: a syntax error here is a workflow that fails at the
    // first execution rather than at review.
    expect(() => new Function(code), `${node.name} does not parse`).not.toThrow();
  }
});

test('every connection points at a node that exists', () => {
  const dangling: string[] = [];
  for (const [from, spec] of Object.entries(workflow.connections)) {
    if (!names.has(from)) dangling.push(`from ${from}`);
    for (const branch of spec.main) {
      for (const target of branch) {
        if (!names.has(target.node)) dangling.push(`${from} → ${target.node}`);
      }
    }
  }
  expect(dangling).toEqual([]);
});

test('every switch output is wired to something', () => {
  for (const node of workflow.nodes) {
    if (node.type !== 'n8n-nodes-base.switch') continue;
    const rules = node.parameters.rules as { values: { outputKey: string }[] };
    const wired = workflow.connections[node.name]?.main ?? [];
    // An unwired output is a run that stops with no record of why.
    expect(wired.length, `${node.name} has ${rules.values.length} outputs`).toBe(
      rules.values.length,
    );
    for (const [index, branch] of wired.entries()) {
      expect(
        branch.length,
        `${node.name} output ${rules.values[index]?.outputKey}`,
      ).toBeGreaterThan(0);
    }
  }
});

test('every event the workflow posts is one the shared contract defines', () => {
  const posted = new Set<string>();
  for (const node of workflow.nodes) {
    const body = node.parameters.jsonBody;
    if (typeof body !== 'string') continue;
    for (const match of body.matchAll(/event:\s*'([a-z_]+)'/g)) posted.add(match[1] as string);
  }
  expect(posted.size).toBeGreaterThan(0);
  for (const event of posted) {
    expect(CALLBACK_EVENTS as readonly string[]).toContain(event);
  }
});

test('every callback the workflow posts authenticates with the run secret', () => {
  const callbacks = workflow.nodes.filter(
    (n) => n.type === 'n8n-nodes-base.httpRequest' && n.name.startsWith('Callback:'),
  );
  expect(callbacks.length).toBeGreaterThan(0);
  for (const node of callbacks) {
    const headers = JSON.stringify(node.parameters.headerParameters ?? {});
    expect(headers, `${node.name} does not present the run secret`).toContain('resume_secret');
  }
});

/** A gate and a pause both hold indefinitely, and both need a way back. */
test('every indefinite wait is reached by a callback carrying its resume address', () => {
  const waits = workflow.nodes.filter((n) => n.type === 'n8n-nodes-base.wait');
  expect(waits.length).toBeGreaterThan(0);

  for (const wait of waits) {
    // A webhook resume is what makes the wait unbounded rather than timed.
    expect(wait.parameters.resume, `${wait.name} is not resumed by webhook`).toBe('webhook');

    const feeders = Object.entries(workflow.connections)
      .filter(([, spec]) => spec.main.some((b) => b.some((t) => t.node === wait.name)))
      .map(([from]) => from);
    expect(feeders.length, `nothing leads to ${wait.name}`).toBeGreaterThan(0);

    for (const feeder of feeders) {
      const node = workflow.nodes.find((n) => n.name === feeder);
      const body = String(node?.parameters.jsonBody ?? '');
      expect(body, `${feeder} does not hand over a resume address`).toContain(
        '$execution.resumeUrl',
      );
    }
  }
});

test('a paused run holds rather than running the next step (FR-096)', () => {
  const decide = workflow.nodes.find((n) => n.name === 'Decide next step');
  const code = String(decide?.parameters.jsCode ?? '');
  expect(code).toContain("action: 'hold'");
  // And the hold is checked before a step is chosen, not after it has run.
  expect(code.indexOf("action: 'hold'")).toBeLessThan(code.indexOf("action: 'run'"));
});

test('a ceiling reached is checked after every step (FR-081)', () => {
  const advance = workflow.nodes.find((n) => n.name === 'Advance');
  const code = String(advance?.parameters.jsCode ?? '');
  expect(code).toContain('cost_ceiling_usd');
  expect(code).toContain("action: 'fail'");
});
