import { expect, test } from 'bun:test';
import { createRedactor, isClean, REDACTION_PLACEHOLDER } from '../src/redact';

const GIT_TOKEN = 'ghp_aBcDeFgH1234567890ijKlMnOpQrStUvWx';
const MODEL_KEY = 'sk-ant-api03-VeryLongSecretValue-0123456789';

test('a credential handed to the run never survives ingest (SC-011)', () => {
  const redact = createRedactor([GIT_TOKEN, MODEL_KEY]);
  const stepOutput = `cloning with token ${GIT_TOKEN}\nexport ANTHROPIC_API_KEY=${MODEL_KEY}`;
  const stored = redact(stepOutput);
  expect(stored).not.toContain(GIT_TOKEN);
  expect(stored).not.toContain(MODEL_KEY);
  expect(stored).toContain(REDACTION_PLACEHOLDER);
});

test('a credential we were never given is still caught by shape', () => {
  const redact = createRedactor();
  const unknown = 'glpat-SomeTokenWeNeverIssued123';
  expect(redact(`remote: ${unknown}`)).not.toContain(unknown);
});

test('credentials embedded in a clone URL are removed', () => {
  const redact = createRedactor();
  const out = redact('git clone https://oauth2:glpat-abcdefghij123456@gitlab.com/n/shop.git');
  expect(out).not.toContain('glpat-abcdefghij123456');
  expect(out).toContain('https://[redacted]@gitlab.com/n/shop.git');
});

test('an Authorization header is stripped of its value but keeps its shape', () => {
  const redact = createRedactor();
  const out = redact('Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abc');
  expect(out).toBe(`Authorization: Bearer ${REDACTION_PLACEHOLDER}`);
});

test('overlapping secrets leave no fragment behind', () => {
  const outer = 'supersecretvalue-with-suffix';
  const inner = 'supersecretvalue';
  const redact = createRedactor([inner, outer]);
  expect(redact(`token=${outer}`)).toBe(`token=${REDACTION_PLACEHOLDER}`);
});

test('ordinary output is left alone', () => {
  const redact = createRedactor([GIT_TOKEN]);
  const ordinary = 'Running 12 tests\n  ✓ all green\nBranch factory/142-oauth pushed';
  expect(redact(ordinary)).toBe(ordinary);
  expect(isClean(ordinary)).toBe(true);
});

test('a short value is not redacted by value, because it would destroy the log', () => {
  const redact = createRedactor(['abc']);
  expect(redact('abc is a common substring in abcdef')).toContain('abc');
});

test('isClean reports whether anything credential-shaped survived', () => {
  expect(isClean(`token ${GIT_TOKEN}`)).toBe(false);
  expect(isClean('nothing to see here')).toBe(true);
});
