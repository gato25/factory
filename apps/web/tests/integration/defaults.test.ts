import { expect, test } from 'bun:test';
import { DEFAULT_AGENTS } from '../../src/lib/services/agent-defaults';

/**
 * FR-092 — there is no verification stage of the system's own, so the
 * implementing agent carries the responsibility for the repository's tests.
 * That responsibility lives in one place: its prompt. If the sentence is ever
 * quietly dropped, nothing else in the system would notice, which is why it
 * is asserted here.
 */

const implement = DEFAULT_AGENTS.find((agent) => agent.slug === 'implement');

test('the implementing agent ships as a default', () => {
  expect(implement).toBeDefined();
  expect(implement?.engine).toBe('claude_cli');
});

test('its prompt makes it responsible for the repository tests', () => {
  const prompt = implement?.systemPrompt ?? '';
  expect(prompt).toContain("responsible for leaving the repository's tests passing");
  // Within its own step, not at some later point.
  expect(prompt).toMatch(/within this\s+step/);
  // Using what it was permitted, rather than assuming a command.
  expect(prompt).toContain('tools you have been permitted');
  // And it is told nothing downstream will do it.
  expect(prompt).toMatch(/no verification\s+stage after this one/);
});

test('it has the tools that responsibility requires', () => {
  // Reading the tests, changing code, and running something are all needed;
  // a prompt that demands tests without a way to run them is a lie.
  expect(implement?.allowedTools).toContain('Bash');
  expect(implement?.allowedTools).toContain('Edit');
  expect(implement?.allowedTools).toContain('Read');
});

test('no default agent claims to be a verification stage', () => {
  // FR-055a — verification is a shell step an author adds, never a stage of
  // the system's own, so no shipped agent may present itself as one.
  for (const agent of DEFAULT_AGENTS) {
    expect(agent.slug).not.toBe('verify');
    expect(agent.name.toLowerCase()).not.toBe('verify');
  }
});

test('every default model identifier is exact and carries no date suffix', () => {
  for (const agent of DEFAULT_AGENTS) {
    if (agent.engine !== 'claude_cli') continue;
    expect(['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5']).toContain(agent.model);
  }
});
