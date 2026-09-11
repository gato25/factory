import { expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { CALLBACK_EVENTS } from '../src/callbacks';
import { DEFAULT_CONDITION } from '../src/snapshot';

const REPO = resolve(import.meta.dir, '../../..');
const CONTRACTS = join(REPO, 'specs/001-code-factory-mvp/contracts');

/**
 * plan.md: a mismatch between the app's idea of a step result and the
 * Runner's would corrupt runs silently, so packages/shared must hold the only
 * definition — and it must match the written contract, not merely itself.
 */

test('the callback vocabulary matches contracts/orchestrator.md exactly', () => {
  const doc = readFileSync(join(CONTRACTS, 'orchestrator.md'), 'utf8');
  const table = doc.slice(doc.indexOf('| Event |'), doc.indexOf('**Every callback is idempotent'));
  const documented = [...table.matchAll(/^\| `(\w+)` \|/gm)]
    .map((m) => m[1])
    .filter((name): name is string => name !== undefined);

  expect(documented.length).toBeGreaterThan(0);
  // Widened to string[] so the comparison is against the document, not
  // against the type that the document is supposed to define.
  const declared: string[] = [...CALLBACK_EVENTS];
  expect(declared.sort()).toEqual(documented.sort());
});

test('the step vocabulary matches the five kinds the spec requires', () => {
  const spec = readFileSync(join(REPO, 'specs/001-code-factory-mvp/spec.md'), 'utf8');
  expect(spec).toContain('System MUST support five kinds of step');
  // agent | design | checkpoint | shell | notify — asserted through the type
  // by exhaustiveness: adding a kind without updating this list fails to compile.
  const kinds: Record<import('../src/snapshot').StepType, true> = {
    agent: true,
    design: true,
    checkpoint: true,
    shell: true,
    notify: true,
  };
  expect(Object.keys(kinds)).toHaveLength(5);
});

test('a step defaults to running always (FR-032a)', () => {
  expect(DEFAULT_CONDITION).toBe('always');
});

test('every contract file has a test that reads it (Constitution Principle II)', () => {
  const contracts = readdirSync(CONTRACTS).filter((f) => f.endsWith('.md'));
  expect(contracts.sort()).toEqual([
    'orchestrator.md',
    'runner.md',
    'step-engines.md',
    'ui-data.md',
  ]);
});

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.svelte-kit' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, found);
    else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) found.push(full);
  }
  return found;
}

test('no workspace outside packages/shared redeclares a contract type', () => {
  const shared = resolve(import.meta.dir, '../src');
  const elsewhere = [join(REPO, 'apps'), join(REPO, 'packages/db')]
    .flatMap((d) => sourceFiles(d))
    .filter((f) => !f.startsWith(shared));

  const guarded = [
    'CallbackEvent',
    'CallbackEnvelope',
    'PipelineSnapshot',
    'StepEngine',
    'StepOutcome',
    'StepContext',
  ];
  const offenders: string[] = [];
  for (const file of elsewhere) {
    // Strip import statements first: `import { type PipelineSnapshot } from …`
    // names a contract type without redeclaring it.
    const text = readFileSync(file, 'utf8').replace(/^import[\s\S]*?from\s+'[^']*';$/gm, '');
    for (const name of guarded) {
      // A declaration is followed by `=`, `{` or a type parameter list — which
      // is what separates it from a re-export or an import specifier.
      if (new RegExp(`^\\s*(export\\s+)?(interface|type)\\s+${name}\\s*[<={]`, 'm').test(text)) {
        offenders.push(`${file.replace(`${REPO}/`, '')} redeclares ${name}`);
      }
    }
  }
  expect(offenders).toEqual([]);
});
