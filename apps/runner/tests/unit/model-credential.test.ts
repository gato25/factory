import { describe, expect, test } from 'bun:test';
import { buildEnvironment, modelCredentialVariable } from '../../src/container/secrets';
import { credentials, snapshot } from '../fake-host';

/**
 * Which variable the Claude CLI is handed the model credential under.
 *
 * Two kinds authenticate it and they are NOT interchangeable — each is read
 * from its own variable, and a credential in the wrong slot fails with an
 * authentication error that names the wrong cause:
 *
 * - `ANTHROPIC_API_KEY` — an API key, billed per token to a Console account.
 * - `CLAUDE_CODE_OAUTH_TOKEN` — a subscription token from `claude setup-token`,
 *   drawing on a Claude subscription's own allowance.
 *
 * A deployment switches between them by storing a different credential in
 * Settings. No code change, no rebuild — which is the same shape as the
 * execution-host switch, and for the same reason: the thing an operator changes
 * should be a value, not a deploy.
 */

// Shaped like the real thing, and deliberately not a real one.
const OAUTH = 'sk-ant-oat01-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const API_KEY = 'sk-ant-api03-BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';

describe('telling the two credentials apart', () => {
  test('a subscription token goes to CLAUDE_CODE_OAUTH_TOKEN', () => {
    expect(modelCredentialVariable(OAUTH)).toBe('CLAUDE_CODE_OAUTH_TOKEN');
  });

  test('an API key goes to ANTHROPIC_API_KEY', () => {
    expect(modelCredentialVariable(API_KEY)).toBe('ANTHROPIC_API_KEY');
  });

  test('an unrecognised format is treated as an API key', () => {
    // The safe default, and the reason it is a default rather than an error:
    // every credential stored before this existed keeps working exactly as it
    // did. A new format nobody has told this code about should not break a
    // deployment that is running fine.
    for (const unknown of ['some-other-format', 'sk-ant-something-new', '']) {
      expect(modelCredentialVariable(unknown)).toBe('ANTHROPIC_API_KEY');
    }
  });
});

describe('exactly one variable is set, never both', () => {
  test('a subscription token leaves ANTHROPIC_API_KEY unset', () => {
    // The failure this prevents. The CLI prefers `ANTHROPIC_API_KEY` where it
    // finds one, so setting both with a subscription token in the key slot
    // would fail EVERY run — and the error would blame the key, not the
    // wiring.
    const env = buildEnvironment(snapshot, { ...credentials, modelKey: OAUTH });
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe(OAUTH);
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  test('an API key leaves CLAUDE_CODE_OAUTH_TOKEN unset', () => {
    const env = buildEnvironment(snapshot, { ...credentials, modelKey: API_KEY });
    expect(env.ANTHROPIC_API_KEY).toBe(API_KEY);
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
  });

  test('only one model credential variable is present either way', () => {
    for (const modelKey of [OAUTH, API_KEY]) {
      const env = buildEnvironment(snapshot, { ...credentials, modelKey });
      const present = ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN'].filter(
        (name) => env[name] !== undefined,
      );
      expect(present).toHaveLength(1);
    }
  });
});

describe('everything else a run needs is unchanged', () => {
  test('the git token and run identifiers still arrive', () => {
    // Switching credential kind must not disturb the rest of the environment.
    const env = buildEnvironment(snapshot, { ...credentials, modelKey: OAUTH });
    expect(env.GIT_TOKEN).toBe(credentials.gitToken);
    expect(env.FACTORY_RUN_ID).toBe(snapshot.run_id);
    expect(env.FACTORY_BRANCH).toBe(snapshot.repo.branch);
  });

  test('a subscription token is redacted from output like any other secret', async () => {
    // It is a credential, so FR-017 applies to it exactly as it does to an API
    // key — the redactor takes `modelKey` whatever kind it is.
    const { secretValues } = await import('../../src/container/secrets');
    expect(secretValues({ ...credentials, modelKey: OAUTH })).toContain(OAUTH);
  });
});
