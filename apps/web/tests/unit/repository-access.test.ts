import { describe, expect, test } from 'bun:test';
import type { AccessCheck } from '../../src/lib/services/providers';
import { assertUsable } from '../../src/lib/services/repository';

/**
 * What a failed connection tells the person holding the token.
 *
 * The distinction these tests hold down is between a token that is real but
 * does not carry enough permission, and a token the provider will not accept
 * at all. They call for different actions — edit the token, versus issue a new
 * one — and every non-OK answer used to be reported as the first, because the
 * client flattened them all into "none of the three capabilities is present".
 */

const usable: AccessCheck = {
  canRead: true,
  canCreateBranch: true,
  canOpenMergeRequest: true,
};

describe('a token that is accepted', () => {
  test('with every capability, passes', () => {
    expect(() => assertUsable(usable, 'github')).not.toThrow();
  });

  test('missing one capability names that one permission', () => {
    expect(() => assertUsable({ ...usable, canOpenMergeRequest: false }, 'github')).toThrow(
      'The token is missing Pull requests: Read and write',
    );
  });

  test('missing two names both, in the provider’s own words', () => {
    expect(() =>
      assertUsable({ ...usable, canCreateBranch: false, canOpenMergeRequest: false }, 'gitlab'),
    ).toThrow('The token is missing write_repository and api');
  });
});

describe('a token that is refused outright', () => {
  // The case that sent somebody to edit a token GitHub had never accepted.
  test('a refusal replaces the permission list rather than joining it', () => {
    const rejected: AccessCheck = {
      canRead: false,
      canCreateBranch: false,
      canOpenMergeRequest: false,
      rejected: 'GitHub did not accept this token (401).',
    };
    expect(() => assertUsable(rejected, 'github')).toThrow('GitHub did not accept this token');
    // The point of the change: no instruction to go and grant permissions.
    expect(() => assertUsable(rejected, 'github')).not.toThrow(/missing Contents: Read/);
  });

  test('it wins even though every capability is false', () => {
    // Both are true of the same object, and the refusal is the one to say.
    let message = '';
    try {
      assertUsable(
        {
          canRead: false,
          canCreateBranch: false,
          canOpenMergeRequest: false,
          rejected: 'GitHub has no gato25/eye that this token can see (404).',
        },
        'github',
      );
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toBe('GitHub has no gato25/eye that this token can see (404).');
  });
});
