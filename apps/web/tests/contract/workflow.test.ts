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

test('the merge request body is composed by the application, not the workflow', () => {
  // The body needs the run's whole record — the ticket's criteria, the
  // specification and plan, the screens' addresses, which steps did not run,
  // what it cost — and the orchestration service holds only the snapshot. So
  // it fetches the body rather than assembling one, and a reviewer who never
  // saw the ticket can judge the change from the merge request alone
  // (SC-014).
  //
  // This exists because the opening node once read `$json.merge_request`
  // that nothing had ever set: the composer had no caller at all, so a real
  // merge request would have been opened with an undefined body.
  const compose = workflow.nodes.find((n) => n.name === 'Compose merge request');
  expect(compose, 'nothing fetches the merge request body').toBeDefined();
  const url = JSON.stringify(compose?.parameters);
  expect(url).toContain('/merge-request');
  // Authenticated with the run's own secret, as every other callback is.
  //
  // Matched on the field rather than on `$json.resume_secret`, because WHERE
  // the secret is read from is exactly what had to change: this node follows
  // an HTTP request, and `$json` at that point is that request's response,
  // not the run. It now names the node holding the state.
  expect(url).toContain('resume_secret');
  expect(url, 'the secret must come from the state, not from the last response').not.toMatch(
    /\$json\.resume_secret/,
  );

  const open = workflow.nodes.find((n) => n.name === 'Open merge request');
  const body = JSON.stringify(open?.parameters);
  expect(body).toContain('merge_request');

  // And it is reached from the composer, not before it.
  const reaches = (from: string, to: string) =>
    (workflow.connections[from]?.main ?? []).some((outputs) =>
      outputs.some((output) => output.node === to),
    );
  expect(reaches('Runner: verify and push', 'Open merge request')).toBe(false);
  expect(reaches('Runner: verify and push', 'Compose merge request')).toBe(true);
});

test('both providers get the field names they expect', () => {
  // GitLab and GitHub disagree about every field of a merge request: one
  // takes source_branch/target_branch/description, the other
  // head/base/body. Sending one shape to both opens nothing, and the
  // provider's error would arrive as an unexplained 400.
  const ready = workflow.nodes.find((n) => n.name === 'Merge request ready');
  expect(ready, 'nothing shapes the body per provider').toBeDefined();
  const shaping = JSON.stringify(ready?.parameters);
  for (const field of ['source_branch', 'target_branch', 'description', 'head', 'base', 'body']) {
    expect(shaping.includes(field), `${field} is not set for either provider`).toBe(true);
  }
  expect(shaping).toContain('gitlab');
});

/**
 * The state has to survive an HTTP node.
 *
 * n8n hands each node the OUTPUT of the one before it, so after an HTTP
 * Request node `$json` is that request's response — not the run. Nine nodes
 * read run state through `$json` while sitting directly behind an HTTP call,
 * and every one of them got undefined: the first to use a value, `Callback:
 * started` reading `$json.callback_url`, failed with ERR_INVALID_URL, and the
 * application reported it as `orchestrator answered 500`.
 *
 * The fix is to name the node the value comes from. This is the guard, because
 * the mistake is invisible in the editor — the expression is valid, the field
 * exists somewhere, and nothing says it is being read from the wrong place.
 */
test('no node reads run state from whatever answered last', () => {
  // Set once at the start and never changed, so reading one of these from
  // anywhere but the state means reading it from the wrong node.
  const RUN_SCOPED = [
    'callback_url',
    'resume_secret',
    'run_id',
    'attempt',
    'sandbox',
    'repo',
    'pipeline',
    'limits',
  ];

  const previous = new Map<string, string[]>();
  for (const [from, connection] of Object.entries(workflow.connections)) {
    for (const outputs of connection.main ?? []) {
      for (const output of outputs ?? []) {
        previous.set(output.node, [...(previous.get(output.node) ?? []), from]);
      }
    }
  }
  const typeOf = new Map(workflow.nodes.map((n) => [n.name, n.type]));
  const loses = (name: string) =>
    typeOf.get(name) === 'n8n-nodes-base.httpRequest' || typeOf.get(name) === 'n8n-nodes-base.wait';

  const offences: string[] = [];
  for (const node of workflow.nodes) {
    const behind = (previous.get(node.name) ?? []).filter(loses);
    if (behind.length === 0) continue;
    const text = JSON.stringify(node.parameters);
    for (const field of RUN_SCOPED) {
      if (text.includes(`$json.${field}`)) {
        offences.push(`${node.name} reads $json.${field} but follows ${behind.join(', ')}`);
      }
    }
  }
  expect(offences).toEqual([]);
});

/**
 * Every action the loop can decide has somewhere to go.
 *
 * `Advance` returns `action: 'fail'` when a cost ceiling is reached (FR-081),
 * and the switch had no branch for it — while `Callback: failed` sat in the
 * workflow with nothing connected to it at all. A run that went over budget
 * stopped in the middle and told nobody.
 */
test('every action the code can return is a wired switch branch', () => {
  const decide = workflow.nodes.find((n) => n.name === 'Decide next step');
  const advance = workflow.nodes.find((n) => n.name === 'Advance');
  const source = `${decide?.parameters.jsCode ?? ''}\n${advance?.parameters.jsCode ?? ''}`;
  const returned = new Set([...source.matchAll(/action:\s*'([a-z_]+)'/g)].map((m) => m[1]));
  expect(returned.size, 'no actions found — has the code moved?').toBeGreaterThan(0);

  const branch = workflow.nodes.find((n) => n.name === 'Switch on action');
  const rules = (branch?.parameters.rules as { values?: { outputKey?: string }[] } | undefined)
    ?.values;
  const wired = workflow.connections['Switch on action']?.main ?? [];
  const handled = new Set(
    (rules ?? [])
      .map((rule, index) => ((wired[index] ?? []).length > 0 ? rule.outputKey : undefined))
      .filter((key): key is string => Boolean(key)),
  );
  expect([...returned].filter((action) => !handled.has(action))).toEqual([]);
});

/**
 * An error from the runner is a failed run, not a finished step.
 *
 * Every `Runner:` node sets `neverError`, so an HTTP failure arrives as
 * ordinary data with an `error` in it rather than stopping the workflow. That
 * is the right choice — the run can then fail with the runner's own words
 * instead of an n8n node error — but it only works if something reads it.
 *
 * Nothing did. A sandbox that could not be created answered `{error,
 * reason}`, the workflow treated it as a success, and every step afterwards
 * answered "that run has no sandbox" — each of those a success too. The run
 * walked the entire pipeline without executing anything and stopped at the
 * first checkpoint, asking a person to approve work that had never happened,
 * with nothing spent and every step still marked waiting.
 */
test('an error from the runner is read, not walked past', () => {
  const neverError = workflow.nodes.filter(
    (n) => n.name.startsWith('Runner:') && JSON.stringify(n.parameters).includes('neverError'),
  );
  expect(neverError.length, 'no runner call tolerates its own errors').toBeGreaterThan(0);

  // Something has to look at what those calls answered. The two Code nodes
  // that carry the run forward are the only places that can.
  const readers = ['Carry state past the first callback', 'Advance']
    .map((name) => workflow.nodes.find((n) => n.name === name))
    .map((n) => String(n?.parameters.jsCode ?? ''));
  expect(readers.every((code) => /\.error\b/.test(code))).toBe(true);

  // And reading it has to end the run, not merely note it.
  expect(readers.some((code) => code.includes("action: 'fail'"))).toBe(true);
  const decide = String(
    workflow.nodes.find((n) => n.name === 'Decide next step')?.parameters.jsCode ?? '',
  );
  expect(decide, 'a run that already failed still consults the pipeline').toContain('fatal');
});
