import { expect, test } from 'bun:test';
import type { Step } from '../src/snapshot';
import { applyStepResult, conditionHolds, decideStep, validateStepOrder } from '../src/step-loop';

const step = (over: Partial<Step> = {}): Step => ({
  type: 'agent',
  condition: 'always',
  ...over,
});

// --- the orchestrator branches only on condition and type (Principle III) ---

test('an unconditional step always runs', () => {
  expect(conditionHolds('always', {})).toBe(true);
  expect(conditionHolds('always', { hasUi: false })).toBe(true);
});

test('a ticket_has_ui step runs only when the ticket changes the interface', () => {
  expect(conditionHolds('ticket_has_ui', { hasUi: true })).toBe(true);
  expect(conditionHolds('ticket_has_ui', { hasUi: false })).toBe(false);
});

test('an unestablished fact reads as false, so design is skipped not guessed (FR-102)', () => {
  // Guessing "yes" would spend a design step on a migration.
  expect(conditionHolds('ticket_has_ui', {})).toBe(false);
  expect(conditionHolds('ticket_has_no_ui', {})).toBe(true);
});

test('a step whose condition does not hold is SKIPPED, with the reason stated (FR-110)', () => {
  const steps = [step({ type: 'design', condition: 'ticket_has_ui' })];
  const decision = decideStep(steps, 0, { hasUi: false });
  expect(decision.action).toBe('skip');
  expect(decision.action === 'skip' && decision.conditionNotMet).toBe('ticket has no UI change');
});

test('a skipped step does not end the run — the next index still decides (FR-111)', () => {
  const steps = [
    step({ type: 'design', condition: 'ticket_has_ui' }),
    step({ type: 'agent', condition: 'always' }),
  ];
  expect(decideStep(steps, 0, { hasUi: false }).action).toBe('skip');
  expect(decideStep(steps, 1, { hasUi: false }).action).toBe('run');
});

test('the loop finishes past the last step', () => {
  expect(decideStep([step()], 1, {}).action).toBe('finish');
  expect(decideStep([], 0, {}).action).toBe('finish');
});

test('the classification is carried forward from the step that established it', () => {
  expect(applyStepResult({}, { classification: { has_ui: true } })).toEqual({ hasUi: true });
  // A step that establishes nothing leaves the facts alone.
  expect(applyStepResult({ hasUi: true }, {})).toEqual({ hasUi: true });
});

test('a whole run is decided step by step, with design skipped on a migration', () => {
  const steps = [
    step({ agent_id: 'spec' }),
    step({ type: 'design', condition: 'ticket_has_ui' }),
    step({ agent_id: 'plan' }),
  ];
  let facts = {};
  const trace: string[] = [];
  for (let i = 0; i < steps.length; i++) {
    const decision = decideStep(steps, i, facts);
    trace.push(decision.action);
    if (decision.action === 'run' && i === 0) {
      facts = applyStepResult(facts, { classification: { has_ui: false } });
    }
  }
  expect(trace).toEqual(['run', 'skip', 'run']);
});

test('the same pipeline runs design when the ticket does change the interface', () => {
  const steps = [step({ agent_id: 'spec' }), step({ type: 'design', condition: 'ticket_has_ui' })];
  const facts = applyStepResult({}, { classification: { has_ui: true } });
  expect(decideStep(steps, 1, facts).action).toBe('run');
});

// --- save-time validation (FR-032d, FR-032e) ---

test('a condition before the classifying step is refused, naming the step', () => {
  const steps = [step({ type: 'design', condition: 'ticket_has_ui' }), step({ agent_id: 'spec' })];
  const problems = validateStepOrder(steps, 1);
  expect(problems.length).toBeGreaterThan(0);
  expect(problems[0]?.message).toContain('хараахан мэдэгдээгүй байна');
});

test('a design step before the classifying step is refused (FR-032e)', () => {
  const steps = [step({ type: 'design', condition: 'always' }), step({ agent_id: 'spec' })];
  const problems = validateStepOrder(steps, 1);
  expect(problems.some((p) => p.message.includes('тодорхойлолтын алхмаас өмнө байна'))).toBe(true);
});

test('a design step after the classifying step is accepted', () => {
  const steps = [step({ agent_id: 'spec' }), step({ type: 'design', condition: 'ticket_has_ui' })];
  expect(validateStepOrder(steps, 0)).toEqual([]);
});

test('a pipeline with no classifying step cannot carry any condition at all', () => {
  const steps = [step({ condition: 'ticket_has_ui' })];
  expect(validateStepOrder(steps, null)).toHaveLength(1);
});

test('an all-unconditional pipeline validates with or without a classifying step', () => {
  const steps = [step(), step({ type: 'shell', command: 'bun test' })];
  expect(validateStepOrder(steps, null)).toEqual([]);
  expect(validateStepOrder(steps, 0)).toEqual([]);
});
